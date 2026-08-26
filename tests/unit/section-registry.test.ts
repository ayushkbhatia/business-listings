import { describe, expect, it } from "vitest";
import { SECTION_RENDERERS } from "@/components/storefront/registry";
import { SECTION_TYPES } from "@/lib/storefront/section-types";

/**
 * One catalogue, not two.
 *
 * `section-types.ts` declares what can exist; this asserts every one of those
 * has something that draws it, and that nothing draws a type the catalogue does
 * not declare. Without it, adding a type is two edits and forgetting the second
 * means every storefront in a sector silently renders one section fewer.
 *
 * The inventory's note on `Thread` is the same lesson from the other direction:
 * a component left out of a list is a component the gallery carried uncounted.
 */

describe("the section registry", () => {
  it("draws every type the catalogue declares", () => {
    const missing = SECTION_TYPES.filter((type) => !(type.key in SECTION_RENDERERS));
    expect(missing.map((type) => type.key)).toEqual([]);
  });

  it("draws nothing the catalogue does not declare", () => {
    const declared = new Set(SECTION_TYPES.map((type) => type.key));
    const extra = Object.keys(SECTION_RENDERERS).filter((key) => !declared.has(key));
    expect(extra).toEqual([]);
  });

  it("is the same size as the catalogue, coming-soon included", () => {
    // Services renders — as a disabled card on the specimens page and in the
    // library. `resolveSections` is what keeps it off a real storefront.
    expect(Object.keys(SECTION_RENDERERS)).toHaveLength(SECTION_TYPES.length);
  });
});
