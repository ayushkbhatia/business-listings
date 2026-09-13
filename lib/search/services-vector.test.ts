import { describe, expect, it } from "vitest";
import {
  appliedVector,
  DEFAULT_SERVICES_WEIGHTS,
  DEFAULT_WEIGHTS,
  factorScores,
  FACTOR_SOURCES,
  gainsLabelKey,
  mergeByBand,
  PINNED_KEYS,
  PLAN_TIER_CEILING,
  planTierAgrees,
  rank,
  rankBlended,
  relevanceBand,
  scoreRow,
  unwiredSlots,
  WEIGHT_TOTAL,
  weightLabelKey,
  weightsForBrowse,
  weightsTotal,
  type RankSignals,
  type RankingKind,
} from "./ranking";

/**
 * Board `12c-s` — the services vector, as arithmetic.
 *
 * Eleven acceptance criteria, and the pure ones are proven here without a
 * database: which slots measure what (2, 4), the publish gate (3), plan tier on
 * both vectors (5, 6), and the ordering rule that keeps a publish of one vector
 * from moving the other (7, 8). The database halves are in
 * `tests/integration/ranking-services.test.ts`.
 */

const base: RankSignals = {
  relevance: 1,
  verificationTier: 1,
  responseTimeMedianMs: null,
  specCompleteness: null,
  distanceKm: null,
  planMultiplier: 1,
};

const signals = (overrides: Partial<RankSignals>): RankSignals => ({ ...base, ...overrides });

describe("the services vector as the board proposes it", () => {
  it("totals 100, the same as the goods vector", () => {
    expect(weightsTotal(DEFAULT_SERVICES_WEIGHTS)).toBe(WEIGHT_TOTAL);
    expect(weightsTotal(DEFAULT_WEIGHTS)).toBe(WEIGHT_TOTAL);
  });

  it("moves four points out of relevance — two to verification, two to reply time", () => {
    expect(DEFAULT_WEIGHTS.relevance - DEFAULT_SERVICES_WEIGHTS.relevance).toBe(4);
    expect(DEFAULT_SERVICES_WEIGHTS.verificationTier - DEFAULT_WEIGHTS.verificationTier).toBe(2);
    expect(DEFAULT_SERVICES_WEIGHTS.responseTime - DEFAULT_WEIGHTS.responseTime).toBe(2);
  });

  it("replaces two factors at the same weights, rather than removing them", () => {
    expect(DEFAULT_SERVICES_WEIGHTS.specCompleteness).toBe(DEFAULT_WEIGHTS.specCompleteness);
    expect(DEFAULT_SERVICES_WEIGHTS.distance).toBe(DEFAULT_WEIGHTS.distance);
  });

  it("criterion 5 — plan tier is the same number, under the same ceiling", () => {
    expect(DEFAULT_SERVICES_WEIGHTS.planTier).toBe(DEFAULT_WEIGHTS.planTier);
    expect(DEFAULT_SERVICES_WEIGHTS.planTier).toBeLessThanOrEqual(PLAN_TIER_CEILING);
  });

  it("pins coverage match, as distance is pinned", () => {
    expect(PINNED_KEYS).toContain("distance");
  });
});

describe("criterion 6 — the ceiling on the effective browse vector, both kinds", () => {
  it("lands the proposal under the cap on a page with no query", () => {
    const effective = weightsForBrowse(DEFAULT_SERVICES_WEIGHTS, "redistribute");
    // The board's 8.6, rounded by largest remainder so the total survives.
    expect(effective.planTier).toBe(9);
    expect(effective.planTier).toBeLessThanOrEqual(PLAN_TIER_CEILING);
    expect(weightsTotal(effective)).toBe(WEIGHT_TOTAL);
  });

  it("breaches at relevance 50 exactly as the goods vector does — luck, not safety", () => {
    const moved = { ...DEFAULT_SERVICES_WEIGHTS, relevance: 50, verificationTier: 18, responseTime: 10, specCompleteness: 10, distance: 6, planTier: 6 };
    expect(weightsTotal(moved)).toBe(WEIGHT_TOTAL);
    expect(weightsForBrowse(moved, "redistribute").planTier).toBeGreaterThan(PLAN_TIER_CEILING);
  });
});

