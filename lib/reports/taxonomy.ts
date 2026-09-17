import type { $Enums } from "@/lib/db/generated/client";

/**
 * Board 4h `B3` — one taxonomy.
 *
 * The board's header counted *14 supplier reports · 23 reviews · 9 listings* —
 * three buckets, 46 items — over a `TYPE` column naming five values, of which
 * three had no home in the header. `11c`'s acceptance criterion 5 is the house
 * rule this breaks: **every count in the header reconciles with the list
 * beneath it.**
 *
 * So there is one list of types, and it is this one. The header counts these,
 * the chips filter on these, and the `TYPE` column prints these. Nothing on the
 * screen may count anything else.
 *
 * ## Why a review dispute is a type here and a different table underneath
 *
 * `ReviewDispute` is its own table for the reasons `lib/reviews/disputes.ts`
 * sets out — filed *by* a business rather than against one, four fixed grounds,
 * two outcomes rather than three. None of that is visible from the moderator's
 * side of the desk, where it is one more thing in the morning's queue. So the
 * taxonomy is the moderator's, the tables stay honest, and `lib/reports/queue.ts`
 * is the one place that joins them.
 *
 * ## `claim_conflict`
 *
 * Kept, counted, and never produced. Two companies claiming one listing is
 * decided on `/admin/queue?kind=conflict`, where board 4b has the evidence, the
 * checks and `claim.resolve` behind it. The chip is here so that a legacy row
 * cannot become invisible, and the rail says where the decision actually lives
 * — which is the `12c` rule this board is otherwise about: one outcome, one
 * route to it.
 */

export type ReportKind = $Enums.ReportKind;

/** The extra type, which is a `ReviewDispute` rather than a `SupplierReport`. */
export const REVIEW_DISPUTE = "review_dispute";

export const REPORT_TYPES = [
  /* Money being steered off the record. The shortest clock on the board. */
  "off_platform_payment",
  /* A buyer who accepted a quote and is reporting the supplier who sent it. */
  "accepted_quote",
  /* A seller's formal claim that a review should not stand. */
  REVIEW_DISPUTE,
  /* Our own finding about a review — an incentive offered, a pattern matched. */
  "review_integrity",
  "content",
  "wrong_details",
  "closed",
  "wrong_trade",
  "claim_conflict",
] as const;

export type ReportType = (typeof REPORT_TYPES)[number];

export function isReportType(value: string): value is ReportType {
  return (REPORT_TYPES as readonly string[]).includes(value);
}

/** The eight that are rows in `supplier_report`. */
export function isReportKind(value: ReportType): value is ReportKind {
  return value !== REVIEW_DISPUTE;
}

/**
 * The kinds a person may file from the public form, in the order it lists them.
 *
 * `off_platform_payment` and `accepted_quote` are absent because they have
 * their own producers — a detector reading a message, and the accepted-record
 * screen a buyer reaches from their own enquiry. `review_integrity` is a staff
 * finding and `review_dispute` is a seller's, both from their own screens.
 * `claim_conflict` is board 4b's.
 *
 * Which leaves the four the board's own queue is mostly made of, and which had
 * no producer at all: the storefront's two *Report this listing* links have
 * pointed at `/verification-policy` — a page of prose — since the storefront
 * shipped.
 */
export const PUBLIC_REPORT_KINDS = [
  "wrong_details",
  "closed",
  "wrong_trade",
  "content",
] as const satisfies readonly ReportKind[];

export type PublicReportKind = (typeof PUBLIC_REPORT_KINDS)[number];

export function isPublicReportKind(value: string): value is PublicReportKind {
  return (PUBLIC_REPORT_KINDS as readonly string[]).includes(value);
}

/**
 * Which field a public report is about, where the kind implies one.
 *
 * `subjectField` feeds two things: the three-strikes prior count, and the
 * collapse in `B6`. Both are only as good as the field being the same string
 * every time one is filed, so the form picks from this rather than taking free
 * text — three buyers writing "phone", "telephone" and "landline" would be
 * three separate problems to the queue and one to the building.
 */
export const REPORT_SUBJECT_FIELDS = [
  "phone",
  "address",
  "website",
  "name",
  "category",
  "photo",
  "description",
  "hours",
] as const;

export type ReportSubjectField = (typeof REPORT_SUBJECT_FIELDS)[number];

export function isReportSubjectField(value: string): value is ReportSubjectField {
  return (REPORT_SUBJECT_FIELDS as readonly string[]).includes(value);
}

/** The fields each public kind may name. A closed unit is not about a photo. */
export const FIELDS_FOR_KIND: Record<PublicReportKind, readonly ReportSubjectField[]> = {
  wrong_details: ["phone", "address", "website", "name", "hours"],
  closed: ["address"],
  wrong_trade: ["category", "description"],
  content: ["photo", "description"],
};
