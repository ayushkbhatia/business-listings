import { describe, expect, it } from "vitest";
import { categoryPath } from "@/lib/seo/category-path";

/**
 * T3.4 — the three cases, because the defect was one of them.
 *
 * `/c/${category.slug}` is right for a top-level trade and a 404 for every
 * subcategory, and it was built that way on board 10a's zero-result state and
 * on the campaign landing page's only call to action.
 */
describe("a category's address", () => {
  it("is /c/:trade for a top-level trade", () => {
    expect(categoryPath({ slug: "valves-and-fittings", parentSlug: null })).toBe(
      "/c/valves-and-fittings",
    );
  });

  it("is /c/:trade/:niche for a subcategory", () => {
    expect(categoryPath({ slug: "ball-valves", parentSlug: "valves-and-fittings" })).toBe(
      "/c/valves-and-fittings/ball-valves",
    );
  });

  it("treats an unknown parent as no parent, rather than guessing one", () => {
    /*
       The two are deliberately the same answer. A helper that invented a parent
       would be this defect wearing a helper's clothes; a caller that does not
       know has to select it, and this is what it gets if it does not.
    */
    expect(categoryPath({ slug: "ball-valves" })).toBe("/c/ball-valves");
  });
});