describe("criterion 2 and 4 — what the fourth and fifth slots measure", () => {
  it("scores scope completeness, not spec completeness, on the services vector", () => {
    const firm = signals({ specCompleteness: 1, scopeCompleteness: 0 });
    expect(factorScores(firm, "goods").specCompleteness).toBe(1);
    expect(factorScores(firm, "services").specCompleteness).toBe(0);
  });

  it("scores coverage as a yes or a no, never kilometres", () => {
    const near = signals({ distanceKm: 1, coverageMatch: false });
    const far = signals({ distanceKm: 90, coverageMatch: true });
    expect(factorScores(near, "services").distance).toBe(0);
    expect(factorScores(far, "services").distance).toBe(1);
    // And the goods vector still reads the kilometres.
    expect(factorScores(near, "goods").distance).toBe(1);
  });

  it("scores an unknown as half on both slots — no place named, nothing stated", () => {
    const unknown = factorScores(signals({ scopeCompleteness: null, coverageMatch: null }), "services");
    expect(unknown.specCompleteness).toBe(0.5);
    expect(unknown.distance).toBe(0.5);
  });

  it("the defect, reproduced: a services firm cannot move the goods vector's completeness slot", () => {
    // No products, so spec completeness is null — scored as half, whatever the
    // firm fills in. Scope completeness from 0 to 1 moves nothing on goods.
    const empty = signals({ specCompleteness: null, scopeCompleteness: 0 });
    const full = signals({ specCompleteness: null, scopeCompleteness: 1 });
    expect(scoreRow(full, DEFAULT_WEIGHTS, "goods")).toBe(scoreRow(empty, DEFAULT_WEIGHTS, "goods"));
    expect(scoreRow(full, DEFAULT_SERVICES_WEIGHTS, "services")).toBeGreaterThan(
      scoreRow(empty, DEFAULT_SERVICES_WEIGHTS, "services"),
    );
  });
});

describe("criterion 3 — publish is blocked until scope completeness is wired", () => {
  it("finds the shipped services map wired", () => {
    expect(unwiredSlots("services")).toEqual([]);
    expect(FACTOR_SOURCES.services).toEqual({ specCompleteness: "scope", distance: "coverage" });
  });

  it("names both slots on a services map still reading the goods measures", () => {
    expect(unwiredSlots("services", { specCompleteness: "spec", distance: "distance" })).toEqual([
      "specCompleteness",
      "distance",
    ]);
    expect(unwiredSlots("services", { specCompleteness: "spec", distance: "coverage" })).toEqual([
      "specCompleteness",
    ]);
  });

  it("never blocks the goods vector, whose measures are the goods ones", () => {
    expect(unwiredSlots("goods")).toEqual([]);
  });
});

describe("B5 — plan tier agrees across the pair", () => {
  it("agrees with the other vector's live number", () => {
    expect(planTierAgrees(6, { live: 6, draft: null })).toBe(true);
    expect(planTierAgrees(7, { live: 6, draft: null })).toBe(false);
  });

  it("agrees with the draft waiting to follow it, so the pair can move at all", () => {
    // Goods publishes 7 while services has a draft at 7; then services
    // publishes against goods live at 7. Neither step breaks the rule.
    expect(planTierAgrees(7, { live: 6, draft: 7 })).toBe(true);
    expect(planTierAgrees(7, { live: 7, draft: null })).toBe(true);
  });

  it("is unconstrained by a vector nobody has published or drafted", () => {
    expect(planTierAgrees(8, { live: null, draft: null })).toBe(true);
  });
});

describe("B11 — which vector a listing ranks on today", () => {
  it("ranks services on the goods vector until one is published", () => {
    expect(appliedVector("services", false)).toBe("goods");
    expect(appliedVector("services", true)).toBe("services");
    expect(appliedVector("goods", true)).toBe("goods");
  });
});

interface Row {
  id: string;
  kind: RankingKind;
  signals: RankSignals;
}

const row = (id: string, kind: RankingKind, overrides: Partial<RankSignals>): Row => ({
  id,
  kind,
  signals: signals(overrides),
});

const ids = (rows: readonly Row[]) => rows.map((entry) => entry.id);

