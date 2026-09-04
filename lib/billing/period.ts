import { FILS_PER_AED } from "./proration";

/**
 * A billing period: how long it runs, what it costs, and what it is worth a
 * month.
 *
 * Pure, so the arithmetic can be tested without a database — the same shape as
 * `proration.ts` and `dunning.ts`, and for the same reason. Every function here
 * is called from somewhere that writes money, and a divisor that is wrong by a
 * factor of twelve is not the kind of thing to find in an integration test.
 *
 * ## Why a term at all
 *
 * `Plan` carries one price column, `monthlyPriceAed`. An annual subscription is
 * not a different plan and not a second price — it is the same plan paid for
 * `annualMonthsCharged` months at a time. Keeping it that way is what stops
 * `Business.planId` having two answers, `mrrNow` grouping into six rows for
 * three plans, and `cheapestPlanUnlocking` offering a payment schedule as an
 * upgrade.
 */

export type BillingTerm = "monthly" | "annual";

/** The `Plan` columns this module needs. Structural, so tests need no database. */
export interface TermPlan {
  monthlyPriceAed: number;
  /** Months charged for a year. Null means the plan is monthly-only. */
  annualMonthsCharged: number | null;
}

const MONTHS_IN_YEAR = 12;
const MS_PER_DAY = 86_400_000;

/**
 * What one period of this plan costs, in whole dirhams.
 *
 * **Throws** on an annual term for a plan that has no annual price. A caller
 * asking what a year costs on a plan we do not sell yearly has a bug, and
 * returning zero would turn it into a free subscription that renews for ever.
 * Every call site either knows the term is monthly or has checked `offersAnnual`.
 */
export function periodPriceAed(plan: TermPlan, term: BillingTerm): number {
  if (term === "monthly") return plan.monthlyPriceAed;
  if (plan.annualMonthsCharged === null) {
    throw new Error("This plan is not sold annually, so a year has no price.");
  }
  return plan.monthlyPriceAed * plan.annualMonthsCharged;
}

/** Whether a year can be bought on this plan at all. */
export function offersAnnual(plan: TermPlan): boolean {
  return plan.annualMonthsCharged !== null && plan.monthlyPriceAed > 0;
}

/** How many months of twelve a year is free. Two, on a ten-month year. */
export function monthsFree(plan: TermPlan): number {
  if (plan.annualMonthsCharged === null) return 0;
  return MONTHS_IN_YEAR - plan.annualMonthsCharged;
}

/**
 * What this subscription is worth a month, whatever it pays in one go.
 *
 * The single most load-bearing function in the billing layer, because two
 * separate things read it and must agree: `mrrNow`, which sums what every live
 * account is worth, and `recordMovement`, which writes what changed. If those
 * two derive a monthly figure differently then `reconcile()` — the check the
 * revenue screen renders whether it passes or not — starts reporting a
 * difference nobody can explain.
 *
 * An annual account is worth ten twelfths of a monthly one on the seeded
 * discount. That is a real contraction in MRR and it is correct: an annual
 * price trades recurring revenue for cash and retention, and a revenue screen
 * that hid the trade would be the wrong screen.
 */
export function monthlyValueFils(plan: TermPlan, term: BillingTerm): number {
  const monthlyFils = Math.round(plan.monthlyPriceAed * FILS_PER_AED);
  if (term === "monthly") return monthlyFils;
  if (plan.annualMonthsCharged === null) return monthlyFils;
  return Math.round((monthlyFils * plan.annualMonthsCharged) / MONTHS_IN_YEAR);
}

/**
 * Whole days in a period. Never zero.
 *
 * A period that starts and ends on the same day is a data error rather than a
 * reason to divide by nought, and one day is the answer that keeps the caller's
 * arithmetic finite while staying obviously wrong to anybody reading it.
 */
export function periodDays(startedAt: Date, renewsAt: Date): number {
  const days = Math.round((renewsAt.getTime() - startedAt.getTime()) / MS_PER_DAY);
  return Math.max(1, days);
}

/** Days in the calendar month a year/month pair names. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * The end of the next period.
 *
 * Calendar arithmetic, not `+30 days` and not `+365 days`. A month is a month:
 * a subscription renewing on 1 March pays for March, and adding thirty days
 * would walk it to the 31st and then out of step for ever.
 *
 * ## The anchor
 *
 * `anchorDay` is the day the subscription asked for, and it is carried rather
 * than re-read from the previous renewal because clamping is lossy. A
 * subscription anchored on the 31st renews 31 Jan → 28 Feb → **31 Mar**.
 * Deriving the next date from 28 February instead would give 28 March, and the
 * seller would spend the rest of their life renewing on the 28th because one
 * February was short.
 *
 * The time of day is taken from `from`, so a renewal keeps the hour it started
 * on rather than drifting to midnight.
 */
export function advance(from: Date, term: BillingTerm, anchorDay: number): Date {
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth();

  const nextYear = term === "annual" ? year + 1 : month === 11 ? year + 1 : year;
  const nextMonth = term === "annual" ? month : (month + 1) % 12;

  const day = Math.min(anchorDay, daysInMonth(nextYear, nextMonth));

  return new Date(
    Date.UTC(
      nextYear,
      nextMonth,
      day,
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
      from.getUTCMilliseconds(),
    ),
  );
}

/**
 * The day of the month a period starting now should anchor to.
 *
 * Its own function so the two callers that open a period — a first subscription
 * and a term change — cannot disagree about which date the anchor comes from.
 */
export function anchorDayOf(date: Date): number {
  return date.getUTCDate();
}
