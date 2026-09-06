import { describe, expect, it } from "vitest";
import { facetStateOf, readMappings, readOwnFields } from "./overlay";

/**
 * The overlay's read path. Every one of these is a shape that has actually been
 * in the database.
 */

describe("reading a stored overlay", () => {
  it("ignores the shape the seed used to write", () => {
    /*
       `{ sellerKey: platformFieldId }` — the mapping in docs/data-model.md,
       which describes the opposite direction to the one implemented. It
       resolved to nothing and did nothing for as long as it was there; this
       says so rather than letting a string reach a caller expecting an object.
    */
    expect(readMappings({ size: "cabc123", rating: "cdef456" })).toEqual({});
  });

  it("drops a hidden flag left behind by the control that wrote one", () => {
    // Hiding deleted product data one screen over. See migration
    // 20260914090000_drop_field_hidden.
    expect(readMappings({ f1: { hidden: true, label: "Keep" } })).toEqual({ f1: { label: "Keep" } });
  });

  it("keeps only the members it knows", () => {
    expect(
      readMappings({ f1: { label: "A", sortOrder: 2, required: true, detached: true, junk: 1 } }),
    ).toEqual({ f1: { label: "A", sortOrder: 2, required: true, detached: true } });
  });

  it("treats required:false as nothing added, never as not required", () => {
    // The platform's requirement is a floor. A stored `false` cannot lower it,
    // so it is not stored at all.
    expect(readMappings({ f1: { required: false } })).toEqual({ f1: {} });
  });

  it("survives a null, an array and a string where an object was expected", () => {
    expect(readMappings(null)).toEqual({});
    expect(readMappings("nonsense")).toEqual({});
    expect(readMappings({ f1: ["a"] })).toEqual({});
  });

  it("reads own fields and skips a malformed one", () => {
    const fields = readOwnFields([
      { id: "a", label: "Warranty", type: "text", sortOrder: 1 },
      { label: "No id" },
      null,
    ]);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ id: "a", label: "Warranty", required: false, options: [] });
  });
});

describe("what the FILTER column says", () => {
  it("is the platform's where the platform filters on it", () => {
    expect(facetStateOf({ own: false, detached: false, isFilterable: true })).toBe("platform");
  });

  it("is not a facet where nobody filters on it", () => {
    expect(facetStateOf({ own: false, detached: false, isFilterable: false })).toBe("not_a_facet");
  });

  it("is the seller's alone once detached, whatever the platform does", () => {
    // Detaching is what makes a field stop being the same field as every other
    // seller's — so it cannot be in a facet that spans them.
    expect(facetStateOf({ own: false, detached: true, isFilterable: true })).toBe("yours_only");
  });

  it("is the seller's alone for a field they invented", () => {
    expect(facetStateOf({ own: true, detached: false, isFilterable: false })).toBe("yours_only");
  });
});
