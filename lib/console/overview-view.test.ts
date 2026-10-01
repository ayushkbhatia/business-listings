import { describe, expect, it } from "vitest";
import type { Actor } from "@/lib/auth/roles";
import { mrrComposition } from "@/lib/billing/mrr-composition";
import {
  assembleOverview,
  figureKind,
  isFigureKey,
  ownerWarnings,
  type OverviewLive,
  type OverviewSnapshot,
  type OverviewView,
} from "./overview-view";
import { mayOpen } from "./visibility";

/**
 * Board 4a, assembled — Phase 2's tests on the view the API returns and the
 * page draws: every figure carries its link, a moderator's view has no MRR or
 * plan mix, and changing the month moves no live figure.
 *
 * The fixtures are the handoff's own drawn figures.
 */

const actor = (...roles: Actor["roles"]): Actor => ({ id: "u1", roles });
const OPS = actor("staff_ops_lead");
const MODERATOR = actor("staff_moderator");
const FINANCE = actor("staff_finance");
const EVERYTHING = actor("staff_ops_lead", "staff_moderator", "staff_finance");

const PLANS = [
  { id: "basic", name: "Basic", monthlyPriceAed: 99, annualMonthsCharged: 10 },
  { id: "pro", name: "Pro", monthlyPriceAed: 299, annualMonthsCharged: 10 },
];

function period(key: string, partial: boolean) {
  return {
    key,
    from: `${key}-01T00:00:00+04:00`,
    to: `${key}-28T00:00:00+04:00`,
    monthEnd: `${key}-28T00:00:00+04:00`,
    partial,
    daysElapsed: partial ? 12 : 30,
    daysInMonth: 30,
  };
}

function snapshot(key: string, partial: boolean, overrides: Partial<OverviewSnapshot> = {}): OverviewSnapshot {
  const book = [
    ...Array.from({ length: 1_284 }, () => ({ planId: "basic", mrrFils: 9_900 })),
    ...Array.from({ length: 762 }, () => ({ planId: "pro", mrrFils: 29_900 })),
  ];
  return {
    period: period(key, partial),
    previous: period("2026-07", false),
    computedAt: "2026-09-12T02:00:00.000Z",
    publishedInPeriod: 842,
    claimsApproved: 410,
    paid: { atEnd: 2_046, atStart: 1_928 },
    mrr: { endingFils: 354_954_00, startingFils: 340_000_00, composition: mrrComposition(book, PLANS) },
    quoted: { current: { fils: 18_400_000_00, quotes: 1_210, proposals: 14 }, previous: { fils: 15_080_000_00, quotes: 1_002, proposals: 9 } },
    chart: [],
    rfqWindow: { from: "2026-08-13T08:00:00.000Z", to: "2026-09-12T08:00:00.000Z" },
    sectorRfqs: { hvac: 2_884, health: 412, mep: 3_104, beauty: 88, quiet: 0 },
    noGoodResult: { rows: [{ query: "chiller rental dubai", normalised: "chiller rental dubai", searches: 1_284, suppliersToday: 3 }], checked: 20 },
    conversion: { cohort: 0, converted: 0, rate: null, claimedFrom: null, claimedTo: null },
    ...overrides,
  };
}

function live(overrides: Partial<OverviewLive> = {}): OverviewLive {
  return {
    now: "2026-09-12T08:00:00.000Z",
    listingsLive: 41_204,
    claimed: 11_388,
    claimedLive: 11_388,
    planMix: [
      { planId: "basic", planName: "Basic", listPriceFils: 9_900, accounts: 1_284 },
      { planId: "pro", planName: "Pro", listPriceFils: 29_900, accounts: 762 },
    ],
    sectors: [
      { id: "hvac", name: "HVAC & refrigeration", listings: 1_196, claimed: 490 },
      { id: "health", name: "Healthcare clinics & labs", listings: 1_455, claimed: 902 },
      { id: "mep", name: "Industrial & MEP supplies", listings: 1_842, claimed: 1_068 },
      { id: "beauty", name: "Beauty, salons & spas", listings: 2_918, claimed: 2_072 },
      { id: "quiet", name: "Pumps & motors", listings: 0, claimed: 0 },
    ],
    queue: { open: 318, overSla: 41, conflicts: 6, lastDecidedAt: "2026-09-12T06:20:00.000Z" },
    reports: {
      open: 46,
      overSla: 3,
      types: [
        { type: "off_platform_payment", count: 2 },
        { type: "review_dispute", count: 23 },
        { type: "wrong_details", count: 0 },
        { type: "closed", count: 9 },
      ],
    },
    status: { state: "normal" },
    otherQueues: [
      { key: "import_runs", count: 2 },
      { key: "past_due", count: 5 },
    ],
    warnings: [],
    opens: [],
    ...overrides,
  };
}

const view = (seat: Actor, snap = snapshot("2026-09", true), block = live()): OverviewView =>
  assembleOverview(snap, block, (navKey) => mayOpen(seat, navKey));

