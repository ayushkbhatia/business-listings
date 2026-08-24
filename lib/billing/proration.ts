/**
 * What a plan change costs today.
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
  /** Whole dirhams a month, from the Plan row. */
  fromMonthlyAed: number;
  toMonthlyAed: number;
  /** When the current period ends. Unchanged by the switch. */
  renewsAt: Date;
  /** When the change happens. */
  now: Date;
  /** Length of the billing period. Thirty days unless the caller knows better. */
  periodDays?: number;
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
export function perDayFils(monthlyAed: number, periodDays: number): number {
  if (periodDays <= 0) return 0;
  return Math.floor((monthlyAed * FILS_PER_AED) / periodDays);
}

export function prorate(input: ProrationInput): Proration {
  const periodDays = input.periodDays ?? 30;
  const days = daysRemaining(input.now, input.renewsAt);

  const fromPerDay = perDayFils(input.fromMonthlyAed, periodDays);
  const toPerDay = perDayFils(input.toMonthlyAed, periodDays);

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
