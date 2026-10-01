import "server-only";
import { prisma } from "@/lib/db/client";
import { Prisma } from "@/lib/db/generated/client";
import { recordEvent } from "@/lib/telemetry/record";
import { BUYER_REFERENCE_MAX, REPORT_DETAIL_MAX, REPORT_DETAIL_MIN } from "./accepted-record";
import { RELEASED_RECIPIENT } from "./release";

export { BUYER_REFERENCE_MAX, REPORT_DETAIL_MAX, REPORT_DETAIL_MIN };

/**
 * Board `7c` — the two things a buyer may write on their accepted record.
 *
 * Neither changes what was agreed. The lines, the price, the terms and the
 * supplier are the accepted `Quote` and are read-only to everybody. What the
 * buyer adds is their own label for the record, and a report about the supplier.
 * Both refuse unless the enquiry is the caller's and is accepted: the same three
 * conditions the loader reads with, in the same `where`.
 *
 * Board `1o` D4: an enquiry accepted across suppliers has a record per supplier,
 * each with its own PO number and its own report. Both writes take the record's
 * supplier, default to the main one, and refuse a supplier nothing was accepted
 * from.
 */

/** The caller's decided enquiry, with the suppliers its records are for. */
async function decidedEnquiry(buyerId: string, refOrId: string) {
  return prisma.enquiry.findFirst({
    where: {
      OR: [{ ref: refOrId }, { id: refOrId }],
      buyerId,
      contactReleasedToBusinessId: { not: null },
    },
    select: {
      id: true,
      contactReleasedToBusinessId: true,
      buyerCompany: { select: { requirePoNumber: true } },
      recipients: { where: RELEASED_RECIPIENT, select: { businessId: true } },
    },
  });
}

/** The record's supplier: the one named, or the main one — and only one accepted from. */
function recordSupplier(
  enquiry: NonNullable<Awaited<ReturnType<typeof decidedEnquiry>>>,
  businessId: string | undefined,
): string | null {
  const supplier = businessId ?? enquiry.contactReleasedToBusinessId;
  return supplier && enquiry.recipients.some((recipient) => recipient.businessId === supplier) ? supplier : null;
}

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
  /** Board `1o`: the record's supplier. The main one where not named. */
  businessId?: string;
}): Promise<ReferenceResult> {
  // A control character is a paste from somewhere that was not a text box.
  if (/[\u0000-\u001f\u007f]/.test(input.value)) {
    return { ok: false, error: "invalid" };
  }
  const normalised = input.value.replace(/\s+/g, " ").trim();
  if (normalised.length > BUYER_REFERENCE_MAX) return { ok: false, error: "too_long" };
  const buyerReference = normalised === "" ? null : normalised;

  const enquiry = await decidedEnquiry(input.buyerId, input.refOrId);
  const supplier = enquiry ? recordSupplier(enquiry, input.businessId) : null;
  if (!enquiry || !supplier) return { ok: false, error: "not_found" };

  /*
     Board `7b`. Where the enquiry's company requires a PO number, the
     reference is that PO number: it was asked for at acceptance and the
     supplier has it on the record, so it can be corrected but not removed.
  */
  if (buyerReference === null && enquiry.buyerCompany?.requirePoNumber) return { ok: false, error: "required" };

  /*
     The reference is the supplier's quote's since `1o` — after a split each
     supplier holds their own PO number. An enquiry accepted from one supplier
     keeps its own column in step, which is where every record before `1o`
     reads it from.
  */
  await prisma.$transaction([
    prisma.quote.updateMany({
      where: { enquiryId: enquiry.id, businessId: supplier, status: "accepted" },
      data: { buyerReference },
    }),
    ...(enquiry.recipients.length > 1
      ? []
      : [prisma.enquiry.update({ where: { id: enquiry.id }, data: { buyerReference } })]),
  ]);
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
 * One per enquiry and supplier, held by a unique index rather than a
 * read-then-write: two submits a second apart cannot both land, and the second
 * is told it already has. After a split that is one per record (board `1o` D4).
 */
export async function reportAcceptedQuote(input: {
  buyerId: string;
  refOrId: string;
  detail: string;
  /** Board `1o`: the record's supplier. The main one where not named. */
  businessId?: string;
}): Promise<ReportResult> {
  const detail = input.detail.trim();
  if (detail.length < REPORT_DETAIL_MIN) return { ok: false, error: "too_short" };
  if (detail.length > REPORT_DETAIL_MAX) return { ok: false, error: "too_long" };

  const enquiry = await decidedEnquiry(input.buyerId, input.refOrId);
  const supplier = enquiry ? recordSupplier(enquiry, input.businessId) : null;
  if (!enquiry || !supplier) return { ok: false, error: "not_found" };

  try {
    const report = await prisma.supplierReport.create({
      data: {
        subjectBusinessId: supplier,
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
      businessId: supplier,
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