describe("B1 — every figure links into the board that owns it", () => {
  it("gives every figure a destination for a seat that may open them all", () => {
    const all = view(EVERYTHING);
    for (const tile of all.tiles) expect(tile.href, tile.key).not.toBeNull();
    for (const row of all.needsHuman!.rows) expect(row.href, row.key).not.toBeNull();
    for (const row of all.planMix!.rows) expect(row.href, row.key).not.toBeNull();
    for (const row of all.categories.rows) {
      expect(row.links.sector, row.name).not.toBeNull();
      expect(row.links.listings, row.name).not.toBeNull();
      expect(row.links.claimed, row.name).not.toBeNull();
    }
  });

  it("links with the filter that reproduces the figure", () => {
    const all = view(EVERYTHING);
    const href = (key: string) => all.tiles.find((tile) => tile.key === key)?.href;
    expect(href("listings")).toBe("/admin/businesses?status=live");
    expect(href("claimed")).toBe("/admin/businesses?claimed=1");
    expect(href("paid")).toBe("/admin/businesses?paying=1");
    expect(href("mrr")).toBe("/admin/revenue?period=2026-09");
    expect(href("quoted")).toBe("/admin/quotes?period=2026-09");
    expect(href("queue")).toBe("/admin/queue");
    const human = Object.fromEntries(all.needsHuman!.rows.map((row) => [row.key, row.href]));
    expect(human["queue_over_sla"]).toBe("/admin/queue?overdue=1");
    expect(human["conflicts"]).toBe("/admin/queue?kind=conflict");
    expect(human["reports_over_sla"]).toBe("/admin/reports?late=1");
    expect(human["report:review_dispute"]).toBe("/admin/reports?type=review_dispute");
  });

  it("sends a recruit label to the call list for its sector, and only a severe one", () => {
    const rows = view(EVERYTHING).categories.rows;
    const hvac = rows.find((row) => row.sectorId === "hvac")!;
    expect(hvac.label).toBe("severe");
    expect(hvac.links.recruit).toBe("/admin/crm?category=hvac");
    for (const row of rows.filter((candidate) => candidate.label !== "severe")) expect(row.links.recruit).toBeNull();
  });
});

describe("B2 — needs a human reads 4h's own types, not a second taxonomy", () => {
  it("lists every 4h type with anything open, by its own name, and no other", () => {
    const rows = view(OPS).needsHuman!.rows.filter((row) => row.reportType);
    expect(rows.map((row) => row.reportType)).toEqual(["off_platform_payment", "review_dispute", "closed"]);
    expect(rows.map((row) => row.count)).toEqual([2, 23, 9]);
  });

  it("is clear only when nothing is over a service level and no conflict is open", () => {
    expect(view(OPS).needsHuman!.overdue).toBe(41 + 3 + 6);
    const quiet = view(OPS, snapshot("2026-09", true), live({ queue: { open: 4, overSla: 0, conflicts: 0, lastDecidedAt: null }, reports: { open: 1, overSla: 0, types: [] } }));
    expect(quiet.needsHuman!.overdue).toBe(0);
  });
});

describe("B10 — finance figures follow the matrix", () => {
  it("omits MRR and the plan mix for a moderator, rather than showing them blank", () => {
    const moderator = view(MODERATOR);
    expect(moderator.tiles.map((tile) => tile.key)).toEqual(["listings", "claimed", "paid", "quoted", "queue"]);
    expect(moderator.figures.mrr).toBeUndefined();
    expect(moderator.planMix).toBeUndefined();
  });

  it("omits them for an ops lead too, whom §07 gives no revenue.read", () => {
    const ops = view(OPS);
    expect(ops.tiles.some((tile) => tile.key === "mrr")).toBe(false);
    expect(ops.planMix).toBeUndefined();
  });

  it("gives finance MRR and the plan mix, and no queue it cannot open", () => {
    const finance = view(FINANCE, snapshot("2026-09", true), live({ queue: null, reports: null }));
    expect(finance.tiles.map((tile) => tile.key)).toEqual(["listings", "claimed", "paid", "mrr", "quoted"]);
    expect(finance.needsHuman).toBeUndefined();
    expect(finance.planMix).toBeDefined();
  });
});

describe("criterion 3 — the plan mix adds up", () => {
  it("sums to Claimed, and Basic + Pro equals Paid", () => {
    const all = view(EVERYTHING);
    const rows = all.planMix!.rows;
    expect(rows.reduce((sum, row) => sum + row.accounts, 0)).toBe(all.figures.claimed.value);
    expect(rows.find((row) => row.key === "free")!.accounts).toBe(9_342);
    const paid = rows.filter((row) => row.planId !== null).reduce((sum, row) => sum + row.accounts, 0);
    expect(paid).toBe(all.figures.paid.atEnd);
  });

  it("draws every bar as a share of claimed — one scale", () => {
    const rows = view(EVERYTHING).planMix!.rows;
    expect(rows.find((row) => row.key === "free")!.share).toBeCloseTo(9_342 / 11_388);
    expect(rows.find((row) => row.key === "plan:basic")!.share).toBeCloseTo(1_284 / 11_388);
    expect(rows.find((row) => row.key === "plan:pro")!.share).toBeCloseTo(762 / 11_388);
  });

  it("derives 27.6% from the counts, not from a constant", () => {
    expect(view(OPS).figures.claimed.share).toBeCloseTo(0.2764, 4);
  });
});

