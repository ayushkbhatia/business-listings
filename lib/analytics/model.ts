/**
 * Board `3l` — the comparison rules, as arithmetic.
 *
 * Pure, and that is the point. The board's first rule is that **every number on
 * the page is a comparison or it is decoration**, and this is where that either
 * holds or does not. Testing it needs no database.
 *
 * ## The window is symmetric, and it says so
 *
 * Thirty days against the thirty before, never "last 30 days" over a page of
 * bare counts. A seller opens analytics to find out whether last month's work
 * moved anything, and the board as drawn could not answer it.
 *
 * ## A missing comparison is a state, not a zero
 *
 * `none` is what week one renders, and it renders as *no comparison yet* rather
 * than as `0%`. A zero says nothing changed; the truth is that there is nothing
 * to change against. Board `3l` calls week one a normal page and not an error,
 * and this is the type that makes that possible.
 */

/** How the change beside a number is expressed. Four kinds, and one absence. */
export type Delta =
  /** No previous period, or nothing in it. Week one. */
  | { kind: "none" }
  /** A raw movement in the count itself: `+11`. */
  | { kind: "count"; value: number }
  /** A proportional movement in the count: `+8.2%`. */
  | { kind: "percent"; value: number }
  /**
   * A movement in something that is already a percentage: `+1.4pt`.
   *
   * Points, never percent. A rate going from 14.7% to 16.1% has risen 1.4
   * *points* and 9.5 *percent*, and printing the second beside a figure that
   * reads as the first is the most common way a dashboard lies without anybody
   * writing anything false.
   */
  | { kind: "points"; value: number }
  /** Places moved in a ranking. Negative is better — `↑1` is `-1` place. */
  | { kind: "places"; value: number };

export const NO_COMPARISON: Delta = { kind: "none" };

/** The two halves of the comparison, and what the header says. */
export interface Window {
  from: Date;
  /** Exclusive. `to` is the first instant *after* the window. */
  to: Date;
  previousFrom: Date;
  previousTo: Date;
  days: number;
}

/** A day in milliseconds. Asia/Dubai has no daylight saving, so this is exact. */
const DAY_MS = 86_400_000;

/** The window the page opens on. Thirty days, and thirty before it. */
export const DEFAULT_WINDOW_DAYS = 30;

/**
 * The symmetric window ending at `now`.
 *
 * Both halves are the same length, which is what makes the comparison a
 * comparison. An asymmetric one — this month against last month, of different
 * lengths — is the other common way a dashboard reports a change that is really
 * a calendar artefact.
 */
export function windowFor(now: Date, days: number = DEFAULT_WINDOW_DAYS): Window {
  const to = now;
  const from = new Date(to.getTime() - days * DAY_MS);
  return {
    from,
    to,
    previousFrom: new Date(from.getTime() - days * DAY_MS),
    previousTo: from,
    days,
  };
}

/**
 * The change between two counts, proportionally.
 *
 * `none` when the previous period had nothing: a rise from zero is not a
 * percentage, and rendering it as `+100%` or `+∞%` are both worse than saying
 * there is nothing to compare against.
 */
export function percentChange(current: number, previous: number): Delta {
  if (previous <= 0) return NO_COMPARISON;
  return { kind: "percent", value: ((current - previous) / previous) * 100 };
}

/** The change between two counts, in the counts' own units. `+11`. */
export function countChange(current: number, previous: number, comparable: boolean): Delta {
  if (!comparable) return NO_COMPARISON;
  return { kind: "count", value: current - previous };
}

/**
 * The change between two rates, in points.
 *
 * Both rates are 0..1 and the result is in percentage points. `none` when
 * either side has no denominator — a rate over nothing is not zero, it is
 * absent, and the difference matters on the row where a seller decides what to
 * fix.
 */
export function pointChange(current: number | null, previous: number | null): Delta {
  if (current === null || previous === null) return NO_COMPARISON;
  return { kind: "points", value: (current - previous) * 100 };
}

/**
 * Places moved in a ranking.
 *
 * Negative is an improvement, because a smaller number is a better position.
 * The screen renders the direction; this keeps the sign that means it.
 */
export function placeChange(current: number | null, previous: number | null): Delta {
  if (current === null || previous === null) return NO_COMPARISON;
  return { kind: "places", value: current - previous };
}

/** Whether a delta has anything to say. The screen renders the alternative. */
export function hasComparison(delta: Delta): boolean {
  return delta.kind !== "none";
}

// ─────────────────────────────────────────────────────────────────────────────
// The funnel
// ─────────────────────────────────────────────────────────────────────────────

