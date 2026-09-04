import { describe, expect, it } from "vitest";
import { joinClauses, setupClauses } from "./recommendation";

/**
 * Board 2e's second correction, as assertions.
 *
 * The render said "3 branches, a fabrication shop and an existing product list"
 * for a seller who pinned one location of type workshop. Criterion 9 makes a
 * branch count that disagrees with `2d` a failure of the board, so the count
 * here is the count and nothing rounds it, pluralises it optimistically, or
 * fills a gap with a guess.
 */

const ONE_WORKSHOP = {
  locations: 1,
  locationTypes: ["workshop"] as const,
  categories: ["HVAC & ventilation"],
  products: 0,
};

describe("what can honestly be said about a seller's setup", () => {
  it("reports one location as one", () => {
    const [first] = setupClauses({ ...ONE_WORKSHOP });
    expect(first).toEqual({ kind: "locations", count: 1, types: ["workshop"] });
  });

  it("reports three as three", () => {
    const [first] = setupClauses({
      ...ONE_WORKSHOP,
      locations: 3,
      locationTypes: ["head_office", "workshop", "warehouse"],
    });
    expect(first).toMatchObject({ count: 3 });
  });

  it("does not repeat a type a seller has three of", () => {
    // "a warehouse, a warehouse and a warehouse" is what a naive map produces.
    const [first] = setupClauses({
      ...ONE_WORKSHOP,
      locations: 3,
      locationTypes: ["warehouse", "warehouse", "warehouse"],
    });
    expect(first).toEqual({ kind: "locations", count: 3, types: ["warehouse"] });
  });

  it("keeps the types in the order the cards render them", () => {
    const [first] = setupClauses({
      ...ONE_WORKSHOP,
      locations: 2,
      locationTypes: ["workshop", "head_office"],
    });
    expect(first).toMatchObject({ types: ["workshop", "head_office"] });
  });

  it("names the categories the seller actually chose", () => {
    const clauses = setupClauses({
      ...ONE_WORKSHOP,
      categories: ["HVAC & ventilation", "Valves & fittings"],
    });
    expect(clauses).toContainEqual({
      kind: "categories",
      names: ["HVAC & ventilation", "Valves & fittings"],
    });
  });

  it("mentions the catalogue only when there is nothing in it", () => {
    /*
       "A product list to load" is the seller's next hour. "Forty products" is a
       fact they already know, and a page that reads it back is padding.
    */
    expect(setupClauses({ ...ONE_WORKSHOP, products: 0 })).toContainEqual({
      kind: "catalogue",
      loaded: false,
    });
    expect(setupClauses({ ...ONE_WORKSHOP, products: 40 }).map((c) => c.kind)).not.toContain(
      "catalogue",
    );
  });

  it("leaves out what is not there rather than guessing", () => {
    const clauses = setupClauses({
      locations: 0,
      locationTypes: [],
      categories: [],
      products: 4,
    });
    expect(clauses).toEqual([]);
  });

  it("still says something for the thinnest seller who can reach this page", () => {
    // One location and one category are required to get here, so the floor is
    // two clauses rather than none.
    expect(setupClauses(ONE_WORKSHOP)).toHaveLength(3);
  });
});

describe("joining the clauses", () => {
  const WORDS = { join: ", ", and: " and " };

  it("uses the conjunction for the last one", () => {
    expect(joinClauses(["a", "b", "c"], WORDS)).toBe("a, b and c");
  });

  it("uses no separator for one", () => {
    expect(joinClauses(["a"], WORDS)).toBe("a");
  });

  it("returns nothing for none, so the caller can drop the sentence", () => {
    expect(joinClauses([], WORDS)).toBe("");
  });

  it("takes both words from the caller, because a locale owns them", () => {
    // Arabic needs both and neither is a comma.
    expect(joinClauses(["a", "b"], { join: "، ", and: " و" })).toBe("a وb");
  });
});
