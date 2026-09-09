import { describe, expect, it } from "vitest";
import {
  DEFAULT_WEIGHTS,
  PINNED_KEYS,
  PLAN_TIER_CEILING,
  redistribute,
  WEIGHT_KEYS,
  WEIGHT_TOTAL,
  weightsForBrowse,
  weightsTotal,
  type RankingWeights,
} from "./ranking";

/**
 * Board 12c criterion 2, and `B9`.
 *
 * The shipped screen was six independent integers and said so — *"what matters
 * is the ratio between them, not the total"*. That is true of the ordering and
 * false of everything measured against it: a boost is added to the weighted sum
 * rather than multiplied into it, so a 25-point boost is a quarter of the
 * ranking at a total of 100 and a sixth of it at 150.
 */

const PINNED = new Set<string>(PINNED_KEYS);

describe("redistribute", () => {
  it("keeps the total at 100 whatever is moved, in either direction", () => {
    for (const key of WEIGHT_KEYS) {
      if (PINNED.has(key)) continue;
      for (const value of [0, 1, 5, 17, 40, 61, 94, 100]) {
        const next = redistribute(DEFAULT_WEIGHTS, key, value);
        expect(weightsTotal(next)).toBe(WEIGHT_TOTAL);
      }
    }
  });

  it("takes the difference out of the others in proportion", () => {
    // Relevance 34 → 24. The ten points go to verification, reply time and spec
    // in the ratio 22 : 18 : 12, which is 4.3 : 3.5 : 2.2 before rounding.
    const next = redistribute(DEFAULT_WEIGHTS, "relevance", 24);
    expect(next.relevance).toBe(24);
    expect(next.verificationTier).toBeGreaterThan(DEFAULT_WEIGHTS.verificationTier);
    expect(next.responseTime).toBeGreaterThan(DEFAULT_WEIGHTS.responseTime);
    expect(next.specCompleteness).toBeGreaterThan(DEFAULT_WEIGHTS.specCompleteness);
    // Ordered by their own size, because the share is proportional to it.
    expect(next.verificationTier - DEFAULT_WEIGHTS.verificationTier).toBeGreaterThanOrEqual(
      next.responseTime - DEFAULT_WEIGHTS.responseTime,
    );
  });

  it("leaves pinned factors exactly where they were", () => {
    for (const key of WEIGHT_KEYS) {
      if (PINNED.has(key)) continue;
      const next = redistribute(DEFAULT_WEIGHTS, key, 40);
      for (const pinned of PINNED_KEYS) {
        expect(next[pinned]).toBe(DEFAULT_WEIGHTS[pinned]);
      }
    }
  });

  it("does not redistribute into a factor somebody switched off", () => {
    const off: RankingWeights = { ...DEFAULT_WEIGHTS, responseTime: 0, relevance: 52 };
    expect(weightsTotal(off)).toBe(WEIGHT_TOTAL);

    const next = redistribute(off, "relevance", 30);
    // The 22 points go to verification and spec. Reply time stays at nought,
    // because redistributing into a signal somebody deliberately switched off
    // would make the editor a suggestion.
    expect(next.responseTime).toBe(0);
    expect(weightsTotal(next)).toBe(WEIGHT_TOTAL);
  });

  it("clamps to what the other weights can actually cover", () => {
    // Everything unpinned is already on relevance, so there is nowhere for more
    // points to come from. The editor shows a lower number than the one dragged
    // for, which is honest — rather than a total of 114.
    const all: RankingWeights = {
      relevance: 86,
      verificationTier: 0,
      responseTime: 0,
      specCompleteness: 0,
      distance: 8,
      planTier: 6,
    };
    const next = redistribute(all, "relevance", 100);
    expect(next.relevance).toBe(86);
    expect(weightsTotal(next)).toBe(WEIGHT_TOTAL);
  });

  it("sets a pinned factor directly, so the ceiling copy is not a lie", () => {
    // Pinned means "not part of the give and take", not "uneditable". The total
    // is then wrong and the service refuses it, which is the editor's problem
    // to show rather than this function's to hide.
    const next = redistribute(DEFAULT_WEIGHTS, "planTier", 9);
    expect(next.planTier).toBe(9);
    expect(next.relevance).toBe(DEFAULT_WEIGHTS.relevance);
  });
});

/**
 * `B9`, as arithmetic.
 *
 * `redistribute` lifts plan tier's effective weight on every area and emirate
 * landing page without anybody touching the plan slider. The spec's table is
 * reproduced here because it is the argument for the check existing at all.
 */
describe("the plan ceiling on a page with no query", () => {
  /** The live vector with relevance moved and reply time absorbing it. */
  const at = (relevance: number): RankingWeights => ({
    relevance,
    verificationTier: 22,
    responseTime: 100 - relevance - 22 - 12 - 8 - 6,
    specCompleteness: 12,
    distance: 8,
    planTier: 6,
  });

  it("reproduces the spec's table", () => {
    for (const relevance of [34, 40, 50]) expect(weightsTotal(at(relevance))).toBe(WEIGHT_TOTAL);

    expect(weightsForBrowse(at(34), "redistribute").planTier).toBe(9);
    expect(weightsForBrowse(at(40), "redistribute").planTier).toBe(10);
    expect(weightsForBrowse(at(50), "redistribute").planTier).toBe(12);
  });

  it("breaches the ceiling at a relevance nothing on the authored vector refuses", () => {
    const authored = at(50);
    expect(authored.planTier).toBeLessThanOrEqual(PLAN_TIER_CEILING);
    expect(weightsForBrowse(authored, "redistribute").planTier).toBeGreaterThan(
      PLAN_TIER_CEILING,
    );
  });

  it("does not breach it where the browse pages score category depth", () => {
    // Nothing is redistributed, so the effective weight is the authored one.
    expect(weightsForBrowse(at(50), "category_depth").planTier).toBe(6);
  });
});