describe("B4 — the period picker moves period figures only", () => {
  it("leaves every live figure identical when the month changes", () => {
    const block = live();
    const september = view(OPS, snapshot("2026-09", true), block);
    const july = view(OPS, snapshot("2026-07", false, { paid: { atEnd: 1_900, atStart: 1_850 }, publishedInPeriod: 610 }), block);
    const liveOf = (v: OverviewView) => ({
      tiles: v.tiles.filter((tile) => tile.scope === "now").map((tile) => [tile.key, tile.value, tile.href]),
      needsHuman: v.needsHuman,
      otherQueues: v.otherQueues,
      status: v.status,
      claimed: v.figures.claimed.value,
    });
    expect(liveOf(july)).toEqual(liveOf(september));
    expect(july.figures.paid.atEnd).not.toBe(september.figures.paid.atEnd);
  });

  it("marks which tiles the picker moves", () => {
    const scopes = Object.fromEntries(view(EVERYTHING).tiles.map((tile) => [tile.key, tile.scope]));
    expect(scopes).toEqual({ listings: "now", claimed: "now", paid: "period", mrr: "period", quoted: "period", queue: "now" });
  });

  it("puts a disagreement about now on a month's tile only while that month is running", () => {
    const warnings: OverviewLive["warnings"] = [{ kind: "paying_ledger", tile: "paid", ours: 15, theirs: 14 }];
    expect(view(OPS, snapshot("2026-09", true), live({ warnings })).tiles.find((tile) => tile.key === "paid")!.warnings).toHaveLength(1);
    expect(view(OPS, snapshot("2026-07", false), live({ warnings })).tiles.find((tile) => tile.key === "paid")!.warnings).toHaveLength(0);
  });
});

describe("B6, B7 — category health", () => {
  it("lists sectors thinnest supply first, labels derived from the ratio", () => {
    const rows = view(OPS).categories.rows;
    expect(rows.map((row) => [row.sectorId, row.label])).toEqual([
      ["hvac", "severe"],
      ["mep", "watch"],
      ["health", "healthy"],
      ["beauty", "oversupplied"],
      ["quiet", "no_demand"],
    ]);
  });
});

describe("the click log's keys", () => {
  it("accepts the overview's own figure keys", () => {
    for (const key of ["queue", "report:review_dispute", "plan:basic", "free", "recruit", "licences_expiring"]) {
      expect(isFigureKey(key), key).toBe(true);
    }
    expect(figureKind("report:review_dispute")).toBe("report");
  });

  it("refuses anything else before it is stored", () => {
    for (const key of ["", "drop table", "queue:../../x", "unknown", "x".repeat(70), 3]) {
      expect(isFigureKey(key), String(key)).toBe(false);
    }
  });
});

describe("Phase 5 — where two owners state one figure", () => {
  const agreed = {
    treeListings: 41_204,
    homeListings: 41_204,
    ledgerPayers: 2_046,
    subscriptionPayers: 2_046,
    claimedLedgerPayers: 2_046,
    planColumnPayers: 2_046,
    mrr: { agrees: true, ledgerFils: 1, liveFils: 1 },
  };

  it("says nothing when every owner agrees", () => {
    expect(ownerWarnings(agreed)).toEqual([]);
  });

  it("names each disagreement on the tile that carries it, with both figures", () => {
    const warnings = ownerWarnings({
      ...agreed,
      homeListings: 41_190,
      subscriptionPayers: 2_051,
      planColumnPayers: 2_143,
      claimedLedgerPayers: 2_044,
      mrr: { agrees: false, ledgerFils: 38_825_400, liveFils: 38_800_000 },
    });
    expect(warnings).toEqual([
      { kind: "listings_home", tile: "listings", ours: 41_204, theirs: 41_190 },
      { kind: "paying_ledger", tile: "paid", ours: 2_046, theirs: 2_051 },
      { kind: "plan_column", tile: "paid", ours: 2_044, theirs: 2_143 },
      { kind: "unclaimed_payers", tile: "paid", ours: 2, theirs: 0 },
      { kind: "mrr_ledger", tile: "mrr", ours: 38_825_400, theirs: 38_800_000 },
    ]);
  });

  it("leaves MRR alone for a seat that cannot see it", () => {
    expect(ownerWarnings({ ...agreed, mrr: null })).toEqual([]);
  });
});
