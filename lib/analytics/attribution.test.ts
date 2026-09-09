import { describe, expect, it } from "vitest";
import { DEFAULT_WEIGHTS, WEIGHT_KEYS, type RankingWeights } from "@/lib/search/ranking";
import {
  attribute,
  decompose,
  NAMEABLE_POINTS,
  type AttributionInput,
  type FactorDay,
  type RawFactors,
} from "./attribution";

/**
 * The `3a`/`3l` amendment's arithmetic, without a database.
 *
 * The rule these tests exist for is the one the amendment was written to fix:
 * **a fall the seller did not cause must not read as one they did.** Three
 * states — platform, commercial, competitor — are that rule, and each of them
 * is a case the old code could not distinguish from the seller's own decline.
 */

const HOUR = 3_600_000;

const RAW: RawFactors = {
  relevance: null,
  verificationTier: 2,
  responseTimeMedianMs: 4 * HOUR,
  specCompleteness: 0.74,
  distanceKm: null,
  planMultiplier: 1.35,
};

function day(overrides: Partial<FactorDay> = {}): FactorDay {
  return {
    scores: {
      relevance: 0.8,
      verificationTier: 1,
      responseTime: 1,
      specCompleteness: 0.74,
      distance: 0.5,
      planTier: 1,
    },
    raw: RAW,
    weights: DEFAULT_WEIGHTS,
    boostPoints: 0,
    ...overrides,
  };
}

function input(overrides: Partial<AttributionInput> = {}): AttributionInput {
  return {
    before: day(),
    after: day(),
    positionBefore: 8,
    positionAfter: 14,
    historyStarts: new Date("2026-06-10T00:00:00Z"),
    on: new Date("2026-09-02T00:00:00Z"),
    ...overrides,
  };
}

describe("decompose", () => {
  it("accounts for the whole score change, with no remainder", () => {
    /*
       The property that matters. The moment the split is approximate, the
       residual lands on whichever source the code checks first — and the source
       checked first is the seller.
    */
    const before = day();
    const after = day({
      scores: { ...day().scores, responseTime: 0.3, specCompleteness: 0.88 },
      weights: { ...DEFAULT_WEIGHTS, relevance: 30, verificationTier: 26 },
      boostPoints: 5,
    });

    const parts = decompose(before, after);

    expect(parts.seller + parts.platform + parts.boost).toBeCloseTo(total(after) - total(before), 10);
  });

  it("puts a weight move on the platform and not on the seller", () => {
    const before = day();
    const after = day({ weights: { ...DEFAULT_WEIGHTS, responseTime: 4, relevance: 48 } });

    const parts = decompose(before, after);

    expect(parts.seller).toBe(0);
    expect(parts.platform).not.toBe(0);
  });
});

