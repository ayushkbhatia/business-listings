import { describe, expect, it } from "vitest";
import {
  DEFAULT_WEIGHTS,
  WEIGHT_KEYS,
  isBrowseRelevanceMode,
  weightsForBrowse,
  type RankingWeights,
} from "./ranking";

/**
 * Board 6a §Ranking — the relevance weight on a page with no query.
 *
 * *"There is no query on this page, so `relevance` has nothing to score...
 * Whichever is chosen, write it down in the config as a named mode; do not
 * leave a 34-point weight silently multiplying zero."*
 *
 * These are the properties that make the redistribution safe to apply to the
 * highest-traffic template in the product. Each of them is a way the obvious
 * implementation is wrong.
 */

const total = (weights: RankingWeights) =>
  WEIGHT_KEYS.reduce((sum, key) => sum + weights[key], 0);

describe("weightsForBrowse", () => {
  it("leaves the config alone under category_depth", () => {
    // That mode keeps relevance and scores it as category-match depth, so the
    // weights are exactly what staff set on board 12c.
    expect(weightsForBrowse(DEFAULT_WEIGHTS, "category_depth")).toEqual(DEFAULT_WEIGHTS);
  });

  it("takes relevance to nought and keeps the total", () => {
    const next = weightsForBrowse(DEFAULT_WEIGHTS, "redistribute");
    expect(next.relevance).toBe(0);
    /*
       The scale has to survive, because a boost is added to the weighted sum
       rather than weighted into it. Five points of `ListingBoost` means five
       points of a hundred on a search; if this returned sixty-six, it would
       quietly mean five of sixty-six on every landing page.
    */
    expect(total(next)).toBe(total(DEFAULT_WEIGHTS));
  });

  it("makes verification the dominant signal, which is what the page promises", () => {
    const next = weightsForBrowse(DEFAULT_WEIGHTS, "redistribute");
    const largest = WEIGHT_KEYS.reduce((best, key) =>
      next[key] > next[best] ? key : best,
    );
    expect(largest).toBe("verificationTier");
    // The board's own arithmetic: 22 of the remaining 66 points, plus 22/66 of
    // the 34 that relevance gave up, is about 35.
    expect(next.verificationTier).toBeGreaterThanOrEqual(33);
    expect(next.verificationTier).toBeLessThanOrEqual(37);
  });

  it("shares out in proportion rather than equally", () => {
    const next = weightsForBrowse(DEFAULT_WEIGHTS, "redistribute");
    // Response time started above spec completeness and must stay above it.
    // An equal split would have moved 6.8 points into every signal and changed
    // the order of the config staff set.
    expect(next.responseTime).toBeGreaterThan(next.specCompleteness);
    expect(next.specCompleteness).toBeGreaterThan(next.distance);
    expect(next.distance).toBeGreaterThan(next.planTier);
  });

  it("never redistributes into a weight staff switched off", () => {
    /*
       The one property that makes this safe to leave on. Somebody who sets
       distance to nought has said distance must not matter; a redistribution
       that put eight points back into it would make the admin editor a
       suggestion, which is the objection `weightsForShape` already records.
    */
    const off: RankingWeights = { ...DEFAULT_WEIGHTS, distance: 0, planTier: 0 };
    const next = weightsForBrowse(off, "redistribute");
    expect(next.distance).toBe(0);
    expect(next.planTier).toBe(0);
    expect(total(next)).toBe(total(off));
  });

  it("keeps whole numbers", () => {
    // The weights are integers in the database and in the editor. A fractional
    // one here would render as 12.755102040816327 on board 12c.
    const next = weightsForBrowse(DEFAULT_WEIGHTS, "redistribute");
    for (const key of WEIGHT_KEYS) expect(Number.isInteger(next[key])).toBe(true);
  });

  it("drops the points where there is nothing to share them with", () => {
    // Relevance alone, on a page with no query, is a config with no ranking in
    // it. `setWeights` refuses the all-zero case that produces this, so it is
    // unreachable through the editor — but arithmetic that divides by nought is
    // worth being explicit about.
    const only: RankingWeights = {
      relevance: 40,
      verificationTier: 0,
      responseTime: 0,
      specCompleteness: 0,
      distance: 0,
      planTier: 0,
    };
    expect(weightsForBrowse(only, "redistribute")).toEqual({ ...only, relevance: 0 });
  });

  it("is a no-op where relevance is already nought", () => {
    const none: RankingWeights = { ...DEFAULT_WEIGHTS, relevance: 0 };
    expect(weightsForBrowse(none, "redistribute")).toEqual(none);
  });

  it("defaults to redistributing", () => {
    expect(weightsForBrowse(DEFAULT_WEIGHTS)).toEqual(
      weightsForBrowse(DEFAULT_WEIGHTS, "redistribute"),
    );
  });
});

describe("isBrowseRelevanceMode", () => {
  it("knows the two modes and refuses anything else", () => {
    expect(isBrowseRelevanceMode("redistribute")).toBe(true);
    expect(isBrowseRelevanceMode("category_depth")).toBe(true);
    // A value written into the column by hand degrades to the default rather
    // than ranking a few hundred pages on something nobody chose.
    expect(isBrowseRelevanceMode("whatever")).toBe(false);
  });
});
