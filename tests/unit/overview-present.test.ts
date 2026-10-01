import { describe, expect, it } from "vitest";
import { presentOverview } from "@/app/(admin)/admin/_overview/present";
import { mrrComposition } from "@/lib/billing/mrr-composition";
import { assembleOverview, type OverviewLive, type OverviewSnapshot } from "@/lib/console/overview-view";

/**
 * Board 4a's text, from the handoff's drawn figures — what a reader checks a
 * figure against: every percentage derives from counts on the same screen,
 * quoted value says it is self-reported (B8), and the 18% says what it is.
 */

const PLANS = [
  { id: "basic", name: "Basic", monthlyPriceAed: 99, annualMonthsCharged: 10 },
  { id: "pro", name: "Pro", monthlyPriceAed: 299, annualMonthsCharged: 10 },
];

function month(key: string, partial: boolean) {
  return { key, from: `${key}-01T00:00:00+04:00`, to: `${key}-28T00:00:00+04:00`, monthEnd: `${key}-28T00:00:00+04:00`, partial, daysElapsed: 12, daysInMonth: 30 };
}

const book = [
  ...Array.from({ length: 1_284 }, () => ({ planId: "basic", mrrFils: 9_900 })),
  ...Array.from({ length: 762 }, () => ({ planId: "pro", mrrFils: 29_900 })),
];

const SNAPSHOT: OverviewSnapshot = {
  period: month("2026-08", false),
  previous: month("2026-07", false),
  computedAt: "2026-09-01T02:00:00.000Z",
  publishedInPeriod: 842,
  claimsApproved: 410,
  paid: { atEnd: 2_046, atStart: 1_928 },
  mrr: { endingFils: 35_495_400, startingFils: 32_448_000, composition: mrrComposition(book, PLANS) },
  quoted: { current: { fils: 1_840_000_000, quotes: 1_210, proposals: 0 }, previous: { fils: 1_508_196_721, quotes: 1_002, proposals: 0 } },
  chart: Array.from({ length: 12 }, (_, index) => ({
    key: `m${index}`,
    from: `2025-${String(9 + index > 12 ? index - 3 : 9 + index).padStart(2, "0")}-01T00:00:00+04:00`,
    claims: 300 + index * 40,
    upgrades: 60 + index * 25,
    churn: 20 + index * 4,
    rfqs: 900 + index * 120,
    partial: false,
  })),
  rfqWindow: { from: "2026-08-02T08:00:00.000Z", to: "2026-09-01T08:00:00.000Z" },
  sectorRfqs: { hvac: 2_884 },
  noGoodResult: { rows: [], checked: 20 },
  conversion: { cohort: 0, converted: 0, rate: null, claimedFrom: null, claimedTo: null },
};

const LIVE: OverviewLive = {
  now: "2026-09-01T08:00:00.000Z",
  listingsLive: 41_204,
  claimed: 11_388,
  claimedLive: 11_388,
  planMix: [
    { planId: "basic", planName: "Basic", listPriceFils: 9_900, accounts: 1_284 },
    { planId: "pro", planName: "Pro", listPriceFils: 29_900, accounts: 762 },
  ],
  sectors: [{ id: "hvac", name: "HVAC & refrigeration", listings: 1_196, claimed: 490 }],
  queue: { open: 318, overSla: 41, conflicts: 6, lastDecidedAt: null },
  reports: { open: 46, overSla: 0, types: [{ type: "review_dispute", count: 23 }] },
  status: { state: "normal" },
  otherQueues: [],
  warnings: [],
  opens: [],
};

const screen = presentOverview(assembleOverview(SNAPSHOT, LIVE, () => true));
const tile = (key: string) => screen.tiles.find((candidate) => candidate.key === key)!;

describe("the tiles say what their numbers are", () => {
  it("prints the drawn values in full, never abbreviated", () => {
    expect(tile("listings").value).toBe("41,204");
    expect(tile("claimed").value).toBe("11,388");
    expect(tile("paid").value).toBe("2,046");
    // The currency is set a size down beside the digits, never abbreviated.
    expect([tile("mrr").unit, tile("mrr").value]).toEqual(["AED", "354,954"]);
    expect([tile("quoted").unit, tile("quoted").value]).toEqual(["AED", "18,400,000"]);
    expect(tile("queue").value).toBe("318");
  });

  it("derives the claimed share from the two counts on screen", () => {
    expect(tile("claimed").lines[0]!.text).toBe("27.6% of live listings");
  });

  it("states the month's movements against the month", () => {
    expect(tile("listings").lines[0]!.text).toContain("+842 published");
    expect(tile("paid").lines[0]!.text).toContain("+118 net");
    expect(tile("mrr").lines[0]!.text).toMatch(/^\+9\.4% since/);
  });

  it("carries self-reported on quoted value (B8)", () => {
    expect(tile("quoted").lines.map((line) => line.text).join(" ")).toContain("self-reported");
  });

  it("makes the queue the one red tile, with its over-SLA count", () => {
    expect(screen.tiles.filter((candidate) => candidate.urgent).map((candidate) => candidate.key)).toEqual(["queue"]);
    expect(tile("queue").lines[0]!.text).toBe("41 over SLA");
  });

  it("says which tiles the month moves", () => {
    expect(tile("listings").scope).toBe("Now");
    expect(tile("mrr").scope).not.toBe("Now");
  });
});

describe("the chart is drawn on one scale (B5)", () => {
  it("draws no bar past its plot", () => {
    for (const bar of screen.chart.bars) {
      expect(bar.claimsPct + bar.upgradesPct).toBeLessThanOrEqual(100);
      expect(bar.rfqsPct).toBeLessThanOrEqual(100);
      expect(bar.churnPct).toBeLessThanOrEqual(100);
    }
  });

  it("prints a y-axis with values", () => {
    expect(screen.chart.ticks.length).toBeGreaterThan(1);
    expect(screen.chart.ticks[0]!.value).toBe("0");
  });
});

describe("the plan mix and its footnote", () => {
  it("names the 18% for what it is until a cohort can say otherwise (D-CONVERSION)", () => {
    expect(screen.planMix!.conversion).toBe(
      "18.0% of claimed businesses pay today. No claim is 90 days old yet, so no cohort can say how many convert within 90 days.",
    );
  });

  it("prints MRR's composition, adding up to the ledger (D-MRR)", () => {
    const rows = screen.planMix!.composition;
    expect(rows.map((row) => row.amount)).toEqual(["AED 127,116", "AED 227,838", "AED 354,954", "AED 354,954"]);
  });
});

describe("the rules are printed where the figures are", () => {
  it("prints the supply-gap rule under the table (B6)", () => {
    expect(screen.categories.rule).toContain("Severe from 5");
    expect(screen.categories.rule).toContain("Watch from 2");
    expect(screen.categories.rule).toContain("Healthy from 0.2");
  });

  it("prints the no-good-result rule under the card, and says when every search was fine", () => {
    expect(screen.searches.rule).toContain("first 20 suppliers");
    expect(screen.searches.empty).toBe("Every top search found a claimed, licence-verified supplier on the first page.");
  });
});
