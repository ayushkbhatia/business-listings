/**
 * Board 4g — the arithmetic of one month of revenue, with no database.
 *
 * Every figure the board states is computed here from inputs the board also
 * states, and every ratio has exactly one formula. That is the whole defence
 * against the failure the handoff names as this project's most reliable one: a
 * number nobody can re-derive from what is on the screen. The design's footnote
 * said *net revenue retention 104%* over a waterfall whose own lines make it
 * 98.6%, and nothing had been asked to agree with anything.
 *
 * `lib/billing/revenue-board.ts` reads the ledger and hands the rows to these
 * functions; `tests/unit/revenue-period.test.ts` holds them to the handoff's own
 * figures.
 *
 * ## Months are Dubai months
 *
 * A finance month in the UAE starts at midnight in Dubai, which is 20:00 UTC the
 * evening before. Dubai keeps no daylight saving, so the offset is a constant
 * and not a lookup. A UTC month would put every cancellation that lands in the
 * last four hours of a month into the next one.
 */

import type { MrrCause, MrrKind } from "./mrr";

const DUBAI_OFFSET = "+04:00";
const DAY_MS = 86_400_000;

// ── Periods ──────────────────────────────────────────────────────────────────

export interface RevenuePeriod {
  /** `2026-08`. What the URL and the export filename carry. */
  key: string;
  year: number;
  /** 1 to 12. */
  month: number;
  /** Midnight in Dubai on the first. */
  from: Date;
  /** Midnight in Dubai on the first of the next month. */
  monthEnd: Date;
  /** Where the figures stop: `monthEnd`, or now for the month in progress. */
  to: Date;
  /** The month is still running. Its figures are not comparable with a whole one. */
  partial: boolean;
  daysInMonth: number;
  /** Whole days reported. Equal to `daysInMonth` for a closed month. */
  daysElapsed: number;
}

function dubaiMonthStart(year: number, month: number): Date {
  // Month arithmetic through Date.UTC so December rolls into January.
  const normalised = new Date(Date.UTC(year, month - 1, 1));
  const y = normalised.getUTCFullYear();
  const m = String(normalised.getUTCMonth() + 1).padStart(2, "0");
  return new Date(`${y}-${m}-01T00:00:00${DUBAI_OFFSET}`);
}

/** The Dubai calendar month an instant falls in. */
export function dubaiMonthOf(instant: Date): { year: number; month: number } {
  const shifted = new Date(instant.getTime() + 4 * 3_600_000);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 };
}

function build(rawYear: number, rawMonth: number, now: Date): RevenuePeriod {
  // "The month before January" arrives as month 0. Normalised before anything
  // reads it, or the key reads `2027-00` while the dates say December.
  const normalised = new Date(Date.UTC(rawYear, rawMonth - 1, 1));
  const year = normalised.getUTCFullYear();
  const month = normalised.getUTCMonth() + 1;
  const from = dubaiMonthStart(year, month);
  const monthEnd = dubaiMonthStart(year, month + 1);
  const partial = now.getTime() < monthEnd.getTime();
  const to = partial ? now : monthEnd;
  const daysInMonth = Math.round((monthEnd.getTime() - from.getTime()) / DAY_MS);
  const daysElapsed = partial
    ? Math.min(daysInMonth, Math.max(1, Math.ceil((now.getTime() - from.getTime()) / DAY_MS)))
    : daysInMonth;
  return {
    key: `${year}-${String(month).padStart(2, "0")}`,
    year,
    month,
    from,
    monthEnd,
    to,
    partial,
    daysInMonth,
    daysElapsed,
  };
}

/** The month in progress. */
export function currentPeriod(now: Date = new Date()): RevenuePeriod {
  const { year, month } = dubaiMonthOf(now);
  return build(year, month, now);
}

/** The last whole month — what the board opens on, as the render draws it. */
export function lastClosedPeriod(now: Date = new Date()): RevenuePeriod {
  const { year, month } = dubaiMonthOf(now);
  return build(year, month - 1, now);
}

/**
 * Parses `2026-08`. Anything else, and any month that has not started, reads
 * as the last closed month rather than failing — a URL somebody edited should
 * land on a real report, not an error.
 */
export function periodFor(key: string | null | undefined, now: Date = new Date()): RevenuePeriod {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(key ?? "");
  if (!match) return lastClosedPeriod(now);
  const period = build(Number(match[1]), Number(match[2]), now);
  if (period.from.getTime() > now.getTime()) return lastClosedPeriod(now);
  return period;
}

/** The month before, for the comparisons under each figure. */
export function previousPeriod(period: RevenuePeriod, now: Date = new Date()): RevenuePeriod {
  return build(period.year, period.month - 1, now);
}

