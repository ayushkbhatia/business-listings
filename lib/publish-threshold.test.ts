import { describe, expect, it } from "vitest";
import {
  DEFAULT_THRESHOLDS,
  countWords,
  evaluateHold,
  evaluatePublish,
  holdFloor,
  listingsNeeded,
} from "./publish-threshold";

/*
   `isPublishable` is gone rather than updated. Its docblock called it a
   convenience for the sitemap; app/sitemap.ts never imported it and its only
   callers were the lines below. Board 6f makes "is this publishable" and "may
   this stay live" two different questions, and a dead export answering the
   first would have been picked up by a caller meaning the second.
*/
const publishable = (input: Parameters<typeof evaluatePublish>[0]) =>
  evaluatePublish(input).publishable;

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
      // Board 6f's two: 25 listings per 1,000 monthly searches, and a live
      // page holds at four fifths of whatever that works out to.
      demandPerThousand: 25,
      holdShare: 0.8,
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
    expect(decision.failures).toContainEqual({
      reason: "listings",
      have: 59,
      need: 60,
      basis: "absolute",
    });
  });

  it("holds a page back on the verified share", () => {
    // 60 listings, 17 verified — 28.3 per cent, just under.
    const decision = evaluatePublish({ listings: 60, verified: 17, introWords: 300 });
    expect(decision.publishable).toBe(false);
    expect(decision.failures.map((f) => f.reason)).toContain("verified_share");
  });

  it("accepts exactly the floor, not one below it", () => {
    expect(publishable({ listings: 60, verified: 18, introWords: 250 })).toBe(true);
    expect(publishable({ listings: 60, verified: 17, introWords: 250 })).toBe(false);
    expect(publishable({ listings: 59, verified: 60, introWords: 250 })).toBe(false);
    expect(publishable({ listings: 60, verified: 18, introWords: 249 })).toBe(false);
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
    expect(publishable({ listings: 0, verified: 0, introWords: 0 })).toBe(false);
  });

  it("refuses a fresh publish inside the hysteresis band", () => {
    // Board 6f. This used to read "unpublishes as readily as it publishes" and
    // assert 61 true then 59 false through one function. There are two now,
    // and a page at 52 is in between: too thin to be published today, thick
    // enough that having published it we do not yank it.
    const launched = { listings: 61, verified: 20, introWords: 300 };
    expect(publishable(launched)).toBe(true);
    expect(publishable({ ...launched, listings: 52 })).toBe(false);
    expect(evaluateHold({ ...launched, listings: 52 }).publishable).toBe(true);
    expect(evaluateHold({ ...launched, listings: 47 }).publishable).toBe(false);
  });

  it("still reads the numbers rather than a stored flag", () => {
    // routes.md says a page auto-unpublishes when supply drops. The band moved
    // where that happens; it did not make the answer something we remember.
    const launched = { listings: 61, verified: 20, introWords: 300 };
    expect(evaluateHold(launched).publishable).toBe(true);
    expect(evaluateHold({ ...launched, listings: 20 }).publishable).toBe(false);
  });

  it("takes a different threshold set without a code change", () => {
    expect(
      evaluatePublish(
        { listings: 10, verified: 5, introWords: 20 },
        {
          minListings: 10,
          minVerifiedShare: 0.5,
          minIntroWords: 20,
          minFaqRows: 1,
          minScopeSpecificFaqRows: 1,
          demandPerThousand: 25,
          holdShare: 0.8,
        },
      ).publishable,
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
    expect(publishable(clears)).toBe(true);
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
    expect(publishable({ ...clears, faqRows: 4, scopeSpecificFaqRows: 2 })).toBe(true);
  });

  it("reads a missing scope-specific count as none", () => {
    const decision = evaluatePublish({ ...clears, faqRows: 6 });
    expect(decision.failures).toEqual([{ reason: "faq_scope_specific", have: 0, need: 2 }]);
  });
});

/**
 * Board 6f's second half of the listings condition.
 *
 *   need = max(60, 25 × monthlySearches / 1000)
 *
 * The board's own worked example: AC repair in Business Bay, 3,940 searches a
 * month, needs 99 and has 78. It is opt-in exactly as the FAQ condition is —
 * a `/c/:slug` category page has no place attached and no keyword figure to
 * attach, and an absent figure is the absolute floor rather than a zero.
 */
describe("the demand condition", () => {
  const clears = { listings: 80, verified: 30, introWords: 300 };

  it("leaves a scope with no recorded demand on the absolute floor", () => {
    expect(listingsNeeded({})).toEqual({ need: 60, basis: "absolute" });
    expect(publishable({ ...clears, listings: 60 })).toBe(true);
  });

  it("does not read an absent figure as nought", () => {
    // A zero would make the demand need 0 and every unmeasured page would pass
    // the new condition for the wrong reason.
    expect(listingsNeeded({ monthlySearches: 0 })).toEqual({ need: 60, basis: "absolute" });
  });

  it("raises the need where the searches are there", () => {
    // 25 × 3,940 / 1,000 = 98.5, and a page cannot have half a listing.
    expect(listingsNeeded({ monthlySearches: 3_940 })).toEqual({ need: 99, basis: "demand" });
  });

  it("keeps the absolute floor where demand asks for less", () => {
    // 2,260 searches in Jumeirah: 56.5, which rounds to 57 and loses to 60.
    expect(listingsNeeded({ monthlySearches: 2_260 })).toEqual({ need: 60, basis: "absolute" });
  });

  it("refuses the board's own example, and says which rule refused it", () => {
    const decision = evaluatePublish({ ...clears, listings: 78, monthlySearches: 3_940 });
    expect(decision.publishable).toBe(false);
    expect(decision.failures).toContainEqual({
      reason: "listings",
      have: 78,
      need: 99,
      basis: "demand",
    });
  });

  it("scales the hold floor with the need rather than pinning it at 48", () => {
    // Otherwise a 50-listing page against 3,940 searches would stay live for
    // ever on a band drawn for a floor of 60.
    expect(holdFloor({})).toBe(48);
    expect(holdFloor({ monthlySearches: 3_940 })).toBe(80);
  });

  it("never lets the hold floor fall below one listing", () => {
    expect(
      holdFloor({}, { ...DEFAULT_THRESHOLDS, minListings: 1, holdShare: 0 }),
    ).toBe(1);
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
