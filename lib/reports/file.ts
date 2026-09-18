import "server-only";
import { prisma } from "@/lib/db/client";
import { Prisma } from "@/lib/db/generated/client";
import { checkRate, recordHit, requesterKey, retryAfterSeconds } from "@/lib/rate-limit";
import { evidenceLine } from "./evidence";
import { newReference } from "./reference";
import { currentValue, fieldsFor, reportSubject } from "./subject";
import {
  isPublicReportKind,
  isReportSubjectField,
  MAX_CORRECTION,
  takesCorrection,
  type PublicReportKind,
  type ReportSubjectField,
} from "./taxonomy";
import { subjectValueKey } from "./value-key";

/**
 * Boards 4h and 13c — the public's way into this queue.
 *
 * The storefront has carried *Report this listing* since it shipped, twice: on
 * the unclaimed panel and in the verification rail. Both pointed at
 * `/verification-policy`, a page of prose. So the queue board 4h works had
 * exactly one producer — the off-platform message detector — and four of the
 * eight `ReportKind`s had none at all, which is why two of the board's own
 * drawn rows (`Public ×3`, `Public ×2`) could not have existed.
 *
 * Board 13c is the modal that now sits over the storefront, and its export
 * made two corrections, both about what this function failed to keep:
 *
 *   1. **The value, not only the field** (`B1`, `B2`). A report names the field
 *      and, where the field carries one, the value the listing publishes —
 *      read here from the listing, normalised, never taken from the form. The
 *      reporter may add what it *should* say. Three reports about one number
 *      on four listings is then one finding with a count, which is the row `4h`
 *      draws and could not produce.
 *   2. **Somebody to tell** (`B4`, `B5`). Every report gets a reference, and a
 *      signed-out reporter may leave an address. Without one of the two there
 *      is nobody `onReportResolved` can write to, which is `4h`'s `Q5`.
 *
 * ## Signed out is allowed, and says so
 *
 * The person who notices that a landline rings a different company is a buyer
 * who has just tried to call it, and requiring an account there is requiring an
 * account to do us a favour (`B12`).
 *
 * ## One source is one signal (`B8`)
 *
 * *"`Public ×3` is corroboration only if the three are three people."* A second
 * report from the same source about the same field of the same listing, while
 * the first is open, is refused rather than counted: a signed-in reporter by
 * account, a signed-out one by the salted digest of their address. The limiter
 * then caps a source at six an hour and a **listing** at twelve, so forty
 * addresses cannot bury a competitor either.
 *
 * ## What it cannot do (`B11`)
 *
 * It cannot change the listing. It cannot set an outcome, an assignee, a
 * detector, a value key or an evidence line. A report arrives as a claim;
 * everything the platform knows about it is measured on the way past, by this
 * function and by the queue, and nothing a form posts can write into those
 * columns.
 */

export const MAX_DETAIL = 1200;
/** RFC 5321's path limit. Anything longer is not an address a carrier accepts. */
export const MAX_EMAIL = 254;

/**
 * The shape the database's `supplier_report_reporter_email_shape` check holds
 * the column to. Deliberately loose: a regular expression that refuses a real
 * mailbox is worse than one that lets a mistyped one through, because the
 * mistyped one costs one undelivered message and the refused one costs the
 * report.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type FileReportError =
  | "not_found"
  | "invalid_kind"
  | "invalid_field"
  | "detail_too_long"
  | "correction_too_long"
  | "invalid_category"
  | "invalid_email"
  | "already_reported"
  | "rate_limited"
  | "listing_rate_limited";

export type FileReportResult =
  | {
      ok: true;
      reportId: string;
      reference: string;
      /** A reply can reach them: an account, or an address they left. */
      willHearBack: boolean;
      /** The address it will reach, where they left one, for the confirmation to repeat. */
      replyTo: "account" | "email" | null;
    }
  | { ok: false; error: FileReportError; retryAfterS?: number };

export interface FileReportInput {
  slug: string;
  kind: string;
  /**
   * The field it is about. Required where the listing offers more than one
   * under this kind; filled in here where it offers exactly one, because a
   * select with a single option is a question with its answer printed on it.
   */
  field: string | null;
  /** Anything that helps us check. Optional — board 13c draws it so. */
  detail: string | null;
  /** `B1` — what it should say. Only kept where the field takes one. */
  correction?: string | null;
  /** `B9` — the trade it should be. Only kept for `wrong_trade` on the category. */
  suggestedCategoryId?: string | null;
  /** `B4` — where to write back. Only kept when nobody is signed in. */
  reporterEmail?: string | null;
  /** The signed-in reporter, or null for a member of the public. */
  reporterId: string | null;
  /** Pre-computed in tests; derived from the request otherwise. */
  requester?: string;
}