/** The month in progress and the `count - 1` before it, newest first. */
export function recentPeriods(count: number, now: Date = new Date()): RevenuePeriod[] {
  const { year, month } = dubaiMonthOf(now);
  return Array.from({ length: count }, (_, step) => build(year, month - step, now));
}

// ── Lines ────────────────────────────────────────────────────────────────────

/**
 * The waterfall's movement lines, in the order the board draws them.
 *
 * Seven, where the render has four, and each extra one is a place the four
 * would have told a story the ledger does not:
 *
 *   - **Came back** is kept out of *New subscriptions*, because counting a
 *     returning seller as new inflates the line the board exists to be honest
 *     about. Both sit outside the existing base, so NRR excludes both (B3).
 *   - **Billing term** is monthly-to-annual and back. It moves MRR, and it is
 *     not a customer choosing a bigger or smaller plan, so it is neither an
 *     upgrade nor a downgrade (§States, *a price change*).
 *   - **Lapsed after failed payments** is kept out of *Cancellations*. Both are
 *     churn once dunning completes (B8), but only a cancellation carries a
 *     reason, and the reasons panel sums to the cancellations line (criterion 5).
 *
 * A plan's list price is never on this list. `Plan.monthlyPriceAed` is edited
 * by nobody, and no writer records a movement for a price edit, so a rate change
 * cannot read as customer behaviour here — it would show as the reconciliation
 * warning instead, which is where it belongs.
 */
export const WATERFALL_LINES = [
  "new_business",
  "reactivation",
  "upgrades",
  "downgrades",
  "term_changes",
  "cancellations",
  "lapsed",
] as const;

export type WaterfallLine = (typeof WATERFALL_LINES)[number];

/** The lines from accounts that were not paying when the month began. B3. */
export const OUTSIDE_BASE_LINES: readonly WaterfallLine[] = ["new_business", "reactivation"];

export interface MovementFacts {
  kind: MrrKind;
  cause: MrrCause | null;
  fromPlanId: string | null;
  toPlanId: string | null;
  note: string | null;
}

/**
 * The cause of a movement, reading a null the way the migration's backfill did.
 *
 * Every row has one after `20261024090000_revenue_board_4g`; a null can only
 * come from a writer on the previous deploy inserting during the window before
 * this one went live. Written once, here, so the backfill and the reader cannot
 * disagree about what an unlabelled row was.
 */
export function causeOf(row: MovementFacts): MrrCause {
  if (row.cause) return row.cause;
  if (row.fromPlanId !== null && row.fromPlanId === row.toPlanId) return "term_change";
  if (row.kind === "churn" && row.note?.startsWith("Dunning drop")) return "dunning_drop";
  if (row.kind === "churn" && row.note?.startsWith("Cancellation")) return "cancellation";
  return "plan_change";
}

/** Which waterfall line a movement belongs on. Every movement has exactly one. */
export function lineOf(row: MovementFacts): WaterfallLine {
  const cause = causeOf(row);
  switch (row.kind) {
    case "new_business":
      return "new_business";
    case "reactivation":
      return "reactivation";
    case "churn":
      // A drop to Free from a plan change predates board 11f routing Free
      // through the cancel flow. It was a seller deciding to stop paying, which
      // is a cancellation, and it has no recorded reason.
      return cause === "dunning_drop" ? "lapsed" : "cancellations";
    case "expansion":
      return cause === "term_change" ? "term_changes" : "upgrades";
    case "contraction":
      return cause === "term_change" ? "term_changes" : "downgrades";
  }
}

export type Lines = Record<WaterfallLine, number>;

export function emptyLines(): Lines {
  return Object.fromEntries(WATERFALL_LINES.map((line) => [line, 0])) as Lines;
}

/** Sum signed deltas onto their lines. */
export function sumLines(rows: readonly (MovementFacts & { deltaFils: number })[]): Lines {
  const lines = emptyLines();
  for (const row of rows) lines[lineOf(row)] += row.deltaFils;
  return lines;
}

// ── Figures ──────────────────────────────────────────────────────────────────

export interface LedgerMonth {
  /** MRR when the month began: every movement before it, summed. */
  startingFils: number;
  /** Signed, per line. */
  lines: Lines;
  /** Accounts paying when the month began. */
  payingAtStart: number;
  /** Accounts paying when the figures stop. B7's denominator. */
  payingAtEnd: number;
  /** Distinct accounts whose churn was a cancellation, and a lapse. */
  cancelledAccounts: number;
  lapsedAccounts: number;
}

/**
 * B1: `ending = starting + new + came back + upgrades − downgrades ± term −
 * cancellations − lapsed`. Lines are signed, so the formula is a plain sum.
 */
export function endingFils(month: Pick<LedgerMonth, "startingFils" | "lines">): number {
  return WATERFALL_LINES.reduce((sum, line) => sum + month.lines[line], month.startingFils);
}

