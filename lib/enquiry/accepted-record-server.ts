import "server-only";
import { prisma } from "@/lib/db/client";
import { Prisma } from "@/lib/db/generated/client";
import { recordEvent } from "@/lib/telemetry/record";
import { BUYER_REFERENCE_MAX, REPORT_DETAIL_MAX, REPORT_DETAIL_MIN } from "./accepted-record";

export { BUYER_REFERENCE_MAX, REPORT_DETAIL_MAX, REPORT_DETAIL_MIN };

/**
 * Board `7c` — the two things a buyer may write on their accepted record.
 *
 * Neither changes what was agreed. The lines, the price, the terms and the
 * supplier are the accepted `Quote` and are read-only to everybody. What the
 * buyer adds is their own label for the record, and a report about the supplier.
 * Both refuse unless the enquiry is the caller's and is accepted: the same three
 * conditions the loader reads with, in the same `where`.
 */

export type ReferenceResult =
  | { ok: true; buyerReference: string | null }
  /** `required`: board `7b` — the company requires a PO number, so it cannot be cleared. */
  | { ok: false; error: "not_found" | "too_long" | "invalid" | "required" };

/**
 * Set, change or clear the buyer's reference.
 *
 * Trimmed, inner whitespace collapsed, and empty means *remove it* — a buyer who
 * clears the box wants no reference, not a reference of nothing. Control
 * characters are refused rather than stripped, because a reference with a tab
 * in it is a paste from a spreadsheet and the buyer should see it did not take.
 */
export async function setBuyerReference(input: {
  buyerId: string;
  refOrId: string;
  value: string;
}): Promise<ReferenceResult> {
  // A control character is a paste from somewhere that was not a text box.
  if (/[\u0000-\u001f\u007f]/.test(input.value)) {
    return { ok: false, error: "invalid" };
  }
  const normalised = input.value.replace(/\s+/g, " ").trim();
  if (normalised.length > BUYER_REFERENCE_MAX) return { ok: false, error: "too_long" };
  const buyerReference = normalised === "" ? null : normalised;

  /*
     Board `7b`. Where the enquiry's company requires a PO number, the
     reference is that PO number: it was asked for at acceptance and the
     supplier has it on the record, so it can be corrected but not removed.
  */
  if (buyerReference === null) {
    const owner = await prisma.enquiry.findFirst({
      where: { OR: [{ ref: input.refOrId }, { id: input.refOrId }], buyerId: input.buyerId },
      select: { buyerCompany: { select: { requirePoNumber: true } } },
    });
    if (owner?.buyerCompany?.requirePoNumber) return { ok: false, error: "required" };
  }

  const updated = await prisma.enquiry.updateMany({
    where: {
      OR: [{ ref: input.refOrId }, { id: input.refOrId }],
      buyerId: input.buyerId,
      contactReleasedToBusinessId: { not: null },
    },
    data: { buyerReference },
  });
  if (updated.count === 0) return { ok: false, error: "not_found" };
  return { ok: true, buyerReference };
}

export type ReportResult =
  | { ok: true; reportId: string }
  | { ok: false; error: "not_found" | "too_short" | "too_long" | "already_reported" };

/**
 * File the one supplier report the record offers — `B8`.
 *
 * *"Goes to the trust team with the thread attached, and returns one of three
 * named outcomes with a reason."* The thread is attached by reference rather
 * than by copy: `enquiryId` on the report, which `/admin/reports/:id` reads the
 * messages through. A copy would be a second record of the conversation, and it
 * would stop matching the first the moment a message was flagged.
 *
 * Into the ordinary conduct queue (`kind: accepted_quote`), resolved by the
 * ordinary `resolveReport` — three outcomes, a written reason, an audit row. No
 * outcome moves money, because there is none here to move.
 *
 * One per enquiry, held by a unique index rather than a read-then-write: two
 * submits a second apart cannot both land, and the second is told it already
 * has.
 */
export async function reportAcceptedQuote(input: {
  buyerId: string;
  refOrId: string;
  detail: string;
}): Promise<ReportResult> {
  const detail = input.detail.trim();
  if (detail.length < REPORT_DETAIL_MIN) return { ok: false, error: "too_short" };
  if (detail.length > REPORT_DETAIL_MAX) return { ok: false, error: "too_long" };

  const enquiry = await prisma.enquiry.findFirst({
    where: {
      OR: [{ ref: input.refOrId }, { id: input.refOrId }],
      buyerId: input.buyerId,
      contactReleasedToBusinessId: { not: null },
    },
    select: { id: true, contactReleasedToBusinessId: true },
  });
  if (!enquiry?.contactReleasedToBusinessId) return { ok: false, error: "not_found" };

  try {
    const report = await prisma.supplierReport.create({
      data: {
        subjectBusinessId: enquiry.contactReleasedToBusinessId,
        reporterId: input.buyerId,
        kind: "accepted_quote",
        enquiryId: enquiry.id,
        // The three-strikes count keys on the field. For this kind the field is
        // the accepted quote itself, so priors read "reported after acceptance".
        subjectField: "accepted_quote",
        detail,
      },
      select: { id: true },
    });

    await recordEvent({
      name: "supplier_report_filed",
      businessId: enquiry.contactReleasedToBusinessId,
      actorId: input.buyerId,
      props: { kind: "accepted_quote", chars: detail.length },
    });

    return { ok: true, reportId: report.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, error: "already_reported" };
    }
    throw error;
  }
}
