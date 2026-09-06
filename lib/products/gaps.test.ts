import { describe, expect, it } from "vitest";
import { gapRank, gapsFor, matchesGap, type GapField } from "./gaps";

/**
 * The correction board 3f turns on: a missing spec is two different problems.
 *
 * The board carried one chip — `62 with missing specs` — over two consequences
 * that need different work in a different order. These assertions are what stop
 * them being added back together.
 */

const field = (over: Partial<GapField> & { fieldId: string }): GapField => ({
  requiredNow: false,
  isFacet: false,
  ...over,
});

describe("what a missing value costs", () => {
  it("counts an empty required field as blocking the save", () => {
    const gaps = gapsFor([field({ fieldId: "a", requiredNow: true })], {});
    expect(gaps.requiredMissing).toBe(1);
    // Required and not a facet: the save is blocked and no buyer notices.
    expect(gaps.filterGaps).toBe(0);
  });

  it("counts an empty facet as absence from a filter", () => {
    const gaps = gapsFor([field({ fieldId: "a", isFacet: true })], {});
    expect(gaps.filterGaps).toBe(1);
    // A facet nobody requires blocks nothing. The seller can still save.
    expect(gaps.requiredMissing).toBe(0);
  });

  it("counts a field that is both in both, and neither total subsumes the other", () => {
    /*
       `nominal_diameter` is required *and* a facet on the seeded template, so
       leaving it empty blocks the save and drops the product out of the size
       filter. The overlap is real and is why the two figures are never added.
    */
    const gaps = gapsFor([field({ fieldId: "a", requiredNow: true, isFacet: true })], {});
    expect(gaps.requiredMissing).toBe(1);
    expect(gaps.filterGaps).toBe(1);
  });

  it("counts an empty optional field as nothing at all", () => {
    // Deliberate. Counting it teaches the seller the whole figure is noise.
    const gaps = gapsFor([field({ fieldId: "a" })], {});
    expect(gaps).toEqual({ filled: 0, total: 1, requiredMissing: 0, filterGaps: 0 });
  });

  it("uses the same emptiness test as the editor and the completeness job", () => {
    const fields = [
      field({ fieldId: "blank", requiredNow: true }),
      field({ fieldId: "spaces", requiredNow: true }),
      field({ fieldId: "emptyArray", requiredNow: true }),
      field({ fieldId: "filled", requiredNow: true }),
      field({ fieldId: "array", requiredNow: true }),
      field({ fieldId: "zero", requiredNow: true }),
    ];
    const gaps = gapsFor(fields, {
      blank: "",
      spaces: "   ",
      emptyArray: [],
      filled: "DN50",
      array: ["WRAS"],
      // Zero is a value. A stock count of nothing is still a number the seller
      // typed, and treating it as empty would block a save over a fact.
      zero: 0,
    });
    expect(gaps.filled).toBe(3);
    expect(gaps.requiredMissing).toBe(3);
  });

  it("reports the ratio over every field, not the interesting ones", () => {
    const gaps = gapsFor(
      [field({ fieldId: "a" }), field({ fieldId: "b", isFacet: true }), field({ fieldId: "c" })],
      { a: "x" },
    );
    expect(gaps).toMatchObject({ filled: 1, total: 3 });
  });
});

describe("which chip a product answers to", () => {
  it("matches both where both apply", () => {
    const gaps = gapsFor([field({ fieldId: "a", requiredNow: true, isFacet: true })], {});
    expect(matchesGap(gaps, "blocked")).toBe(true);
    expect(matchesGap(gaps, "filter")).toBe(true);
  });

  it("matches neither when nothing is missing that costs anything", () => {
    const gaps = gapsFor([field({ fieldId: "a" })], {});
    expect(matchesGap(gaps, "blocked")).toBe(false);
    expect(matchesGap(gaps, "filter")).toBe(false);
  });
});

describe("gaps first, which is the default sort", () => {
  const clean = gapsFor([field({ fieldId: "a" })], { a: "x" });
  const filterOnly = gapsFor([field({ fieldId: "a", isFacet: true })], {});
  const blocked = gapsFor([field({ fieldId: "a", requiredNow: true })], {});

  it("puts an untemplated product above everything", () => {
    /*
       It cannot be published at all — the template *is* the spec table board 1g
       renders — and the seller cannot discover that from anywhere else.
    */
    expect(gapRank(clean, false)).toBeLessThan(gapRank(blocked, true));
  });

  it("puts a wall above lost reach, and lost reach above nothing wrong", () => {
    expect(gapRank(blocked, true)).toBeLessThan(gapRank(filterOnly, true));
    expect(gapRank(filterOnly, true)).toBeLessThan(gapRank(clean, true));
  });
});
