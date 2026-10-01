import { describe, expect, it } from "vitest";
import {
  barPercent,
  bySupplyGap,
  chartGeometry,
  niceStep,
  shareOf,
  supplyGapLabel,
  supplyGapRatio,
  SUPPLY_GAP_RULE,
  type ChartMonth,
} from "./overview-model";

/**
 * Board 4a's arithmetic, held to the handoff's own figures.
 */

describe("B6 — the supply-gap label derives from one ratio and one constant", () => {
  /*
     The five drawn rows, as RFQs per month over claimed listings. The handoff
     found they already followed a rule nobody wrote down; D-GAP wrote it.
  */
  const drawn = [
    { name: "Marine & oilfield services", rfqs: 641, claimed: 70, label: "severe" }, // 9.16
    { name: "HVAC & refrigeration", rfqs: 2884, claimed: 490, label: "severe" }, // 5.88
    { name: "Industrial & MEP supplies", rfqs: 3104, claimed: 1068, label: "watch" }, // 2.91
    { name: "Healthcare clinics & labs", rfqs: 412, claimed: 902, label: "healthy" }, // 0.46
    { name: "Beauty, salons & spas", rfqs: 88, claimed: 2072, label: "oversupplied" }, // 0.04
  ] as const;

  for (const row of drawn) {
    it(`labels ${row.name} ${row.label}`, () => {
      expect(supplyGapLabel(supplyGapRatio(row.rfqs, row.claimed))).toBe(row.label);
    });
  }

  it("states the owner's thresholds", () => {
    expect(SUPPLY_GAP_RULE).toEqual({ severe: 5, watch: 2, healthy: 0.2 });
  });

  it("is inclusive at each threshold", () => {
    expect(supplyGapLabel(5)).toBe("severe");
    expect(supplyGapLabel(4.999)).toBe("watch");
    expect(supplyGapLabel(2)).toBe("watch");
    expect(supplyGapLabel(0.2)).toBe("healthy");
    expect(supplyGapLabel(0.19)).toBe("oversupplied");
  });

  it("calls demand with nobody to answer it the most severe gap, not a division error", () => {
    expect(supplyGapRatio(12, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(supplyGapLabel(supplyGapRatio(12, 0))).toBe("severe");
  });

  it("finds nothing at all in a sector with no demand and no supply", () => {
    expect(supplyGapRatio(0, 0)).toBeNull();
    expect(supplyGapLabel(null)).toBe("no_demand");
  });

  it("sorts the thinnest supply first, the empty sectors last, and ties by name", () => {
    const rows = [
      { name: "B", ratio: 1 },
      { name: "A", ratio: null },
      { name: "C", ratio: 9 },
      { name: "D", ratio: 1 },
      { name: "E", ratio: Number.POSITIVE_INFINITY },
    ];
    expect([...rows].sort(bySupplyGap).map((row) => row.name)).toEqual(["E", "C", "B", "D", "A"]);
  });
});

describe("B5 — one scale per chart", () => {
  const month = (key: string, values: Partial<ChartMonth>): ChartMonth => ({
    key,
    from: `${key}-01T00:00:00+04:00`,
    claims: 0,
    upgrades: 0,
    churn: 0,
    rfqs: 0,
    partial: false,
    ...values,
  });

  it("never lets a stack pass the top of its plot", () => {
    /*
       The export's failure: from March the stacks summed to 97–135% of the
       plot and flex-shrink drew the last six months at one height.
    */
    const months = [
      month("2026-03", { claims: 400, upgrades: 140 }),
      month("2026-04", { claims: 520, upgrades: 210 }),
      month("2026-05", { claims: 842, upgrades: 330, rfqs: 300 }),
    ];
    const geometry = chartGeometry(months);
    for (const point of months) {
      expect(point.claims + point.upgrades).toBeLessThanOrEqual(geometry.upCeiling);
      expect(point.rfqs).toBeLessThanOrEqual(geometry.upCeiling);
    }
    expect(geometry.ticks[geometry.ticks.length - 1]).toBe(geometry.upCeiling);
  });

  it("scales to demand when demand is the taller series", () => {
    const geometry = chartGeometry([month("2026-09", { claims: 1, upgrades: 2, rfqs: 272 })]);
    expect(geometry.upCeiling).toBeGreaterThanOrEqual(272);
  });

  it("draws churn below the axis on the same scale, never stacked onto growth", () => {
    const geometry = chartGeometry([month("2026-08", { claims: 40, churn: 7 }), month("2026-09", { claims: 10, churn: 15 })]);
    expect(geometry.downCeiling).toBeGreaterThanOrEqual(15);
    expect(geometry.upCeiling % geometry.step).toBe(0);
    // A unit is the same height on both sides: the shares are in the ratio of the ceilings.
    expect(geometry.upShare).toBeCloseTo(geometry.upCeiling / (geometry.upCeiling + geometry.downCeiling));
  });

  it("gives a little churn a little room, not a whole step of the axis", () => {
    // The seed's month: 272 RFQs above, seven cancellations below.
    const geometry = chartGeometry([month("2026-09", { claims: 1, upgrades: 2, rfqs: 272, churn: 7 })]);
    expect(geometry.step).toBe(100);
    expect(geometry.downCeiling).toBe(10);
    expect(geometry.downTicks).toEqual([10]);
    expect(1 - geometry.upShare).toBeLessThan(0.05);
  });

  it("gives the whole plot to growth when nothing churned", () => {
    const geometry = chartGeometry([month("2026-09", { claims: 3 })]);
    expect(geometry.downCeiling).toBe(0);
    expect(geometry.downTicks).toEqual([]);
    expect(geometry.upShare).toBe(1);
  });

  it("still has an axis to read on a month with nothing in it", () => {
    const geometry = chartGeometry([month("2026-09", {})]);
    expect(geometry.upCeiling).toBeGreaterThan(0);
    expect(geometry.ticks[0]).toBe(0);
  });

  it("steps an axis in ones, twos and fives", () => {
    expect(niceStep(0.3)).toBe(1);
    expect(niceStep(3)).toBe(5);
    expect(niceStep(17)).toBe(20);
    expect(niceStep(68)).toBe(100);
    expect(niceStep(210)).toBe(500);
  });

  it("caps a bar at its track and draws nothing for nothing", () => {
    expect(barPercent(150, 100)).toBe(100);
    expect(barPercent(0, 100)).toBe(0);
    expect(barPercent(5, 0)).toBe(0);
    expect(barPercent(25, 100)).toBe(25);
  });
});

describe("shares", () => {
  it("is a share of something, or nothing", () => {
    expect(shareOf(11_388, 41_204)).toBeCloseTo(0.2764, 4);
    expect(shareOf(3, 0)).toBeNull();
  });
});
