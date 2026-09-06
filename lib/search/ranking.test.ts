import { describe, expect, it } from "vitest";
import { TOP_ACHIEVABLE_TIER } from "@/lib/verification";
import {
  DEFAULT_WEIGHTS,
  placeSponsored,
  rank,
  scoreRow,
  type RankSignals,
} from "./ranking";

const base: RankSignals = {
  relevance: 0.5,
  verificationTier: 0,
  responseTimeMedianMs: null,
  specCompleteness: null,
  distanceKm: null,
  planMultiplier: 1,
};

const signals = (overrides: Partial<RankSignals>): RankSignals => ({ ...base, ...overrides });

describe("the weights are the config board 12c specifies", () => {
  it("sums to 100, with plan tier the smallest", () => {
    const total = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(100);
    expect(DEFAULT_WEIGHTS.planTier).toBe(6);
    expect(Math.min(...Object.values(DEFAULT_WEIGHTS))).toBe(DEFAULT_WEIGHTS.planTier);
  });

  it("keeps plan tier under the point where buyers notice", () => {
    // Board 12c: above about 10 the results stop being useful.
    expect(DEFAULT_WEIGHTS.planTier).toBeLessThanOrEqual(10);
  });
});

describe("acceptance criterion 5 — the weights are a config object", () => {
  // Tier 2, the top rung anybody can reach. It read 3, which is now trade
  // references — reserved and unbuilt — so the fixture described a supplier
  // that cannot exist.
  const free = { id: "free", signals: signals({ verificationTier: 2, planMultiplier: 1 }) };
  const pro = { id: "pro", signals: signals({ verificationTier: 2, planMultiplier: 1.35 }) };

  it("plan tier reorders two otherwise identical suppliers", () => {
    const ordered = rank([free, pro], (r) => r.signals);
    expect(ordered.map((r) => r.id)).toEqual(["pro", "free"]);
  });

  it("setting the plan-tier weight to zero measurably reorders them back", () => {
    const withPlan = rank([free, pro], (r) => r.signals);
    const withoutPlan = rank([free, pro], (r) => r.signals, {
      ...DEFAULT_WEIGHTS,
      planTier: 0,
    });

    expect(withPlan.map((r) => r.id)).toEqual(["pro", "free"]);
    // With the weight at zero the two score identically, so the input order
    // survives — the paid supplier no longer wins.
    expect(withoutPlan.map((r) => r.id)).toEqual(["free", "pro"]);

    expect(scoreRow(pro.signals, { ...DEFAULT_WEIGHTS, planTier: 0 })).toBe(
      scoreRow(free.signals, { ...DEFAULT_WEIGHTS, planTier: 0 }),
    );
  });

  it("cannot buy its way past verification", () => {
    // A free supplier on the top rung beats a paying unverified one, by a wide
    // margin. The whole subscription rests on this staying true.
    //
    // `TOP_ACHIEVABLE_TIER` rather than the literal 4 this carried: the ladder
    // stopped at 3 when site visits were withdrawn and stops at 2 in practice,
    // and `trustScore` clamps — so the old fixture was asserting about a rung
    // that neither exists nor scores differently from the one that does.
    const paidUnverified = signals({ verificationTier: 0, planMultiplier: 1.35 });
    const freeVerified = signals({ verificationTier: TOP_ACHIEVABLE_TIER, planMultiplier: 1 });
    expect(scoreRow(freeVerified)).toBeGreaterThan(scoreRow(paidUnverified));
  });
});

describe("unmeasured signals", () => {
  it("score half, not zero", () => {
    // Scoring an unmeasured response time as "slowest possible" would bury
    // every new listing on its first day and freeze the top of every category.
    const unmeasured = scoreRow(signals({ responseTimeMedianMs: null }));
    const slowest = scoreRow(signals({ responseTimeMedianMs: 30 * 24 * 3_600_000 }));
    const fastest = scoreRow(signals({ responseTimeMedianMs: 60_000 }));
    expect(unmeasured).toBeGreaterThan(slowest);
    expect(unmeasured).toBeLessThan(fastest);
  });

  it("treats an unknown distance the same way", () => {
    // We never ask a buyer where they are, so most rows have no distance.
    const unknown = scoreRow(signals({ distanceKm: null }));
    const faraway = scoreRow(signals({ distanceKm: 200 }));
    expect(unknown).toBeGreaterThan(faraway);
  });
});

describe("response time banding", () => {
  it("rewards a reply inside a working morning and gives up after a week", () => {
    const hour = 3_600_000;
    expect(scoreRow(signals({ responseTimeMedianMs: hour }))).toBe(
      scoreRow(signals({ responseTimeMedianMs: 4 * hour })),
    );
    expect(scoreRow(signals({ responseTimeMedianMs: 8 * 24 * hour }))).toBe(
      scoreRow(signals({ responseTimeMedianMs: 30 * 24 * hour })),
    );
  });
});

describe("the sponsored slot", () => {
  const rows = [{ id: "a" }, { id: "b" }, { id: "sponsor" }];
  const idOf = (r: { id: string }) => r.id;

  it("takes the top slot on an unfiltered page", () => {
    const placed = placeSponsored(rows, "sponsor", idOf, false);
    expect(placed.rows.map(idOf)).toEqual(["sponsor", "a", "b"]);
    expect(placed.sponsoredId).toBe("sponsor");
  });

  it("never outranks a verified supplier on a filter the buyer set", () => {
    // A buyer who ticked "tier 3 and up" has said what they care about.
    // Selling the top of that list is the fastest way to make the filter
    // worthless — so the sponsor keeps its natural position, still labelled.
    const placed = placeSponsored(rows, "sponsor", idOf, true);
    expect(placed.rows.map(idOf)).toEqual(["a", "b", "sponsor"]);
    expect(placed.sponsoredId).toBe("sponsor");
  });

  it("is not labelled when it does not match the query at all", () => {
    const placed = placeSponsored([{ id: "a" }], "sponsor", idOf, false);
    expect(placed.sponsoredId).toBeNull();
    expect(placed.rows.map(idOf)).toEqual(["a"]);
  });

  it("is at most one per page", () => {
    const placed = placeSponsored(rows, "sponsor", idOf, false);
    expect(placed.rows.filter((r) => r.id === placed.sponsoredId)).toHaveLength(1);
  });
});
