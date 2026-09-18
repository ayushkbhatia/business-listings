import { formatDate } from "@/lib/format";
import type { ReportSubjectField } from "./taxonomy";

/**
 * Board 13c `B2` and `B3` — the line under the claim, composed rather than typed.
 *
 * `4h` calls the evidence line *the best thing on the board*: every row carries
 * what the platform already knows, in mono under the complaint, so a moderator
 * opens it knowing why it is there. Until board 13c only the detectors wrote
 * one — a report filed by a person arrived with an empty column, which is the
 * one kind of row where a moderator has nothing but somebody's word.
 *
 * Two facts, measured at the moment of filing:
 *
 *   1. **How far it spreads.** `Same number on 4 listings` — `B2`'s aggregation
 *      by value, and the fact that turns three complaints into one finding.
 *   2. **What the licence record says.** `B3`, and the promise printed on the
 *      modal: *we check every report against the licence record.* A promise
 *      that produces no artefact is a promise nobody can audit, so every report
 *      carries the answer whether or not it is interesting.
 *
 * ## What is not stored: how many people said it
 *
 * The board's row leads with `3 SEPARATE REPORTS`, and the queue prints that —
 * but from a live count, not from this column. A count written at filing is
 * the count *then*: the first report of three would say nothing forever, and a
 * report decided this morning would still be counted in yesterday's line. So
 * `lib/reports/queue.ts` counts distinct sources over the open group on every
 * read and prefixes it, and this line holds only what does not go stale in an
 * hour.
 *
 * Pure, and free of `server-only`, for the same reason `detector-rules.ts` is:
 * `lib/reports/detectors.ts` reads `licenceWords` from here and the seed runs
 * that on its own client.
 */

const DAY_MS = 86_400_000;
const MONTH_DAYS = 30;

/**
 * Board 13c — three reports flag a listing.
 *
 * The modal's footer promises a threshold, and this is it. Three rather than
 * two because two is a coincidence a directory of 41,200 listings produces
 * daily, and because `4h`'s own rows are `Public ×3` and `Public ×2` — the
 * first is a finding and the second is a pair of people who both noticed.
 *
 * Nothing stored. The count is a query over the open reports in the group, so
 * a listing that is flagged is one that is flagged *now*, and a report decided
 * this morning takes its corroboration with it. `docs/design-system.md` §
 * interface honesty: every number is a query, not a constant.
 */
export const AUTO_FLAG_AT = 3;

/** How close to expiry a licence has to be before the line bothers to say so. */
const EXPIRING_SOON_DAYS = 60;

/**
 * The noun a shared value is counted in.
 *
 * `Same number on 4 listings`, not `Same phone on 4 listings`: the board writes
 * the first and a moderator says the first. `licence` takes two words because
 * "same licence on 4 listings" reads as a licence class rather than a number.
 */
const VALUE_NOUN: Partial<Record<ReportSubjectField, string>> = {
  phone: "number",
  address: "address",
  name: "name",
  website: "website",
  licence: "licence number",
};

/**
 * What the licence record says today, in one clause.
 *
 * Sentence case, because the mono style that renders it upper-cases in CSS and
 * a string stored in capitals is a string that cannot be read anywhere else.
 */
export function licenceWords(expiry: Date, now: Date): string {
  const days = Math.floor((now.getTime() - expiry.getTime()) / DAY_MS);
  if (days >= 0) {
    const months = Math.floor(days / MONTH_DAYS);
    if (months >= 2) return `Licence expired ${months} months ago`;
    if (months === 1) return "Licence expired a month ago";
    return days === 0 ? "Licence expired today" : `Licence expired ${days} days ago`;
  }
  const until = -days;
  if (until <= EXPIRING_SOON_DAYS) {
    return until === 1 ? "Licence expires tomorrow" : `Licence expires in ${until} days`;
  }
  return `Licence valid to ${formatDate(expiry)}`;
}

/** True where the licence is the fact rather than the footnote. */
function licenceIsNotable(expiry: Date, now: Date): boolean {
  return expiry.getTime() - now.getTime() <= EXPIRING_SOON_DAYS * DAY_MS;
}

export interface EvidenceInput {
  field: ReportSubjectField | null;
  /** How many distinct listings publish the value, among open reports about it. */
  listings: number;
  /** The subject's trade licence. Always read; `B3`. */
  licenceExpiry: Date | null;
  now: Date;
}

/**
 * The line, or null when there is genuinely nothing measured to say.
 *
 * Null rather than an empty string: `SupplierReport.evidence` is nullable and
 * the detail screen renders the paragraph only when there is one, so an empty
 * string would draw an empty mono row that looks like a failed lookup.
 */
export function evidenceLine(input: EvidenceInput): string | null {
  const parts: string[] = [];

  const noun = input.field ? VALUE_NOUN[input.field] : undefined;
  if (noun && input.listings >= 2) parts.push(`Same ${noun} on ${input.listings} listings`);

  if (input.licenceExpiry) {
    const words = licenceWords(input.licenceExpiry, input.now);
    /*
       The licence clause earns its place when it is news, and takes the empty
       line when there is no other news — so a report always shows that the
       check ran, and a report with something better to say does not spend its
       line on `Licence valid to 12 Mar 2027`.
    */
    if (licenceIsNotable(input.licenceExpiry, input.now) || parts.length === 0) parts.push(words);
  }

  return parts.length === 0 ? null : parts.join(" · ");
}

/** True where a group has reached the threshold the modal's footer promises. */
export function isFlagged(reports: number): boolean {
  return reports >= AUTO_FLAG_AT;
}