describe("Q1 — one result set from two vectors", () => {
  const set: Row[] = [
    row("g-strong", "goods", { verificationTier: 2, specCompleteness: 1 }),
    row("g-weak", "goods", { verificationTier: 0, specCompleteness: 0 }),
    row("s-strong", "services", { verificationTier: 2, scopeCompleteness: 1, coverageMatch: true }),
    row("s-weak", "services", { verificationTier: 0, scopeCompleteness: 0, coverageMatch: false }),
  ];

  it("is exactly the single-vector ranking while no services vector is published", () => {
    const blended = rankBlended(set, (entry) => entry.signals, (entry) => entry.kind, {
      goods: DEFAULT_WEIGHTS,
      services: null,
    });
    expect(ids(blended)).toEqual(ids(rank(set, (entry) => entry.signals, DEFAULT_WEIGHTS)));
  });

  it("keeps each kind in exactly its own vector's order", () => {
    const blended = rankBlended(set, (entry) => entry.signals, (entry) => entry.kind, {
      goods: DEFAULT_WEIGHTS,
      services: DEFAULT_SERVICES_WEIGHTS,
    });
    const goods = ids(blended).filter((id) => id.startsWith("g-"));
    const services = ids(blended).filter((id) => id.startsWith("s-"));
    expect(goods).toEqual(["g-strong", "g-weak"]);
    expect(services).toEqual(["s-strong", "s-weak"]);
  });

  it("never lets one vector's score decide where the other kind sits", () => {
    // The services vector swung to reply time and nothing else would reorder
    // services among themselves; the goods positions must not move.
    const before = rankBlended(set, (entry) => entry.signals, (entry) => entry.kind, {
      goods: DEFAULT_WEIGHTS,
      services: DEFAULT_SERVICES_WEIGHTS,
    });
    const after = rankBlended(set, (entry) => entry.signals, (entry) => entry.kind, {
      goods: DEFAULT_WEIGHTS,
      services: { ...DEFAULT_SERVICES_WEIGHTS, relevance: 10, verificationTier: 44 },
    });
    const positions = (rows: readonly Row[]) =>
      rows.flatMap((entry, index) => (entry.kind === "goods" ? [`${entry.id}@${index}`] : []));
    expect(positions(after)).toEqual(positions(before));
  });

  it("puts the better relevance band first, whichever kind holds it", () => {
    const banded: Row[] = [
      row("g-exact", "goods", { relevance: 1 }),
      row("g-loose", "goods", { relevance: 0.35 }),
      row("s-loose", "services", { relevance: 0.35, verificationTier: 2 }),
      row("s-exact", "services", { relevance: 1, verificationTier: 0 }),
    ];
    const blended = rankBlended(banded, (entry) => entry.signals, (entry) => entry.kind, {
      goods: DEFAULT_WEIGHTS,
      services: DEFAULT_SERVICES_WEIGHTS,
    });
    // Within services the order is the vector's, so the stronger loose match
    // leads the weaker exact one — and the merge then places the goods exact
    // match first, because the services head is in the loose band.
    expect(ids(blended)[0]).toBe("g-exact");
  });

  it("spreads a minority kind through the band rather than stacking it", () => {
    const goods = Array.from({ length: 18 }, (_, index) => `g${index}`);
    const services = ["s0", "s1"];
    const merged = mergeByBand([goods, services], () => 0);
    expect(merged).toHaveLength(20);
    expect(merged.indexOf("s0")).toBeGreaterThan(2);
    expect(merged.indexOf("s1")).toBeLessThan(18);
    // Deterministic: the same inputs merge the same way.
    expect(mergeByBand([goods, services], () => 0)).toEqual(merged);
  });

  it("reads the bands off relevanceOf's own arithmetic", () => {
    expect(relevanceBand(1)).toBe(0);
    expect(relevanceBand(0.35 + 0.65 * 0.5)).toBe(1);
    expect(relevanceBand(0.35)).toBe(2);
    expect(relevanceBand(0.5)).toBe(2);
  });
});

describe("the slots are named for what they measure", () => {
  it("renames only the two replaced slots, and only on the services vector", () => {
    expect(weightLabelKey("services", "specCompleteness")).toBe("ranking.weight.services.specCompleteness");
    expect(weightLabelKey("services", "distance")).toBe("ranking.weight.services.distance");
    expect(weightLabelKey("services", "responseTime")).toBe("ranking.weight.responseTime");
    expect(weightLabelKey("goods", "specCompleteness")).toBe("ranking.weight.specCompleteness");
    expect(gainsLabelKey("services", "distance")).toBe("ranking.impact.gains.services.distance");
  });
});
