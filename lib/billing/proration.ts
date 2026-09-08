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
 * ## This prices upgrades, and only upgrades
 *
 * Board 11f settles the other direction: **a downgrade takes effect at the end
 * of the period**, so there is nothing to pro-rate. The seller keeps what they
 * paid for until the date, the new price starts on the renewal, and `Due today`
 * reads `AED 0.00`.
 *
 * That is a change from what this module used to serve. A downgrade applied
 * on the day produced a credit for the unused half-month, and a credit on a
 * platform that holds no funds has nowhere to go but the next invoice — so the
 * seller lost the plan immediately and got the money back a month later. Waiting
 * costs nobody anything and needs no `subscription_credit` line at all.
 *
 * A term change is still both directions and still pro-rates, because a year
 * cannot be part-way through a month: see `changeTerm` in ./service.
 */

export const FILS_PER_AED = 100;
const MS_PER_DAY = 86_400_000;

/**
 * UAE output VAT, as a rate.
 *
 * The default a new invoice is stamped with, and the figure a preview quotes
 * before an invoice exists. Once an invoice is issued the rate it carries is
 * `Invoice.vatRate` and nothing re-reads this — a rate change must not move a
 * document that has already been sent, which is why `vatReturn` reads the stored
 * column line by line.
 *
 * It lives beside the fils arithmetic rather than in `vat.ts` because that
 * module is `server-only` and this one is pure: the change-plan preview needs
 * the number without reaching a database.
 */
export const VAT_RATE = 0.05;

/**
 * VAT on a net figure, rounded once.
 *
 * Per invoice rather than per line, which is the convention `vatReturn` already
 * applies and the FTA allows: what the seller sees on their copy is what the
 * return is built from. Board 3m's worked example is this exact rounding —
 * `154.83 × 0.05` is `7.7415`, and the panel reads `7.74`.
 *
 * Rounds toward zero on a negative net so a credit note's VAT is the mirror of
 * the invoice it corrects rather than a fil adrift from it: `Math.round(-0.5)`
 * is `-0` in JavaScript but `Math.round(0.5)` is `1`, and a correction that does
 * not cancel is worse than one that is a fil out.
 */
export function vatOn(netFils: number, rate: number = VAT_RATE): number {
  return Math.sign(netFils) * Math.round(Math.abs(netFils) * rate);
}

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
  /** Defaults to `VAT_RATE`. Passed only where a stored rate has to be honoured. */
  vatRate?: number;
}

export interface ProrationLine {
  kind: "credit" | "charge";
  /** Whole fils. Positive on both kinds; `kind` carries the direction. */
  fils: number;
  days: number;
  /**
   * Whole fils a day on the plan this line is about. **Display only** — `fils`
   * is not this times `days`. See `lineFils` for why that distinction is the
   * whole point.
   */
  perDayFils: number;
}

export interface Proration {
  creditLine: ProrationLine;
  chargeLine: ProrationLine;
  /**
   * Charge less credit, ex-VAT. Positive means the seller owes; negative means
   * they are in credit.
   */
  netFils: number;
  /** VAT on `netFils`, its own line because board 3m says it always is. */
  vatFils: number;
  /**
   * `netFils + vatFils` — the figure on the button, labelled `incl. VAT`.
   *
   * The one number a seller is asked to agree to, and the one re-verified
   * before anything is charged.
   */
  dueFils: number;
  daysRemaining: number;
  renewsAt: Date;
  /** The rate `vatFils` was computed at, so a caller can label the line. */
  vatRate: number;
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

/**
 * Whole fils a day, for display beside a line.
 *
 * **Not what the line is worth.** `lineFils` divides once over the whole span
 * rather than multiplying this by the day count — see the note there. Floored,
 * because a per-day figure printed next to a total should never round up past it.
 */
export function perDayFils(periodAed: number, periodDays: number): number {
  if (periodDays <= 0) return 0;
  return Math.floor((periodAed * FILS_PER_AED) / periodDays);
}

/**
 * What `days` of a period at `periodAed` is worth, in whole fils.
 *
 * One division over the whole span, rounded once at the end — the formula board
 * 3m prints and works through:
 *
 *     charge = new_price × days_remaining / days_in_cycle
 *
 * This used to floor a per-day rate and multiply it by the day count, which is
 * a different number and a worse one. Twenty-four of thirty-one days of a 299
 * plan is `231.48`; flooring `299/31` to `964` fils and multiplying gives
 * `231.36`. The error is the flooring remainder times the day count, so it grows
 * with the length of the period and is invisible on a one-day proration — and it
 * lands on *both* lines, in opposite directions: the seller is undercharged on
 * the new plan and under-credited on the old.
 *
 * Rounded half-up rather than floored. The board's own worked example needs it —
 * a Basic credit of `99 × 24/31` is `76.6451…`, which is the `76.65` printed on
 * invoice `BL-INV-18790`, not `76.64`. Half a fil is not a direction worth
 * having a policy about; agreeing with the document the seller keeps is.
 */
export function lineFils(periodAed: number, periodDays: number, days: number): number {
  if (periodDays <= 0) return 0;
  return Math.round((periodAed * FILS_PER_AED * days) / periodDays);
}

export function prorate(input: ProrationInput): Proration {
  const { periodDays } = input;
  const days = daysRemaining(input.now, input.renewsAt);

  const creditLine: ProrationLine = {
    kind: "credit",
    fils: lineFils(input.fromPeriodAed, periodDays, days),
    days,
    perDayFils: perDayFils(input.fromPeriodAed, periodDays),
  };
  const chargeLine: ProrationLine = {
    kind: "charge",
    fils: lineFils(input.toPeriodAed, periodDays, days),
    days,
    perDayFils: perDayFils(input.toPeriodAed, periodDays),
  };

  const netFils = chargeLine.fils - creditLine.fils;
  const vat = vatOn(netFils, input.vatRate ?? VAT_RATE);

  return {
    creditLine,
    chargeLine,
    netFils,
    vatFils: vat,
    dueFils: netFils + vat,
    daysRemaining: days,
    // Unchanged. A change on the 12th does not restart the month.
    renewsAt: input.renewsAt,
    vatRate: input.vatRate ?? VAT_RATE,
  };
}

/** "349.00" from 34900 fils. Never a float in the middle. */
export function filsToAed(fils: number): string {
  const sign = fils < 0 ? "-" : "";
  const absolute = Math.abs(fils);
  return `${sign}${Math.floor(absolute / FILS_PER_AED)}.${String(absolute % FILS_PER_AED).padStart(2, "0")}`;
}
