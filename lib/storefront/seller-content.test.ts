import { describe, expect, it } from "vitest";
import { sanitiseContent } from "./seller-content";

/**
 * `StorefrontContent.values` is validated at the read — board `5c-s` B4 and the
 * model's own promise. Nothing writes it yet; everything that ever will passes
 * through this.
 */

const hero = { type: "hero", sellerEditableFields: ["headline", "eyebrow", "buttonLabel", "image"] };

describe("what a seller's filled values may put on a page", () => {
  it("keeps a valid line", () => {
    expect(sanitiseContent(hero, { headline: "  Valves off the shelf  " })).toEqual({
      headline: "Valves off the shelf",
    });
  });

  it("drops a line that states a price — B4", () => {
    expect(sanitiseContent(hero, { headline: "Valves from AED 40", eyebrow: "Al Quoz" })).toEqual({
      eyebrow: "Al Quoz",
    });
    const offer = { type: "offer_banner", sellerEditableFields: ["headline", "body"] };
    expect(sanitiseContent(offer, { body: "20% off every order this week" })).toEqual({});
  });

  it("drops a key the template did not open, and one the type does not declare", () => {
    const closed = { type: "hero", sellerEditableFields: ["headline"] };
    expect(sanitiseContent(closed, { headline: "Ours", eyebrow: "Not opened", price: "40" })).toEqual({
      headline: "Ours",
    });
  });

  it("drops an over-long line rather than cutting a sentence nobody wrote", () => {
    expect(sanitiseContent(hero, { headline: "x".repeat(91) })).toEqual({});
  });

  it("keeps picks as ids, de-duplicated and capped", () => {
    const grid = { type: "scope_grid", sellerEditableFields: ["services"] };
    const ids = Array.from({ length: 14 }, (_, i) => `s${i}`);
    const out = sanitiseContent(grid, { services: [...ids, "s1", 7, null] });
    expect(out.services).toHaveLength(12);
    expect(new Set(out.services as string[]).size).toBe(12);
  });

  it("returns nothing for an unknown type or a value that is not an object", () => {
    expect(sanitiseContent({ type: "invented", sellerEditableFields: ["x"] }, { x: "y" })).toEqual({});
    expect(sanitiseContent(hero, "headline")).toEqual({});
    expect(sanitiseContent(hero, null)).toEqual({});
  });
});
