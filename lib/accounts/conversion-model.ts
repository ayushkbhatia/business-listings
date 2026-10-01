/**
 * Free → paid conversion within ninety days of claiming — the owner's answer to
 * D-CONVERSION on board 4a, 1 Oct 2026.
 *
 * The export's footnote read *18% within 90 days of claiming* and the only 18%
 * on the board was 2,046 ÷ 11,388: the share of claimed listings paying *now*,
 * a stock ratio. A cohort figure is a different question — of the businesses
 * whose claim was approved in a window, how many started paying within ninety
 * days of it — and it is only answerable for claims at least ninety days old.
 *
 * So the line has two forms, and says which it is:
 *
 *   - **The cohort figure**, over claims approved in the year before the most
 *     recent ninety days, once at least one such claim exists.
 *   - **The stock ratio, named as one**, until then: *N% of claimed businesses
 *     pay* — which is what the export's 18% actually was.
 *
 * Pure: the caller reads the claim decisions and the ledger.
 */

/** Days after the claim within which a first payment counts. */
export const CONVERSION_WINDOW_DAYS = 90;

/** How far back the cohorts reach, before the window. A year of claims. */
export const COHORT_SPAN_DAYS = 365;

const DAY_MS = 86_400_000;

export interface ClaimedAt {
  businessId: string;
  /** When the claim was approved — `4f`'s claimed-at, the first approved decision. */
  claimedAt: Date;
}

export interface CohortConversion {
  /** Claims approved in the cohort window: the denominator. */
  cohort: number;
  /** Of those, the businesses whose first payment came within the window of their claim. */
  converted: number;
  /** `converted / cohort`. Null with no cohort. */
  rate: number | null;
  /** The earliest and latest claim the cohort covers. Null with no cohort. */
  claimedFrom: Date | null;
  claimedTo: Date | null;
}

/** The claims old enough to have had their full ninety days by `asOf`. */
export function cohortWindow(asOf: Date): { from: Date; to: Date } {
  const to = new Date(asOf.getTime() - CONVERSION_WINDOW_DAYS * DAY_MS);
  return { from: new Date(to.getTime() - COHORT_SPAN_DAYS * DAY_MS), to };
}

/**
 * The cohort figure. A first payment before the claim was approved counts as
 * converted — a seller can subscribe while their claim waits for a decision,
 * and they did convert; what they did not need was ninety days.
 */
export function cohortConversion(
  claims: readonly ClaimedAt[],
  firstPaidAt: ReadonlyMap<string, Date>,
  asOf: Date,
): CohortConversion {
  const window = cohortWindow(asOf);
  const cohort = claims.filter(
    (claim) => claim.claimedAt.getTime() >= window.from.getTime() && claim.claimedAt.getTime() < window.to.getTime(),
  );
  const converted = cohort.filter((claim) => {
    const paid = firstPaidAt.get(claim.businessId);
    return paid !== undefined && paid.getTime() <= claim.claimedAt.getTime() + CONVERSION_WINDOW_DAYS * DAY_MS;
  }).length;
  const times = cohort.map((claim) => claim.claimedAt.getTime());
  return {
    cohort: cohort.length,
    converted,
    rate: cohort.length === 0 ? null : converted / cohort.length,
    claimedFrom: times.length === 0 ? null : new Date(Math.min(...times)),
    claimedTo: times.length === 0 ? null : new Date(Math.max(...times)),
  };
}
