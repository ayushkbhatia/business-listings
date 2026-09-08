import { describe, expect, it } from "vitest";
import {
  countChange,
  funnel,
  medianIsShowable,
  percentChange,
  placeChange,
  pointChange,
  shares,
  windowFor,
  type StageCounts,
} from "@/lib/analytics/model";

/**
 * Board `3l`'s comparison rules, without a database.
 *
 * The board's first rule is that every number on the page is a comparison or it
 * is decoration, and its largest correction is that the funnel bars were drawn
 * at widths that were not their stated proportions. Both are arithmetic, so both
 * are checkable here rather than through a rendered page.
 */

/** The board's own seller. */
const CURRENT: StageCounts = {
  impressions: 28_410,
  clicks: 4_182,
  product_views: 1_864,
  reveals: 312,
  enquiries: 109,
};

const PREVIOUS: StageCounts = {
  impressions: 26_257,
  clicks: 3_490,
  product_views: 1_449,
  reveals: 253,
  enquiries: 98,
};

describe("criterion 1 — no bar is drawn at a width that is not its proportion", () => {
  it("carries each stage from the one above, not from the top", () => {
    /*
       The board drew 4,182 at 38% of the width when it is 14.7% of the stage
       above, and 109 at 5% when it is 0.4% of the top. Every bar below the first
       overstated its stage by 3 to 13 times, on the one page whose whole job is
       to be accurate about proportions.
    */
    const stages = funnel(CURRENT, PREVIOUS);

    expect(stages[0]!.carried).toBeNull();
    expect(stages[1]!.carried).toBeCloseTo(4182 / 28410, 5);
    expect(stages[2]!.carried).toBeCloseTo(1864 / 4182, 5);
    expect(stages[3]!.carried).toBeCloseTo(312 / 1864, 5);
    expect(stages[4]!.carried).toBeCloseTo(109 / 312, 5);
  });

  it("matches the board's own stated rates", () => {
    const stages = funnel(CURRENT, PREVIOUS);
    const percent = (value: number | null) => Number(((value ?? 0) * 100).toFixed(1));

    expect(percent(stages[1]!.carried)).toBe(14.7);
    expect(percent(stages[2]!.carried)).toBe(44.6);
    expect(percent(stages[3]!.carried)).toBe(16.7);
    expect(percent(stages[4]!.carried)).toBe(34.9);
  });

  it("has no rate where the stage above is empty", () => {
    // A rate over nothing is absent, not zero — and a bar drawn at zero width
    // would say the stage lost everybody rather than that nobody arrived.
    const empty: StageCounts = { impressions: 0, clicks: 0, product_views: 0, reveals: 0, enquiries: 0 };
    for (const stage of funnel(empty, null)) expect(stage.carried).toBeNull();
  });
});