/** The five stages, in the board's order. Stages, not one path — see below. */
export const FUNNEL_STAGES = [
  "impressions",
  "clicks",
  "product_views",
  "reveals",
  "enquiries",
] as const;

export type FunnelStageKey = (typeof FUNNEL_STAGES)[number];

export interface StageCounts {
  impressions: number;
  clicks: number;
  product_views: number;
  reveals: number;
  enquiries: number;
}

export interface FunnelStage {
  key: FunnelStageKey;
  count: number;
  /**
   * The share carried from the stage above, 0..1. Null on the first stage,
   * which has nothing above it, and null where the stage above is zero.
   *
   * **This is the bar width**, and it is the board's largest correction. The
   * design drew 4,182 at 38% of the width when it is 14.7% of the stage above,
   * and 109 at 5% when it is 0.4% of the top — every bar below the first
   * overstating its stage by 3 to 13 times, on the one page whose whole job is
   * to be accurate about proportions. Drawn against the top of the funnel
   * instead, the last two bars are four pixels wide and unreadable.
   */
  carried: number | null;
  /** The change against the same stage in the previous period. */
  delta: Delta;
}

/**
 * The five stages with their carried rates and their changes.
 *
 * **Stages, not one path.** A buyer can send an enquiry without ever revealing
 * a phone number, so a strict funnel reading of these five rows is wrong and the
 * panel says so. The two were one bucket on the board — "revealed contact or
 * started an enquiry" — in the step where the difference decides what a seller
 * should fix.
 *
 * The top stage compares proportionally and the rest compare in points, because
 * the rest *are* rates. The last stage is small enough that a percentage of it
 * is noise, so it carries its own count: `+11` is a fact and `+11.2%` of 98 is
 * a rounding artefact wearing a decimal.
 */
export function funnel(current: StageCounts, previous: StageCounts | null): FunnelStage[] {
  const rate = (counts: StageCounts, index: number): number | null => {
    if (index === 0) return null;
    const above = counts[FUNNEL_STAGES[index - 1]!];
    if (above <= 0) return null;
    return counts[FUNNEL_STAGES[index]!] / above;
  };

  return FUNNEL_STAGES.map((key, index) => {
    const count = current[key];
    const carried = rate(current, index);

    if (!previous) return { key, count, carried, delta: NO_COMPARISON };

    if (index === 0) return { key, count, carried, delta: percentChange(count, previous[key]) };

    /*
       The enquiry stage counts rather than rates.

       It is the smallest number on the page by two orders of magnitude, and a
       percentage over a base that small moves several points when one buyer
       changes their mind. The seller can act on "eleven more enquiries"; they
       cannot act on "11.2%".
    */
    if (key === "enquiries") {
      return { key, count, carried, delta: countChange(count, previous[key], true) };
    }

    return { key, count, carried, delta: pointChange(carried, rate(previous, index)) };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Shares
// ─────────────────────────────────────────────────────────────────────────────

export interface ShareRow<K extends string = string> {
  key: K;
  count: number;
  /** 0..1 of the total. The bar width, and proportional by construction. */
  share: number;
  /** Movement in the *share*, in points. */
  delta: Delta;
}

/**
 * Counts turned into shares, with the change in each share.
 *
 * The change is in the share and not in the count, deliberately: a region whose
 * enquiries doubled while the whole account tripled has fallen as a proportion,
 * and a panel headed by percentages that moves its rows by absolute counts is
 * two different questions in one table.
 */
export function shares<K extends string>(
  current: ReadonlyMap<K, number>,
  previous: ReadonlyMap<K, number> | null,
): ShareRow<K>[] {
  const total = [...current.values()].reduce((sum, value) => sum + value, 0);
  const previousTotal = previous
    ? [...previous.values()].reduce((sum, value) => sum + value, 0)
    : 0;

  return [...current.entries()]
    .map(([key, count]) => ({
      key,
      count,
      share: total > 0 ? count / total : 0,
      delta:
        previous && previousTotal > 0 && total > 0
          ? pointChange(count / total, (previous.get(key) ?? 0) / previousTotal)
          : NO_COMPARISON,
    }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/**
 * Whether a cross-tenant median may be shown at all. Build note `B5`.
 *
 * A median over three suppliers identifies a competitor — with two others in
 * the cohort, "the median is 19%" and your own number tell a seller most of
 * what they need to work out theirs. The floor is a policy decision rather than
 * a statistical one, which is why it is a named constant and not a literal
 * inside a query.
 */
export const MIN_MEDIAN_COHORT = 8;

export function medianIsShowable(cohortSize: number): boolean {
  return cohortSize >= MIN_MEDIAN_COHORT;
}
