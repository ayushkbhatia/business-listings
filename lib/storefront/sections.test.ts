import { describe, expect, it } from "vitest";
import {
  applyOrder,
  canAddSection,
  canDisable,
  checkSellerFields,
  resolveSections,
  type SectionRow,
} from "./sections";

/**
 * Criteria 2, 6 and 7 in the pure. The database enforces the same three things
 * with a partial unique index and a check constraint; these are the refusals
 * staff actually read, and a constraint violation surfaced as "an unexpected
 * error" is a constraint nobody can act on.
 */

const row = (over: Partial<SectionRow> & { id: string; type: string }): SectionRow => ({
  sortOrder: 0,
  enabled: true,
  fixed: false,
  singleton: false,
  sellerEditableFields: [],
  showOnMobile: true,
  settings: {},
  ...over,
});

describe("what a storefront renders", () => {
  it("drops the disabled ones rather than hiding them", () => {
    const resolved = resolveSections([
      row({ id: "a", type: "hero", sortOrder: 0 }),
      row({ id: "b", type: "reviews", sortOrder: 1, enabled: false }),
    ]);
    expect(resolved.map((section) => section.id)).toEqual(["a"]);
  });

  it("orders totally, so a tie does not swap between renders", () => {
    const resolved = resolveSections([
      row({ id: "z", type: "reviews", sortOrder: 3 }),
      row({ id: "a", type: "hero", sortOrder: 3 }),
    ]);
    expect(resolved.map((section) => section.id)).toEqual(["a", "z"]);
  });

  it("drops a type that has left the catalogue instead of throwing", () => {
    /*
     * A type can only leave in a deploy. A deploy that made every storefront in
     * a sector return 500 is a worse outcome than one that made a section
     * disappear until somebody noticed.
     */
    const resolved = resolveSections([
      row({ id: "a", type: "hero" }),
      row({ id: "b", type: "something_we_deleted" }),
    ]);
    expect(resolved.map((section) => section.id)).toEqual(["a"]);
  });

  it("never renders a coming-soon type even if a row exists", () => {
    const resolved = resolveSections([row({ id: "a", type: "services" })]);
    expect(resolved).toEqual([]);
  });

  it("carries the definition through, so a renderer needs no second lookup", () => {
    const [hero] = resolveSections([row({ id: "a", type: "hero" })]);
    expect(hero!.definition.singleton).toBe(true);
  });
});

describe("adding a section", () => {
  it("refuses a second singleton and allows a second of anything else", () => {
    // Criterion 7.
    const existing = [{ type: "hero" }, { type: "offer_banner" }];
    expect(canAddSection("hero", existing)).toBe("singleton_exists");
    expect(canAddSection("offer_banner", existing)).toBeNull();
  });

  it("refuses a type nobody has built", () => {
    expect(canAddSection("services", [])).toBe("coming_soon");
    expect(canAddSection("invented", [])).toBe("unknown_type");
  });
});

describe("what a template may open to a seller", () => {
  it("allows only fields the type declares", () => {
    expect(checkSellerFields("hero", ["headline", "eyebrow"])).toBeNull();
    expect(checkSellerFields("hero", ["price"])).toBe("unknown_field");
  });

  it("opens nothing on a section that is entirely derived", () => {
    // A seller-editable trust signal is not a trust signal.
    expect(checkSellerFields("trust_strip", ["headline"])).toBe("unknown_field");
    expect(checkSellerFields("trust_strip", [])).toBeNull();
  });
});

describe("reordering, with the header held down", () => {
  const rows = [
    row({ id: "header", type: "header", sortOrder: 0, fixed: true, singleton: true }),
    row({ id: "hero", type: "hero", sortOrder: 1 }),
    row({ id: "reviews", type: "reviews", sortOrder: 2 }),
  ];

  it("keeps a fixed section first however it is dragged", () => {
    // Criterion 6. A drag that tried to drop something above the header lands
    // below it, which is what the builder should feel like.
    const ordered = applyOrder(rows, ["reviews", "header", "hero"]);
    expect(ordered.map((section) => section.id)).toEqual(["header", "reviews", "hero"]);
    expect(ordered.map((section) => section.sortOrder)).toEqual([0, 1, 2]);
  });

  it("does not lose a section the caller forgot to mention", () => {
    const ordered = applyOrder(rows, ["reviews"]);
    expect(ordered.map((section) => section.id)).toEqual(["header", "reviews", "hero"]);
  });

  it("ignores an id that is not in the template", () => {
    const ordered = applyOrder(rows, ["hero", "not-ours", "reviews"]);
    expect(ordered.map((section) => section.id)).toEqual(["header", "hero", "reviews"]);
  });

  it("refuses to disable a fixed section", () => {
    expect(canDisable({ fixed: true })).toBe("section_is_fixed");
    expect(canDisable({ fixed: false })).toBeNull();
  });
});