describe("criterion 2 — every count has a change or says it has none", () => {
  it("compares the top stage proportionally and the rates in points", () => {
    /*
       Points, never percent, on anything that is already a percentage. A rate
       going from 14.7% to 16.1% has risen 1.4 points and 9.5 percent, and
       printing the second beside a figure that reads as the first is the most
       common way a dashboard lies without writing anything false.
    */
    const stages = funnel(CURRENT, PREVIOUS);
    expect(stages[0]!.delta.kind).toBe("percent");
    expect(stages[1]!.delta.kind).toBe("points");
    expect(stages[2]!.delta.kind).toBe("points");
    expect(stages[3]!.delta.kind).toBe("points");
  });

  it("compares the enquiry stage in counts, because it is small", () => {
    // The seller can act on "eleven more enquiries"; they cannot act on 11.2%
    // of a base where one buyer changing their mind moves several points.
    const stages = funnel(CURRENT, PREVIOUS);
    expect(stages[4]!.delta).toEqual({ kind: "count", value: 11 });
  });

  it("says there is no comparison rather than inventing a zero", () => {
    // Week one. The previous period does not exist, and a zero would say
    // nothing changed when the truth is there is nothing to change against.
    for (const stage of funnel(CURRENT, null)) expect(stage.delta.kind).toBe("none");
  });

  it("refuses a percentage over a base of nothing", () => {
    // A rise from zero is not a percentage. `+100%` and `+∞%` are both worse
    // than saying so.
    expect(percentChange(40, 0).kind).toBe("none");
    expect(percentChange(40, 20)).toEqual({ kind: "percent", value: 100 });
  });

  it("refuses a point change where either rate is absent", () => {
    expect(pointChange(null, 0.2).kind).toBe("none");
    expect(pointChange(0.2, null).kind).toBe("none");
    expect(pointChange(0.161, 0.147)).toMatchObject({ kind: "points" });
    const delta = pointChange(0.161, 0.147);
    if (delta.kind === "points") expect(delta.value).toBeCloseTo(1.4, 5);
  });

  it("keeps the sign that means better on a ranking", () => {
    // Smaller is better, so an improvement is negative. The screen renders the
    // arrow; the model keeps the sign that decides which way it points.
    expect(placeChange(1, 2)).toEqual({ kind: "places", value: -1 });
    expect(placeChange(14, 8)).toEqual({ kind: "places", value: 6 });
    expect(placeChange(null, 8).kind).toBe("none");
    expect(placeChange(8, null).kind).toBe("none");
  });

  it("suppresses a count change when the periods are not comparable", () => {
    expect(countChange(10, 4, false).kind).toBe("none");
    expect(countChange(10, 4, true)).toEqual({ kind: "count", value: 6 });
  });
});

describe("the window is symmetric", () => {
  it("compares thirty days against the thirty before", () => {
    /*
       Both halves the same length. An asymmetric window — this month against
       last month, of different lengths — reports a change that is really a
       calendar artefact.
    */
    const now = new Date("2026-08-31T00:00:00.000Z");
    const win = windowFor(now);

    expect(win.to.getTime() - win.from.getTime()).toBe(30 * 86_400_000);
    expect(win.previousTo.getTime() - win.previousFrom.getTime()).toBe(30 * 86_400_000);
    // The two halves touch and never overlap: one buyer is counted once.
    expect(win.previousTo.getTime()).toBe(win.from.getTime());
  });
});

describe("shares", () => {
  it("is proportional by construction and sorts by size", () => {
    const rows = shares(new Map([["dubai", 61], ["sharjah", 12], ["abu_dhabi", 17]]), null);
    expect(rows.map((row) => row.key)).toEqual(["dubai", "abu_dhabi", "sharjah"]);
    expect(rows.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(1, 10);
  });

  it("moves rows by their share and not by their count", () => {
    /*
       A region whose enquiries doubled while the account tripled has fallen as
       a proportion. A panel headed by percentages that moves its rows by
       absolute counts is two questions in one table.
    */
    const rows = shares(
      new Map([["dubai", 60], ["sharjah", 40]]),
      new Map([["dubai", 30], ["sharjah", 10]]),
    );
    const dubai = rows.find((row) => row.key === "dubai")!;
    expect(dubai.count).toBe(60);
    // 60% now against 75% before, so down 15 points despite doubling.
    if (dubai.delta.kind === "points") expect(dubai.delta.value).toBeCloseTo(-15, 5);
    else throw new Error("expected a point change");
  });

  it("has no comparison when the previous period is empty", () => {
    const rows = shares(new Map([["dubai", 3]]), null);
    expect(rows[0]!.delta.kind).toBe("none");
  });

  it("keeps a zero total from producing a NaN share", () => {
    const rows = shares(new Map([["dubai", 0]]), null);
    expect(rows[0]!.share).toBe(0);
  });
});

describe("the median cohort floor — B5", () => {
  it("refuses a median that would identify a competitor", () => {
    // A median over three suppliers plus your own number tells a seller most of
    // what they need to work out a specific competitor's.
    expect(medianIsShowable(3)).toBe(false);
    expect(medianIsShowable(7)).toBe(false);
    expect(medianIsShowable(8)).toBe(true);
    expect(medianIsShowable(40)).toBe(true);
  });
});
