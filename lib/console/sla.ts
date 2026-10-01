import { SLOWEST_REPORT_SLA_DAYS } from "@/lib/reports/sla";
import { CREDENTIAL_REVIEW_DAYS } from "@/lib/verification";

/**
 * How long a row may sit before it is late, in days.
 *
 * These are ours, not the design system's — no board states them. They are set
 * against what the delay costs somebody outside the building: a buyer waiting
 * on a contested listing is the most expensive, an unanswered supplier report
 * next, a taxonomy edit least. Change them here and every screen moves.
 *
 * Board 4b reads them per kind (`SLA_MS` in `lib/moderation/queue.ts`) and
 * board 4a prints them under *Needs a human today*. Their own module, and a
 * leaf, because the overview reads the queue: kept in `lib/console/overview.ts`
 * they made the two import each other.
 */
export const SLA_DAYS = {
  /** A seller's trade name is wrong on a public page while this waits. */
  moderation: 2,
  /** Two companies both think they own a listing, and buyers are enquiring. */
  claim: 3,
  /**
   * Somebody reported a supplier. The slowest of board 4h's per-type clocks;
   * the per-type figures — a day for off-platform payment, two for a review
   * dispute — are in `lib/reports/sla.ts`.
   */
  report: SLOWEST_REPORT_SLA_DAYS,
  /** A payment failed. D14 is when the plan drops, so 14 is the deadline. */
  dunning: 14,
  /**
   * A credential a seller has asked to publish. Board 3e §4 states this on the
   * seller's own screen, which makes it copy rather than configuration — so it
   * is read from `lib/verification.ts`, where the screen reads it too.
   */
  credential: CREDENTIAL_REVIEW_DAYS,
} as const;