/** MRR the existing base kept: starting plus every line except new business. */
export function retainedFils(month: Pick<LedgerMonth, "startingFils" | "lines">): number {
  return WATERFALL_LINES.filter((line) => !OUTSIDE_BASE_LINES.includes(line)).reduce(
    (sum, line) => sum + month.lines[line],
    month.startingFils,
  );
}

/** Churned MRR: cancellations and lapses, as a positive amount. */
export function churnedFils(month: Pick<LedgerMonth, "lines">): number {
  const lost = month.lines.cancellations + month.lines.lapsed;
  // Not `-lost`: a month with no churn would be −0, and −0 prints as "-0.00%".
  return lost === 0 ? 0 : -lost;
}

export interface Ratios {
  /** `(ending − starting) ÷ starting`. Null on a month that started at nothing. */
  monthOnMonth: number | null;
  /** `retained ÷ starting`. B3: new subscriptions and returns are not in it. */
  nrr: number | null;
  /** `(cancellations + lapsed) ÷ starting MRR`. Q1, labelled as revenue churn. */
  revenueChurn: number | null;
  /** `accounts that churned ÷ accounts paying at the start`. Q1, beside it. */
  customerChurn: number | null;
  /** `ending MRR ÷ paying accounts at the end`, in fils. B4, B7. */
  arpaFils: number | null;
}

/**
 * The four ratios and the month-on-month, each from the one formula its card
 * prints.
 *
 * A percentage of nothing is not a percentage, so every one of them is null
 * rather than zero or infinity when its denominator is zero.
 */
export function ratiosOf(month: LedgerMonth): Ratios {
  const starting = month.startingFils;
  const ending = endingFils(month);
  return {
    monthOnMonth: starting === 0 ? null : (ending - starting) / starting,
    nrr: starting === 0 ? null : retainedFils(month) / starting,
    revenueChurn: starting === 0 ? null : churnedFils(month) / starting,
    customerChurn:
      month.payingAtStart === 0
        ? null
        : (month.cancelledAccounts + month.lapsedAccounts) / month.payingAtStart,
    arpaFils: month.payingAtEnd === 0 ? null : Math.round(ending / month.payingAtEnd),
  };
}

/**
 * What the footnote under the waterfall may say about the base, and nothing it
 * may not.
 *
 * The render's footnote also claimed upgrades "cluster in the two weeks after a
 * seller wins their first quote". Nothing in the tree measures that, so it is
 * not said. What is said is decided by the same numbers the formula beside it
 * prints.
 */
export type BaseStory = "grew" | "held" | "shrank_growth_from_new" | "shrank" | "unmeasured";

export function baseStoryOf(month: Pick<LedgerMonth, "startingFils" | "lines">): BaseStory {
  if (month.startingFils === 0) return "unmeasured";
  const retained = retainedFils(month);
  if (retained === month.startingFils) return "held";
  if (retained > month.startingFils) return "grew";
  return endingFils(month) > month.startingFils ? "shrank_growth_from_new" : "shrank";
}

// ── Placement ────────────────────────────────────────────────────────────────

export interface SlotFacts {
  monthlyPriceAed: number;
  startsOn: Date;
  endsOn: Date | null;
}

/**
 * What a sponsored slot was worth inside a period: its monthly price, pro rata
 * by the time it was live in the month.
 *
 * At the price on the slot row, which is what was sold. An annual account is
 * charged ten months for twelve on its placement as on its plan, and this does
 * not apply that — it is the value of the slot as sold, labelled on the card as
 * list price, not a figure from an invoice. B4: never added to MRR or ARPA.
 */
export function placementFils(slot: SlotFacts, period: Pick<RevenuePeriod, "from" | "to" | "monthEnd">): number {
  const start = Math.max(slot.startsOn.getTime(), period.from.getTime());
  const end = Math.min(slot.endsOn?.getTime() ?? Number.POSITIVE_INFINITY, period.to.getTime());
  if (end <= start) return 0;
  const monthMs = period.monthEnd.getTime() - period.from.getTime();
  return Math.round((slot.monthlyPriceAed * 100 * (end - start)) / monthMs);
}

// ── The reply-rate cross-reference ───────────────────────────────────────────

export interface ReplyFinding {
  /** Cancellations that gave *not enough enquiries*. */
  total: number;
  /** Of those, measured below the 4f threshold when they asked to cancel. */
  below: number;
  /** Of those, measured at or above it. */
  atOrAbove: number;
  /** Of those, with too few enquiries in the window to measure. */
  unmeasured: number;
}

export type ReplyFindingKind = "none" | "below" | "none_below" | "all_unmeasured";

export function replyFindingKind(finding: ReplyFinding): ReplyFindingKind {
  if (finding.total === 0) return "none";
  if (finding.below > 0) return "below";
  if (finding.atOrAbove > 0) return "none_below";
  return "all_unmeasured";
}
