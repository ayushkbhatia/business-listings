import { describe, expect, it } from "vitest";
import {
  facetStateOf,
  isFilled,
  missingFrom,
  readMappings,
  readOwnFields,
  type RequirementField,
} from "./overlay";

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

/**
 * The requirement predicate, split out of `./template.ts` so board 3g's
 * disabled Save and `saveProduct`'s refusal are one definition rather than two.
 */
describe("what a product still owes", () => {
  const field = (over: Partial<RequirementField> = {}): RequirementField => ({
    fieldId: "a",
    label: "Body material",
    requiredNow: true,
    ...over,
  });

  it("names the field, in the seller's own words", () => {
    // The seller renamed it, so the refusal has to name the box on the screen
    // they are looking at rather than the platform's word for it.
    expect(missingFrom([field({ label: "Material of construction" })], {})).toEqual({
      ok: false,
      missing: ["Material of construction"],
    });
  });

  it("is satisfied by a value", () => {
    expect(missingFrom([field()], { a: "Ductile iron" })).toEqual({ ok: true, missing: [] });
  });

  it("says nothing about a field whose requirement has not started biting", () => {
    /*
       Board 4e's grace period, resolved on the server into `requiredNow`. A
       field required from a date in the future is not required yet, and
       blocking a seller over one blocks them for work they cannot be asked to
       do — which is the retroactive behaviour board 3h §5 exists to prevent.
    */
    expect(missingFrom([field({ requiredNow: false })], {})).toEqual({ ok: true, missing: [] });
  });

  it("counts an empty array and a whitespace string as unfilled", () => {
    // The same emptiness test lib/metrics/spec-completeness.ts applies. Two
    // answers to "is this filled" is how a completeness figure and a save
    // refusal end up disagreeing about one product.
    expect(missingFrom([field()], { a: [] }).ok).toBe(false);
    expect(missingFrom([field()], { a: "   " }).ok).toBe(false);
    expect(missingFrom([field()], { a: ["WRAS"] }).ok).toBe(true);
  });

  it("names every offender, not the first", () => {
    expect(
      missingFrom(
        [field({ fieldId: "a", label: "Bore size" }), field({ fieldId: "b", label: "Working pressure" })],
        {},
      ).missing,
    ).toEqual(["Bore size", "Working pressure"]);
  });
});

describe("isFilled", () => {
  it("agrees with the completeness job case for case", () => {
    expect(isFilled(null)).toBe(false);
    expect(isFilled(undefined)).toBe(false);
    expect(isFilled("")).toBe(false);
    expect(isFilled("  ")).toBe(false);
    expect(isFilled([])).toBe(false);
    expect(isFilled("DN50")).toBe(true);
    expect(isFilled(0)).toBe(true);
    expect(isFilled(["WRAS"])).toBe(true);
  });
});
