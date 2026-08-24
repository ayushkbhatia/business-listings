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

describe("the thresholds are the ones board 6f states", () => {
  it("is 60 listings, 30 per cent verified, 250 words", () => {
    expect(DEFAULT_THRESHOLDS).toEqual({
      minListings: 60,
      minVerifiedShare: 0.3,
      minIntroWords: 250,
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
      }),
    ).toBe(true);
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
