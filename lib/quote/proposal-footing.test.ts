import { describe, expect, it } from "vitest";
import {
  AREA_MAX,
  figuresWanted,
  footingRowShown,
  readFigure,
  twelveMonthFooting,
  type FootingContext,
} from "./proposal-footing";

const ONGOING: FootingContext = { engagementType: "ongoing_contract", cadence: "quarterly", visitsPerYear: null, areaSqFt: null };

describe("twelveMonthFooting — the board's four columns", () => {
  it("per month is × 12 and names the mobilisation it adds — the first correction at export", () => {
    const footing = twelveMonthFooting({ feeBasis: "per_month", feeAed: "18400", mobilisationAed: "6000", termMonths: 24 }, ONGOING);
    expect(footing).toEqual({
      kind: "figure",
      totalAed: "226800.00",
      working: [{ op: "months", count: 12 }, { op: "mobilisation", aed: "6000.00" }],
      usesBuyerFigure: false,
    });
  });

  it("per visit counts the brief's cadence, and never prices reactive work (Q3)", () => {
    const footing = twelveMonthFooting({ feeBasis: "per_visit", feeAed: "5100", mobilisationAed: "0", termMonths: 12 }, ONGOING);
    expect(footing).toMatchObject({ kind: "figure", totalAed: "20400.00", usesBuyerFigure: false });
    expect(footing.working).toEqual([{ op: "visits", count: 4, source: "cadence", cadence: "quarterly" }]);
  });

  it("per sq ft a year does not produce a number without a stated area (B5, AC5)", () => {
    const footing = twelveMonthFooting({ feeBasis: "per_sqft_yr", feeAed: "5.40", mobilisationAed: null, termMonths: 12 }, ONGOING);
    expect(footing).toEqual({ kind: "not_computable", reason: "needs_area", working: [{ op: "no_mobilisation_stated" }] });
  });

  it("works per sq ft on the buyer's figure and says it did", () => {
    const footing = twelveMonthFooting(
      { feeBasis: "per_sqft_yr", feeAed: "5.40", mobilisationAed: null, termMonths: 12 },
      { ...ONGOING, areaSqFt: 40_000 },
    );
    expect(footing).toMatchObject({ kind: "figure", totalAed: "216000.00", usesBuyerFigure: true });
  });

  it("takes a fixed fee as proposed only over a twelve-month term", () => {
    expect(
      twelveMonthFooting({ feeBasis: "fixed_fee", feeAed: "231000", mobilisationAed: null, termMonths: 12 }, ONGOING),
    ).toMatchObject({ kind: "figure", totalAed: "231000.00", working: [{ op: "as_proposed" }, { op: "no_mobilisation_stated" }] });
    for (const termMonths of [24, null]) {
      expect(
        twelveMonthFooting({ feeBasis: "fixed_fee", feeAed: "231000", mobilisationAed: null, termMonths }, ONGOING),
      ).toMatchObject({ kind: "not_computable", reason: "fixed_fee_term" });
    }
  });
});

describe("the cases that must not become numbers", () => {
  it("refuses per visit when neither the brief nor the buyer says how many", () => {
    expect(
      twelveMonthFooting({ feeBasis: "per_visit", feeAed: "850", mobilisationAed: null, termMonths: null }, { ...ONGOING, cadence: null }),
    ).toMatchObject({ kind: "not_computable", reason: "needs_visits" });
  });

  it("lets the buyer's visits replace the cadence, and marks the figure as theirs", () => {
    expect(
      twelveMonthFooting({ feeBasis: "per_visit", feeAed: "850", mobilisationAed: null, termMonths: null }, { ...ONGOING, visitsPerYear: 6 }),
    ).toMatchObject({ kind: "figure", totalAed: "5100.00", usesBuyerFigure: true });
  });

  it("refuses every basis with no stated volume", () => {
    for (const feeBasis of ["per_hour", "per_return", "per_container", "on_assessment", "retainer"]) {
      expect(
        twelveMonthFooting({ feeBasis, feeAed: "100", mobilisationAed: null, termMonths: 12 }, ONGOING),
      ).toMatchObject({ kind: "not_computable", reason: "unknown_volume" });
    }
  });

  it("says when a monthly term is shorter than the twelve it is multiplied by", () => {
    const footing = twelveMonthFooting({ feeBasis: "per_month", feeAed: "1000", mobilisationAed: null, termMonths: 6 }, ONGOING);
    expect(footing.working).toContainEqual({ op: "term_shorter", termMonths: 6 });
  });

  it("adds in fils, not floats", () => {
    expect(
      twelveMonthFooting({ feeBasis: "per_sqft_yr", feeAed: "0.10", mobilisationAed: "0.20", termMonths: 12 }, { ...ONGOING, areaSqFt: 3 }),
    ).toMatchObject({ totalAed: "0.50" });
  });
});

describe("whether the row exists", () => {
  const month = { feeBasis: "per_month" };
  const visit = { feeBasis: "per_visit" };

  it("shows with one proposal, hides when every proposal shares a basis, and shows when they differ", () => {
    expect(footingRowShown([month], ONGOING)).toBe(true);
    expect(footingRowShown([month, month], ONGOING)).toBe(false);
    expect(footingRowShown([month, visit], ONGOING)).toBe(true);
    expect(footingRowShown([], ONGOING)).toBe(false);
  });

  it("does not exist for a one-off job or a call-off", () => {
    expect(footingRowShown([month, visit], { engagementType: "one_off_job" })).toBe(false);
    expect(footingRowShown([month, visit], { engagementType: "call_off" })).toBe(false);
  });

  it("asks only for the figures a column needs", () => {
    expect(figuresWanted([month, { feeBasis: "per_sqft_yr" }], ONGOING)).toEqual({ area: true, visits: false });
    expect(figuresWanted([visit], ONGOING)).toEqual({ area: false, visits: true });
    expect(figuresWanted([visit], { engagementType: "one_off_job", cadence: null })).toEqual({ area: false, visits: false });
  });
});

describe("readFigure", () => {
  it("reads whole numbers with separators and refuses everything else", () => {
    expect(readFigure("40,000", AREA_MAX)).toBe(40_000);
    expect(readFigure(" 60000 ", AREA_MAX)).toBe(60_000);
    for (const raw of [undefined, "", "0", "-5", "1.5", "about 40000", String(AREA_MAX + 1)]) {
      expect(readFigure(raw, AREA_MAX)).toBeNull();
    }
  });
});
