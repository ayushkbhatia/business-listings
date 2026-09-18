import type { $Enums } from "@/lib/db/generated/client";

/**
 * Board 4h `B6` — which reports are one work item, and which are not.
 *
 * *"Duplicate reports collapse to one work item with a count."* Three buyers
 * reporting one wrong telephone number is one thing to decide and three people
 * to answer. The grouping is `(business, kind, subjectField)`, and this is the
 * one place that says so — the queue collapses on it, `resolveReport` closes
 * the group on it, and the detail screen lists the group from it. Three readers
 * of one rule, because a fourth that disagreed would close reports nobody had
 * read.
 *
 * ## What never collapses, and why
 *
 * A report about a **specific record** — an enquiry or a review — is its own
 * work item however many of them a business has. Two buyers reporting the same
 * supplier after two different accepted quotes are two complaints about two
 * trades, and grouping them would close one buyer's case on the evidence of
 * another's. `SupplierReport.enquiryId` is unique for exactly that reason, and
 * `reviewId` names one buyer's published words.
 *
 * Refused by **kind** as well as by pointer, and that is not belt-and-braces.
 * The pointer is nullable — `SetNull` when the enquiry goes, and a row written
 * before it existed carries none — so a rule that read only the pointer would
 * quietly start grouping the one shape it was written to keep apart.
 *
 * A report with no `subjectField` never collapses either: there is nothing to
 * group on, and grouping everything about one business would put a stolen
 * photograph and a disconnected landline in the same row.
 */

export interface CollapsibleReport {
  id: string;
  kind: $Enums.ReportKind;
  subjectField: string | null;
  enquiryId?: string | null;
  reviewId?: string | null;
}

/**
 * The key two reports share when they are the same work item, or null when this
 * report stands alone. `businessId` is the caller's, because the queue already
 * has it in hand and the group is always inside one business.
 */
/** Kinds that are always about one record, whether or not the pointer survived. */
const NEVER_GROUPED: readonly $Enums.ReportKind[] = ["accepted_quote", "review_integrity"];

export function collapseKey(
  businessId: string,
  report: CollapsibleReport,
): string | null {
  if (NEVER_GROUPED.includes(report.kind)) return null;
  if (report.enquiryId || report.reviewId) return null;
  if (!report.subjectField) return null;
  return `${businessId}|${report.kind}|${report.subjectField}`;
}

/** True where a decision on one of these closes the rest of its group. */
export function collapses(report: CollapsibleReport): boolean {
  return collapseKey("x", report) !== null;
}

/**
 * Board 13c `B8` — who said it, as a key two reports share only when one
 * source said both.
 *
 * *"`Public ×3` is corroboration only if the three are three people."* An
 * account where there is one, the salted requester digest where there is not,
 * and the detector by name where the platform filed it: the shared-number sweep
 * files one finding per listing carrying the number, and three findings from
 * one sweep are one measurement, not three witnesses. A person's report filed
 * before the digest was stored is a source of its own, because there is
 * nothing to say it shares one.
 *
 * Read by the writer, to count the evidence line, and by the queue, to count
 * the flag. Two readers of one rule, so the line under the claim and the chip
 * beside it cannot disagree about how many people spoke.
 */
export function reportSource(row: {
  id: string;
  reporterId: string | null;
  reporterKey: string | null;
  detector?: string | null;
}): string {
  if (row.reporterId) return `user:${row.reporterId}`;
  if (row.detector) return `detector:${row.detector}`;
  if (row.reporterKey) return `key:${row.reporterKey}`;
  return `row:${row.id}`;
}

/** The value group two open reports share across listings, or null. */
export function valueGroupKey(report: {
  kind: $Enums.ReportKind;
  subjectField: string | null;
  subjectValueKey: string | null;
}): string | null {
  if (!report.subjectField || !report.subjectValueKey) return null;
  return `${report.kind}|${report.subjectField}|${report.subjectValueKey}`;
}
