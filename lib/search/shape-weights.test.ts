import { describe, expect, it } from "vitest";
import {
  DEFAULT_WEIGHTS,
  PLAN_TIER_CEILING,
  WEIGHT_KEYS,
  WEIGHT_TOTAL,
  weightsForShape,
  weightsTotal,
  type QueryShape,
  type RankingWeights,
} from "./ranking";

/**
 * The shape vector, and the rule it used to break.
 *
 * `weightsForShape` wrote a literal into `distance` and returned — so against
 * the seeded 34/22/18/12/8/6 the six totalled **96** on a SKU query and **106**
 * on a service-shaped one. `WEIGHT_TOTAL`'s docblock argues at length that the
 * hundred is a rule rather than a workaround, and `validateWeights` enforces
 * it — but only on the authored vector. The shape vector is built after the
 * settings are read, so the one place the weights are actually measured was the
 * one place nothing checked them.
 *
 * These tests exist because the function was `server-only` when it was wrong.
 * The arithmetic is pure and now sits beside `redistribute`, where it can be.
 */

const SHAPES: QueryShape[] = ["sku", "spec", "service"];

const seeded: RankingWeights = {
  relevance: 34,
  verificationTier: 22,
  responseTime: 18,
  specCompleteness: 12,
  distance: 8,
  planTier: 6,
};

describe("the six still add to a hundred, whatever the query looks like", () => {
  it("holds on every shape, for the seeded vector", () => {
    for (const shape of SHAPES) {
      expect(weightsTotal(weightsForShape(seeded, shape)), shape).toBe(WEIGHT_TOTAL);
    }
  });

  it("holds on the default vector too", () => {
    for (const shape of SHAPES) {
      expect(weightsTotal(weightsForShape(DEFAULT_WEIGHTS, shape)), shape).toBe(WEIGHT_TOTAL);
    }
  });

  it("holds wherever the absorbers are thin", () => {
    /*
       The clamp, from the other side. Where the four that absorb hold less than
       the move needs, distance is set to what they can cover rather than the
       total being broken — which is `redistribute`'s own rule, arrived at
       through the same body.
    */
    const lopsided: RankingWeights = {
      relevance: 1,
      verificationTier: 1,
      responseTime: 0,
      specCompleteness: 0,
      distance: 90,
      planTier: 8,
    };
    for (const shape of SHAPES) {
      const next = weightsForShape(lopsided, shape);
      expect(weightsTotal(next), shape).toBe(weightsTotal(lopsided));
      for (const key of WEIGHT_KEYS) expect(next[key], `${shape}/${key}`).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("what moves and what does not", () => {
  it("moves distance to the shape's own figure where it can afford to", () => {
    expect(weightsForShape(seeded, "sku").distance).toBe(4);
    expect(weightsForShape(seeded, "service").distance).toBe(14);
    // A spec query is the unmodified vector — the shape with nothing to say.
    expect(weightsForShape(seeded, "spec")).toEqual(seeded);
  });

  it("never moves plan tier, in either direction", () => {
    /*
       `PINNED_KEYS`' commercial half. A shape transform that quietly raised
       plan tier would be `PLAN_TIER_CEILING` arrived at sideways: a buyer
       searching a part number would be shown more paid placement than one
       searching a trade, and nobody would have decided that.
    */
    for (const shape of SHAPES) {
      expect(weightsForShape(seeded, shape).planTier, shape).toBe(seeded.planTier);
      expect(weightsForShape(seeded, shape).planTier).toBeLessThanOrEqual(PLAN_TIER_CEILING);
    }
  });

  it("keeps a factor staff switched off switched off", () => {
    // The rule `weightsForBrowse` and `redistribute` both state: redistributing
    // into a signal somebody deliberately set to nought makes the editor a
    // suggestion.
    const off: RankingWeights = { ...seeded, specCompleteness: 0, relevance: 46 };
    for (const shape of SHAPES) {
      expect(weightsForShape(off, shape).specCompleteness, shape).toBe(0);
    }
  });

  it("preserves the ratios between the factors that absorb", () => {
    /*
       This is what makes the redistribution acceptable rather than the "quiet
       rewrite" the old comment worried about: every ratio staff set between the
       four is kept, to the rounding.
    */
    const next = weightsForShape(seeded, "service");
    const before = seeded.relevance / seeded.verificationTier;
    const after = next.relevance / next.verificationTier;
    expect(Math.abs(after - before)).toBeLessThan(0.06);
  });
});
