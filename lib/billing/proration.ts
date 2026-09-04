/**
 * What a plan change costs today.
 *
 * Periods are not always months. A subscription paid yearly has a period of a
 * year, and every figure below is per *period* — the price it costs, the days
 * it runs, and the rate a day of it is worth. `periodDays` says which.
 *
 * Criterion 10: "plan change prorates correctly and unlocks entitlements within
 * a minute". This is the first half, and it is pure so that the number on the
 * screen and the number on the invoice come from one place.
 *
 * Money is whole fils — integers — for the same reason `lib/quote/money.ts` is:
 * a proration is a division, and a division in floats produces 349.00000000004
 * often enough to matter on an invoice a supplier keeps for their accountant.
 * AED prices arrive as whole dirhams on the `Plan` row, so the conversion is
 * exact.
 *
 * The rule, stated plainly because a seller will ask:
 *
 *   - Unused days on the old plan are credited.
 *   - The remaining days on the new plan are charged.
 *   - The renewal date does not move. A change on the 12th does not restart the
 *     month; it swaps what is being paid for over the days that were left.
 *
 * A downgrade therefore usually produces a credit, and the credit is applied to
 * the next invoice rather than paid out — CLAUDE.md is explicit that this
 * platform holds no funds and refunds none. `subscription_credit` already
 * exists as an `InvoiceLineKind` for exactly this.
 */

export const FILS_PER_AED = 100;
const MS_PER_DAY = 86_400_000;

export interface ProrationInput {
  /**
   * Whole dirhams for the period being left — not necessarily a month.
   *
   * An annual subscription pays for a year in one go, so the figure a credit is
   * computed from is the year's price and the divisor is the year's length.
   */
  fromPeriodAed: number;
  toPeriodAed: number;
  /**
   * Real length of the period, from `periodDays()` in `./period`.
   *
   * This was optional and defaulted to thirty, and no caller ever passed it.
   * That default is a trap rather than a convenience: on a yearly period it
   * credits a downgrade roughly twelve times over, silently, in the seller's
   * favour on an invoice they keep. Required now, so nobody can assume a month
   * by omission.
   */
  periodDays: number;
  /** When the current period ends. Unchanged by a plan switch. */
  renewsAt: Date;
  /** When the change happens. */
  now: Date;
}

export interface ProrationLine {
  kind: "credit" | "charge";
  /** Whole fils. Positive on both kinds; `kind` carries the direction. */
  fils: number;
  days: number;
  /** Whole fils a day on the plan this line is about. */
  perDayFils: number;
}

export interface Proration {
  creditLine: ProrationLine;
  chargeLine: ProrationLine;
  /** Positive means the seller owes; negative means they are in credit. */
  netFils: number;
  daysRemaining: number;
  renewsAt: Date;
}

/**
 * Whole days left, floored, and never negative.
 *
 * Floored rather than rounded because a part-day charged as a whole day is a
 * seller paying for time they did not get, and the direction to be wrong in is
 * the one that favours them. Never negative because a subscription past its
 * renewal date is a billing problem, not a reason to invoice backwards.
 */
export function daysRemaining(now: Date, renewsAt: Date): number {
  return Math.max(0, Math.floor((renewsAt.getTime() - now.getTime()) / MS_PER_DAY));
}

/** Whole fils a day. Floored, so a rounding error never favours us. */
export function perDayFils(periodAed: number, periodDays: number): number {
  if (periodDays <= 0) return 0;
  return Math.floor((periodAed * FILS_PER_AED) / periodDays);
}

export function prorate(input: ProrationInput): Proration {
  const { periodDays } = input;
  const days = daysRemaining(input.now, input.renewsAt);

  const fromPerDay = perDayFils(input.fromPeriodAed, periodDays);
  const toPerDay = perDayFils(input.toPeriodAed, periodDays);

  const creditLine: ProrationLine = {
    kind: "credit",
    fils: fromPerDay * days,
    days,
    perDayFils: fromPerDay,
  };
  const chargeLine: ProrationLine = {
    kind: "charge",
    fils: toPerDay * days,
    days,
    perDayFils: toPerDay,
  };

  return {
    creditLine,
    chargeLine,
    netFils: chargeLine.fils - creditLine.fils,
    daysRemaining: days,
    // Unchanged. A change on the 12th does not restart the month.
    renewsAt: input.renewsAt,
  };
}

/** "349.00" from 34900 fils. Never a float in the middle. */
export function filsToAed(fils: number): string {
  const sign = fils < 0 ? "-" : "";
  const absolute = Math.abs(fils);
  return `${sign}${Math.floor(absolute / FILS_PER_AED)}.${String(absolute % FILS_PER_AED).padStart(2, "0")}`;
}
