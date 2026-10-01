/**
 * Board 4a — the platform overview's arithmetic, with no database.
 *
 * Every rule the screen applies to a number it did not compute itself lives
 * here, so the unit suite can hold it to the handoff's own figures and the
 * screen, the API and the gallery cannot each apply it a little differently:
 *
 *   - **The supply-gap label** (B6, D-GAP). Derived from a ratio and a constant,
 *     never typed and never stored.
 *   - **The chart's one scale** (B5, D-CHART). Stacks are drawn against the
 *     tallest month, churn below the axis on the same scale, and nothing can
 *     exceed the plot — the export drew the last six months at an identical
 *     136px because the stacks overflowed it.
 *   - **Shares on one scale** (B5). Every plan-mix bar is a share of claimed.
 *
 * Pure: no `server-only`, no Prisma. The read model in `./overview.ts` fetches
 * and hands the numbers over.
 */

// ── The supply gap (B6, D-GAP) ───────────────────────────────────────────────

/**
 * RFQs per thirty days for every claimed listing in a sector, cut into four
 * labels. The owner's answer to D-GAP, 1 Oct 2026, and the rule the five drawn
 * rows already followed: Marine 9.16 and HVAC 5.88 Severe, MEP 2.91 Watch,
 * Healthcare 0.46 Healthy, Beauty 0.04 Oversupplied.
 *
 * One constant. The screen prints the rule from it, so the sentence under the
 * table and the labels in it cannot drift apart.
 */
export const SUPPLY_GAP_RULE = {
  /** At or above: buyers are asking far faster than claimed suppliers can answer. Recruit. */
  severe: 5,
  /** At or above: thin, worth watching. */
  watch: 2,
  /** At or above: supply and demand roughly in step. Below it is oversupplied. */
  healthy: 0.2,
} as const;

export type SupplyGapLabel = "severe" | "watch" | "healthy" | "oversupplied" | "no_demand";

/**
 * RFQs per claimed listing.
 *
 * `null` when there is neither demand nor supply — no ratio exists, and calling
 * an empty sector oversupplied would be a finding about nothing. `Infinity`
 * when buyers asked and nobody has claimed a listing to answer them, which is
 * the most severe gap there is rather than a division error.
 */
export function supplyGapRatio(rfqs: number, claimed: number): number | null {
  if (claimed > 0) return rfqs / claimed;
  return rfqs > 0 ? Number.POSITIVE_INFINITY : null;
}

export function supplyGapLabel(ratio: number | null): SupplyGapLabel {
  if (ratio === null) return "no_demand";
  if (ratio >= SUPPLY_GAP_RULE.severe) return "severe";
  if (ratio >= SUPPLY_GAP_RULE.watch) return "watch";
  if (ratio >= SUPPLY_GAP_RULE.healthy) return "healthy";
  return "oversupplied";
}

/**
 * Thinnest supply first: the order the table's title promises. A sector with no
 * ratio sorts last, and ties break on the name so a refresh never reshuffles
 * two equal rows.
 */
export function bySupplyGap<T extends { ratio: number | null; name: string }>(a: T, b: T): number {
  if (a.ratio === null && b.ratio === null) return a.name.localeCompare(b.name);
  if (a.ratio === null) return 1;
  if (b.ratio === null) return -1;
  if (a.ratio !== b.ratio) return b.ratio - a.ratio;
  return a.name.localeCompare(b.name);
}

// ── Shares ───────────────────────────────────────────────────────────────────

/** `part / whole`, or null where there is no whole to be a share of. */
export function shareOf(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

/**
 * A bar's width as a percentage of its track, never above 100 and never a
 * sliver for nothing. One scale per chart (B5): the caller passes the same
 * `whole` for every row.
 */
export function barPercent(value: number, whole: number): number {
  if (whole <= 0 || value <= 0) return 0;
  return Math.min(100, (value / whole) * 100);
}

// ── The growth chart (B5, D-CHART) ───────────────────────────────────────────

/**
 * One month of the chart, all of it counts.
 *
 * `claims` and `upgrades` stack above the axis — supply arriving and accounts
 * moving up. `rfqs` stands beside them as its own bar, the demand the title
 * names and the export never drew. `churn` hangs below the axis, so a month with
 * more cancellations is drawn lower rather than taller: the export stacked it on
 * top of growth.
 */
export interface ChartMonth {
  /** `2026-08`. */
  key: string;
  /** Midnight in Dubai on the first, ISO. */
  from: string;
  claims: number;
  upgrades: number;
  churn: number;
  rfqs: number;
  /** The month still running: its bars are not a whole month and say so. */
  partial: boolean;
}

export interface ChartGeometry {
  /** The value the top of the plot stands for. */
  upCeiling: number;
  /** The value the bottom of the plot stands for, below the axis. Zero when nothing churned. */
  downCeiling: number;
  /** The tick step above the axis. Below it, the step is this or the ceiling, whichever is smaller. */
  step: number;
  /** Tick values above the axis, zero first. */
  ticks: number[];
  /** Tick values below the axis, as positive numbers, nearest the axis first. */
  downTicks: number[];
  /** The share of the plot's height above the axis. */
  upShare: number;
}

/** 1, 2 or 5 times a power of ten — the steps an axis can be read off. */
export function niceStep(rough: number): number {
  if (!(rough > 0) || !Number.isFinite(rough)) return 1;
  const power = 10 ** Math.floor(Math.log10(rough));
  const scaled = rough / power;
  const nice = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return Math.max(1, nice * power);
}

/** How many steps the taller side of the axis is divided into, at most. */
const TARGET_TICKS = 4;

/**
 * The scale for twelve months, from their tallest value.
 *
 * Above the axis the tallest thing is either a supply stack or a demand bar,
 * whichever is higher; below it, the largest churn. Both sides are cut with
 * the same step and given heights in proportion to their ceilings, so a unit is
 * the same number of pixels whichever side of the axis it is on. Every value is
 * at or under its ceiling by construction, which is the whole of B5.
 */
export function chartGeometry(months: readonly ChartMonth[]): ChartGeometry {
  const upPeak = Math.max(0, ...months.map((month) => Math.max(month.claims + month.upgrades, month.rfqs)));
  const downPeak = Math.max(0, ...months.map((month) => month.churn));
  const step = niceStep(Math.max(upPeak, downPeak, 1) / TARGET_TICKS);
  const upCeiling = Math.max(step, Math.ceil(upPeak / step) * step);
  /*
     Below the axis the ceiling is the smaller of the next whole step and the
     next 1, 2 or 5: seven cancellations under a hundred-step axis would
     otherwise claim a quarter of the plot to draw a sliver. Either way the
     region's height is in proportion to its ceiling, so a unit is the same
     number of pixels on both sides and the scale is still one scale.
  */
  const downCeiling = downPeak === 0 ? 0 : Math.min(Math.ceil(downPeak / step) * step, niceStep(downPeak));
  const downStep = downCeiling < step ? downCeiling : step;
  const ticks: number[] = [];
  for (let value = 0; value <= upCeiling; value += step) ticks.push(value);
  const downTicks: number[] = [];
  if (downStep > 0) for (let value = downStep; value <= downCeiling; value += downStep) downTicks.push(value);
  return {
    upCeiling,
    downCeiling,
    step,
    ticks,
    downTicks,
    upShare: upCeiling / (upCeiling + downCeiling),
  };
}

/** A value's height as a percentage of its side of the axis. */
export function chartPercent(value: number, ceiling: number): number {
  return barPercent(value, ceiling);
}