/** Trimmed, or null when nothing is left. */
function optional(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

export async function fileListingReport(
  input: FileReportInput,
  now = new Date(),
): Promise<FileReportResult> {
  if (!isPublicReportKind(input.kind)) return { ok: false, error: "invalid_kind" };
  const kind: PublicReportKind = input.kind;

  const detail = optional(input.detail);
  if (detail && detail.length > MAX_DETAIL) return { ok: false, error: "detail_too_long" };

  /*
     An address is kept only where it is the only way back. A signed-in
     reporter is written to on their account, where the reply also appears in
     their inbox; storing a second address beside it would be holding personal
     data for no purpose — and it would be the one the business never sees and
     the reporter forgets they gave.
  */
  const email = input.reporterId ? null : optional(input.reporterEmail)?.toLowerCase() ?? null;
  if (email && (email.length > MAX_EMAIL || !EMAIL_SHAPE.test(email))) {
    return { ok: false, error: "invalid_email" };
  }

  const subject = await reportSubject(input.slug);
  if (!subject) return { ok: false, error: "not_found" };

  /*
     The field, against what this listing actually shows — the same answer the
     form was built from, so a field the listing lost between the page loading
     and this write is refused rather than filed about nothing.

     Where exactly one is left it is filled in. `closed` is always the licence
     record, and *Not this trade* on a listing with no description is always
     the category; asking would be asking somebody to confirm the only option.
  */
  const offered = fieldsFor(subject, kind);
  const posted: ReportSubjectField | null =
    input.field && isReportSubjectField(input.field) ? input.field : null;
  /*
     A field that was posted and does not belong is refused, never swapped for
     the one that does: a report about the telephone filed as a report about
     the licence would be a claim nobody made.
  */
  if (input.field && (!posted || !offered.includes(posted))) {
    return { ok: false, error: "invalid_field" };
  }
  const field: ReportSubjectField | null = posted ?? (offered.length === 1 ? offered[0]! : null);
  if (!field) return { ok: false, error: "invalid_field" };

  const correction = takesCorrection(field) ? optional(input.correction) : null;
  if (correction && correction.length > MAX_CORRECTION) {
    return { ok: false, error: "correction_too_long" };
  }

  /*
     `B9`. A node from `4d`'s tree, and not the one the listing is already
     filed under — *it should be the trade it is* is not a correction, and a
     moderator reading it would be reading a mis-tap as a claim.
  */
  let suggestedCategoryId: string | null = null;
  const categoryId = kind === "wrong_trade" && field === "category" ? optional(input.suggestedCategoryId) : null;
  if (categoryId) {
    if (categoryId === subject.primaryCategoryId) return { ok: false, error: "invalid_category" };
    const category = await prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true, showInIndex: true },
    });
    if (!category || !category.showInIndex) return { ok: false, error: "invalid_category" };
    suggestedCategoryId = category.id;
  }

  const identifier = input.requester ?? (await requesterKey(input.reporterId));

  /*
     One open report per source, business and field (`B8`).

     Not a rate limit — a rate limit is about cost, and this is about the
     record. Somebody pressing the button again a week later has not found a
     second problem, and two open rows would collapse into one work item
     carrying a count of two that means one person twice.

     Signed in, the source is the account. Signed out, it is the digest of the
     address — which an office behind one NAT shares, and the refusal says so
     rather than telling a colleague they reported something they did not.
  */
  const existing = await prisma.supplierReport.findFirst({
    where: {
      subjectBusinessId: subject.id,
      kind,
      subjectField: field,
      outcome: null,
      ...(input.reporterId ? { reporterId: input.reporterId } : { reporterKey: identifier }),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  if (existing) return { ok: false, error: "already_reported" };

  const [bySource, byListing] = await Promise.all([
    checkRate("listing_report", identifier, now),
    checkRate("listing_report_subject", subject.id, now),
  ]);
  if (!bySource.allowed) {
    return { ok: false, error: "rate_limited", retryAfterS: retryAfterSeconds(bySource) };
  }
  if (!byListing.allowed) {
    return { ok: false, error: "listing_rate_limited", retryAfterS: retryAfterSeconds(byListing) };
  }
  await Promise.all([
    recordHit("listing_report", identifier),
    recordHit("listing_report_subject", subject.id),
  ]);

  /* `B2` — the value, read from the listing and never from the form. */
  const value = currentValue(subject, field);
  const valueKey = subjectValueKey(field, value);

  /*
     `B2` and `B3` — the measurement, written now: how many listings carry this
     value among the open reports about it, and what the licence record says.
     How many *people* said it is counted live by the queue rather than frozen
     here — see `lib/reports/evidence.ts`.
  */
  const spread = valueKey
    ? await prisma.supplierReport.groupBy({
        by: ["subjectBusinessId"],
        where: { kind, subjectField: field, subjectValueKey: valueKey, outcome: null },
      })
    : [];
  const listings = new Set(spread.map((row) => row.subjectBusinessId));
  listings.add(subject.id);

  const evidence = evidenceLine({
    field,
    listings: listings.size,
    licenceExpiry: subject.licenceExpiry,
    now,
  });

  const report = await createWithReference({
    subjectBusinessId: subject.id,
    reporterId: input.reporterId,
    reporterKey: identifier,
    reporterEmail: email,
    kind,
    subjectField: field,
    subjectValueKey: valueKey,
    subjectValue: valueKey ? value : null,
    suggestedValue: correction,
    suggestedCategoryId,
    detail,
    evidence,
    createdAt: now,
  });

  const replyTo = input.reporterId ? ("account" as const) : email ? ("email" as const) : null;
  return {
    ok: true,
    reportId: report.id,
    reference: report.reference,
    willHearBack: replyTo !== null,
    replyTo,
  };
}

/**
 * The insert, with a reference, retried on the one-in-a-trillion clash.
 *
 * Forty bits across a queue that will hold thousands of rows makes a collision
 * a curiosity rather than a risk, and the unique index turns one into an error
 * rather than two reporters sharing a number. Three attempts, then the error
 * surfaces, because a fourth clash means the generator is broken rather than
 * unlucky.
 */
async function createWithReference(
  data: Omit<Prisma.SupplierReportUncheckedCreateInput, "reference">,
): Promise<{ id: string; reference: string }> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.supplierReport.create({
        data: { ...data, reference: newReference() },
        select: { id: true, reference: true },
      });
    } catch (cause) {
      /*
         Any unique violation here is the reference. The table's other unique
         columns are the id, which Prisma generates, and `enquiry_id`, which a
         public report never sets — and the driver adapter does not always name
         the constraint in `meta`, so matching on its name would be matching on
         something that is sometimes not there.
      */
      const clash =
        cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002";
      if (!clash || attempt >= 2) throw cause;
    }
  }
}
