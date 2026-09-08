import { UAE_LOCALE } from "./locale";

/**
 * `41,204`. Never `41.2k`.
 *
 * The whole promise of the directory is that the numbers are real. An abbreviated
 * count reads as an estimate, and an estimate reads as marketing.
 */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) {
    throw new TypeError(`formatCount received a value that is not a finite number: ${String(value)}`);
  }
  return new Intl.NumberFormat(UAE_LOCALE, { maximumFractionDigits: 0 }).format(value);
}

/**
 * `4.2` from 4.216, `100` from 100. One decimal, trailing zero dropped.
 * For ratings and averages only — anything countable uses formatCount.
 */
export function formatDecimal(value: number, fractionDigits = 1): string {
  if (!Number.isFinite(value)) {
    throw new TypeError(`formatDecimal received a value that is not a finite number: ${String(value)}`);
  }
  return new Intl.NumberFormat(UAE_LOCALE, {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

/**
 * `4.0` from 4, `4.2` from 4.216. Always one decimal, trailing zero kept.
 *
 * A rating is not an ordinary decimal. `formatDecimal` drops a trailing zero,
 * which is right for a measurement and wrong here: a 4.0 rendered as "4" beside
 * a 4.2 rendered as "4.2" reads as two different kinds of number, and the same
 * average printed "4" in one place and "4.0" in another is one figure carrying
 * two renderings on one page — which is what this function exists to stop. The
 * storefront header and board 1m's rating card both call it.
 */
export function formatRating(value: number): string {
  if (!Number.isFinite(value)) {
    throw new TypeError(`formatRating received a value that is not a finite number: ${String(value)}`);
  }
  return new Intl.NumberFormat(UAE_LOCALE, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

/** `30%` from 0.3. Whole percent; a directory has no use for 30.4% of a listing. */
export interface PercentOptions {
  /**
   * How many decimals to keep. Zero by default, which is what every caller
   * before board `3l` wanted.
   *
   * That board needs one: its funnel rates are 14.7%, 44.6%, 16.7% and 34.9%,
   * and a reveal rate of 0.5% rounds to **0%** — a stage that reads as having
   * lost everybody when it converted one buyer in two hundred. On a page whose
   * whole job is to be accurate about proportions, the rounding is the defect.
   */
  decimals?: number;
}

export function formatPercent(ratio: number, { decimals = 0 }: PercentOptions = {}): string {
  if (!Number.isFinite(ratio)) {
    throw new TypeError(`formatPercent received a value that is not a finite number: ${String(ratio)}`);
  }
  return new Intl.NumberFormat(UAE_LOCALE, {
    style: "percent",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(ratio);
}
