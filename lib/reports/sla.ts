import { REPORT_TYPES, type ReportType } from "./taxonomy";

/**
 * Board 4h `B4` — a service level per type, and an age colour derived from it.
 *
 * The board draws `6 h` redder than `2 d 4 h`. That is either wrong or it
 * implies a per-type clock, and the spec's own flag says the clock *"is nowhere
 * written down"*. It is here now, and the colour is computed from it: nothing
 * on this screen sets a tone by hand, so a fraud report at six hours is red
 * because six hours is late for fraud and not because somebody typed red.
 *
 * ## Where the numbers come from
 *
 * Two are already promised in shipped copy and are read from it rather than
 * chosen again:
 *
 *   - **A review dispute is two days.** `11c`'s rail tells a seller *"decided by
 *     our team in about 2 working days"*. A queue whose service level disagrees
 *     with the sentence the seller was shown is a queue that will miss it.
 *   - **Off-platform payment is one day.** Board 4h's own render puts the
 *     shortest clock on the fraud row, and the reason holds: a buyer is being
 *     asked to send money to an account they have no record with, and every
 *     hour it stands is an hour somebody can lose a deposit.
 *
 * The rest are set against what the delay costs somebody outside the building,
 * the same principle `SLA_DAYS` in `lib/console/overview.ts` states for the
 * approval queue — and that file now reads `report` from here, so the console's
 * *past their service level* figure and this board's *over SLA* badge cannot
 * disagree.
 *
 * Pure. The queue, the console, the rail and the tests all read this, and none
 * of them may hold its own copy.
 */

const HOUR_MS = 3_600_000;

/**
 * Hours, not days. `off_platform_payment` is measured in hours and a table in
 * days would have to round it to zero or to one, neither of which is what it
 * is.
 */
export const REPORT_SLA_HOURS = {
  /* Money steered off the record, before the buyer has chosen anybody. */
  off_platform_payment: 24,
  /* `11c`'s shipped promise to a seller: about two working days. */
  review_dispute: 48,
  /* Somebody else's photograph on a listing that is selling against them. */
  content: 72,
  /* A conduct report after an accepted quote. The argument is already running. */
  accepted_quote: 72,
  /* A unit buyers are enquiring into that is not there any more. */
  closed: 72,
  /* Two companies on one listing. Board 4b decides it; this is the legacy row. */
  claim_conflict: 72,
  /* Our own finding about a review. Nobody outside is waiting on it. */
  review_integrity: 120,
  /* A wrong telephone number. Costly, and not costly by the hour. */
  wrong_details: 120,
  /* A listing filed under the wrong trade. */
  wrong_trade: 120,
} as const satisfies Record<ReportType, number>;

export function slaMsFor(type: ReportType): number {
  return REPORT_SLA_HOURS[type] * HOUR_MS;
}

/** The longest and the shortest, for copy that has to describe the spread. */
export const SLOWEST_REPORT_SLA_DAYS = Math.max(
  ...REPORT_TYPES.map((type) => REPORT_SLA_HOURS[type] / 24),
);
export const FASTEST_REPORT_SLA_DAYS = Math.min(
  ...REPORT_TYPES.map((type) => REPORT_SLA_HOURS[type] / 24),
);

/**
 * Three states, and the middle one is the point.
 *
 * `late` is past the service level. `due` is inside the last quarter of it —
 * the window where a moderator can still make it, which is the only window
 * where knowing is useful. A queue that only marks what is already late is a
 * queue that reports failures rather than preventing them.
 */
export type SlaState = "ok" | "due" | "late";

/** The share of the window left when a row starts saying it is due. */
const DUE_AT = 0.75;

export function slaStateOf(waitingMs: number, slaMs: number): SlaState {
  if (waitingMs >= slaMs) return "late";
  if (waitingMs >= slaMs * DUE_AT) return "due";
  return "ok";
}

/**
 * The tone the age cell takes, and never a tone anything else sets.
 *
 * `info` rather than `default` for `ok` so that every row's age carries a
 * deliberate tone rather than an absence of one — the design system's rule is
 * that status is never a bare colour, and each of these renders beside a word.
 */
export function slaTone(state: SlaState): "bad" | "warn" | "neutral" {
  return state === "late" ? "bad" : state === "due" ? "warn" : "neutral";
}

/** How long is left, or how long it is over by. Negative means late. */
export function slaRemainingMs(waitingMs: number, slaMs: number): number {
  return slaMs - waitingMs;
}
