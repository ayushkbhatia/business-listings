import { describe, expect, it } from "vitest";
import {
  DEFAULT_THRESHOLDS,
  countWords,
  evaluatePublish,
  isPublishable,
} from "./publish-threshold";

/**
 * Board 6f, enforced in code rather than by editorial discipline. The tests
 * matter more than usual because the pages this guards do not exist yet — it
 * has to be right before anything depends on it.
 */
const good = { listings: 80, verified: 30, introWords: 300 };

describe("the thresholds are the ones boards 6f and 6a state", () => {
  it("is 60 listings, 30 per cent verified, 250 words, 4 questions of which 2 are local", () => {
    // Board 6f stated the first three. Board 6a added the fourth and made all
    // four apply to the area class as well:
    //
    //   listings        ≥ Category.publishThreshold      (60)
    //   verified share  ≥ Category.verifiedShareMin      (30%)
    //   intro copy      ≥ 250 words, human-written, unique to this scope
    //   FAQ rows        ≥ 4, at least 2 specific to this scope
    expect(DEFAULT_THRESHOLDS).toEqual({
      minListings: 60,
      minVerifiedShare: 0.3,
      minIntroWords: 250,
      minFaqRows: 4,
      minScopeSpecificFaqRows: 2,
    });
  });
});

describe("evaluatePublish", () => {
  it("publishes a page that clears every floor", () => {
    expect(evaluatePublish(good).publishable).toBe(true);
  });

  it("holds a page back for too few listings, and says by how much", () => {
    const decision = evaluatePublish({ ...good, listings: 59, verified: 30 });
    expect(decision.publishable).toBe(false);
    expect(decision.failures).toContainEqual({ reason: "listings", have: 59, need: 60 });
  });

  it("holds a page back on the verified share", () => {
    // 60 listings, 17 verified — 28.3 per cent, just under.
    const decision = evaluatePublish({ listings: 60, verified: 17, introWords: 300 });
    expect(decision.publishable).toBe(false);
    expect(decision.failures.map((f) => f.reason)).toContain("verified_share");
  });

  it("accepts exactly the floor, not one below it", () => {
    expect(isPublishable({ listings: 60, verified: 18, introWords: 250 })).toBe(true);
    expect(isPublishable({ listings: 60, verified: 17, introWords: 250 })).toBe(false);
    expect(isPublishable({ listings: 59, verified: 60, introWords: 250 })).toBe(false);
    expect(isPublishable({ listings: 60, verified: 18, introWords: 249 })).toBe(false);
  });

  it("holds a page back for thin intro copy", () => {
    const decision = evaluatePublish({ ...good, introWords: 40 });
    expect(decision.failures).toContainEqual({ reason: "intro_words", have: 40, need: 250 });
  });

  it("reports every failure, not the first", () => {
    // A screen showing one reason at a time makes somebody fix it three times.
    const decision = evaluatePublish({ listings: 4, verified: 0, introWords: 0 });
    expect(decision.failures.map((f) => f.reason).sort()).toEqual([
      "intro_words",
      "listings",
      "verified_share",
    ]);
  });

  it("does not divide by zero on an empty area", () => {
    expect(() => evaluatePublish({ listings: 0, verified: 0, introWords: 0 })).not.toThrow();
    expect(isPublishable({ listings: 0, verified: 0, introWords: 0 })).toBe(false);
  });

  it("unpublishes as readily as it publishes", () => {
    // Same function both ways: routes.md says a page auto-unpublishes when
    // supply drops below the floor, so this cannot read a stored flag.
    const launched = { listings: 61, verified: 20, introWords: 300 };
    expect(isPublishable(launched)).toBe(true);
    expect(isPublishable({ ...launched, listings: 59 })).toBe(false);
  });

  it("takes a different threshold set without a code change", () => {
    expect(
      isPublishable({ listings: 10, verified: 5, introWords: 20 }, {
        minListings: 10,
        minVerifiedShare: 0.5,
        minIntroWords: 20,
        minFaqRows: 1,
        minScopeSpecificFaqRows: 1,
      }),
    ).toBe(true);
  });
});

/**
 * Board 6a's fourth condition.
 *
 *   FAQ rows ≥ 4, at least 2 specific to this scope
 *
 * The interesting property is that it is **opt-in**: the two landing classes
 * pass an FAQ count and are gated on it, and the taxonomy matrix and the guides
 * pass neither and keep the three conditions they have always had. An absent
 * count is not a zero — if it were, board 6f's matrix would grey out every
 * category on the site for want of a table nothing writes to.
 */
describe("the FAQ condition", () => {
  const clears = { listings: 61, verified: 20, introWords: 300 };

  it("does not apply where the caller passes no FAQ count", () => {
    expect(isPublishable(clears)).toBe(true);
    expect(evaluatePublish(clears).failures).toEqual([]);
  });

  it("blocks a page with fewer than four questions", () => {
    const decision = evaluatePublish({ ...clears, faqRows: 3, scopeSpecificFaqRows: 3 });
    expect(decision.publishable).toBe(false);
    expect(decision.failures).toContainEqual({ reason: "faq_rows", have: 3, need: 4 });
  });

  it("blocks four generic questions, which is the whole point of it", () => {
    // Four questions with the area name substituted in is the doorway page the
    // other three conditions were written to stop, arriving through the one
    // part of the template nobody was counting.
    const decision = evaluatePublish({ ...clears, faqRows: 4, scopeSpecificFaqRows: 1 });
    expect(decision.publishable).toBe(false);
    expect(decision.failures).toEqual([{ reason: "faq_scope_specific", have: 1, need: 2 }]);
  });

  it("passes at four questions with two of them specific", () => {
    expect(isPublishable({ ...clears, faqRows: 4, scopeSpecificFaqRows: 2 })).toBe(true);
  });

  it("reads a missing scope-specific count as none", () => {
    const decision = evaluatePublish({ ...clears, faqRows: 6 });
    expect(decision.failures).toEqual([{ reason: "faq_scope_specific", have: 0, need: 2 }]);
  });
});

describe("countWords", () => {
  it("counts words, not characters, and survives nothing", () => {
    expect(countWords("Al Quoz has 218 valve suppliers")).toBe(6);
    expect(countWords("   spaced   out   ")).toBe(2);
    expect(countWords(null)).toBe(0);
    expect(countWords("")).toBe(0);
  });
});