describe("attribute", () => {
  it("gives a held position no reason at all", () => {
    // A reason is optional, and an absent one is a finished state. Nothing
    // moved, so there is nothing to say.
    expect(attribute(input({ positionBefore: 8, positionAfter: 8 })).kind).toBe("none");
  });

  it("never invents a cause when the history has a hole", () => {
    const result = attribute(input({ before: null }));
    expect(result).toEqual({
      kind: "unexplained",
      historyStarts: new Date("2026-06-10T00:00:00Z"),
    });
  });

  it("names one factor, with its before and after", () => {
    const before = day();
    const after = day({
      scores: { ...day().scores, responseTime: 0.2 },
      raw: { ...RAW, responseTimeMedianMs: 31 * HOUR },
    });

    const result = attribute(input({ before, after }));

    expect(result.kind).toBe("seller");
    if (result.kind !== "seller") return;
    expect(result.factor).toBe("responseTime");
    expect(result.direction).toBe("down");
    /*
       The position fell and the reply time *rose*, and the sentence has to say
       both. Taking the trend from the normalised score gave "your measured
       reply time fell from 4 h to 1 d 7 h" — a fall whose second number is
       larger than its first. Two of the six factors invert this way.
    */
    expect(result.trend).toBe("up");
    expect(result.places).toBe(6);
    expect(result.after.responseTimeMedianMs).toBe(31 * HOUR);
  });

  it("takes the trend from the measurement for a factor that scores inverted", () => {
    // Distance is the other one: further away is a worse score.
    const before = day({ raw: { ...RAW, distanceKm: 4 } });
    const after = day({
      scores: { ...day().scores, distance: 0.05 },
      raw: { ...RAW, distanceKm: 92 },
    });

    const result = attribute(input({ before, after }));

    expect(result.kind).toBe("seller");
    if (result.kind !== "seller") return;
    expect(result.factor).toBe("distance");
    expect(result.trend).toBe("up");
  });

  it("blames the platform when staff moved a weight", () => {
    /*
       The defect the amendment exists to stop. The seller's own scores are
       identical on both days; only board 12c moved. Before factor history this
       was indistinguishable from the seller's own decline, and the page said so.
    */
    const heavier: RankingWeights = { ...DEFAULT_WEIGHTS, responseTime: 4, relevance: 48 };
    const result = attribute(input({ before: day(), after: day({ weights: heavier }) }));

    expect(result).toEqual({ kind: "platform", on: new Date("2026-09-02T00:00:00Z") });
  });

  it("says the position was bought when a boost ends", () => {
    const result = attribute(
      input({
        before: day({ boostPoints: 15 }),
        after: day({ boostPoints: 0 }),
        boostEndedOn: new Date("2026-08-30T00:00:00Z"),
        earnedRank: 9,
      }),
    );

    expect(result).toEqual({
      kind: "commercial",
      endedOn: new Date("2026-08-30T00:00:00Z"),
      earnedRank: 9,
    });
  });

  it("reports a boost ending even where the earned rank is not recoverable", () => {
    // The boost may predate the nightly job. The sentence still has to be said:
    // silence lets a seller mourn a position they never earned.
    const result = attribute(
      input({
        before: day({ boostPoints: 15 }),
        after: day({ boostPoints: 0 }),
        boostEndedOn: new Date("2026-08-30T00:00:00Z"),
      }),
    );

    expect(result.kind).toBe("commercial");
    if (result.kind !== "commercial") return;
    expect(result.earnedRank).toBeNull();
  });

  it("says a competitor improved when nothing of the seller's moved", () => {
    const result = attribute(
      input({ overtakenBy: { count: 2, factor: "responseTime" } }),
    );

    expect(result).toEqual({ kind: "competitor", count: 2, factor: "responseTime" });
  });

  it("says nothing rather than guessing when no competitor is identified", () => {
    // The seller's factors held and we cannot see who passed them. A sentence
    // here would be invention, and state 11's whole point is that it is not.
    expect(attribute(input({ overtakenBy: null })).kind).toBe("none");
  });

  it("counts several factors and names the one that carried the fall", () => {
    const before = day();
    const after = day({
      scores: { ...day().scores, responseTime: 0.2, specCompleteness: 0.5, distance: 0.4 },
    });

    const result = attribute(input({ before, after }));

    expect(result.kind).toBe("multiple");
    if (result.kind !== "multiple") return;
    expect(result.count).toBe(3);
    expect(result.factor).toBe("responseTime");
  });

  it("names no factor where none of the three dominates", () => {
    /*
       Spec Q2. Naming an arbitrary one of three is worse than naming none,
       because the seller acts on whichever one we printed.
    */
    const before = day();
    const after = day({
      scores: { ...day().scores, responseTime: 0.8, specCompleteness: 0.44, distance: 0.15 },
    });

    const result = attribute(input({ before, after }));

    expect(result.kind).toBe("multiple");
    if (result.kind !== "multiple") return;
    expect(result.count).toBeGreaterThan(1);
    expect(result.factor).toBeNull();
  });

  it("does not name a factor whose movement is below the floor", () => {
    // One product gained a field. True, uninteresting, and misleading as the
    // stated reason a seller lost two places.
    const before = day();
    const nudge = NAMEABLE_POINTS / DEFAULT_WEIGHTS.specCompleteness / 10;
    const after = day({
      scores: { ...day().scores, specCompleteness: day().scores.specCompleteness - nudge },
    });

    const result = attribute(input({ before, after, overtakenBy: null }));

    expect(result.kind).toBe("none");
  });
});

/** A day's score, by the ranker's own definition: `Σ w·s` plus the boost. */
function total(row: FactorDay): number {
  return (
    WEIGHT_KEYS.reduce((sum, key) => sum + row.weights[key] * row.scores[key], 0) + row.boostPoints
  );
}
