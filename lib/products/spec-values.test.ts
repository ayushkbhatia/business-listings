import { describe, expect, it } from "vitest";
import { isMultiselect, mergeSpecValues, selectedMulti } from "./spec-values";

/**
 * The guarantee board 3h's rename warning has been making since it shipped:
 * "the products already using it keep their values".
 *
 * It was false. These are the cases that made it false, and the one that made
 * it look fine in a screenshot.
 */

const known = new Set(["a", "b", "c"]);

describe("merging spec values", () => {
  it("keeps a value whose field the form never showed", () => {
    /*
       The whole bug in one assertion. `b` was hidden, so no input was rendered
       and nothing was posted for it — and the old code read that as "cleared".
    */
    expect(
      mergeSpecValues({
        stored: { a: "DN50", b: "Cast iron" },
        presented: ["a"],
        posted: { a: "DN50" },
        known,
      }),
    ).toEqual({ a: "DN50", b: "Cast iron" });
  });

  it("clears a value the form showed and the seller emptied", () => {
    // The other half. A field on screen is the seller's to clear, and a merge
    // that never deleted would make emptying a box impossible.
    expect(
      mergeSpecValues({
        stored: { a: "DN50", b: "Cast iron" },
        presented: ["a", "b"],
        posted: { a: "DN50", b: "" },
        known,
      }),
    ).toEqual({ a: "DN50" });
  });

  it("treats whitespace as empty, so a space bar does not store a value", () => {
    expect(
      mergeSpecValues({ stored: { a: "DN50" }, presented: ["a"], posted: { a: "   " }, known }),
    ).toEqual({});
  });

  it("ignores a posted field the template does not carry", () => {
    // A form is a suggestion. An id off another template would otherwise become
    // a key nothing can render and nothing can clear.
    expect(
      mergeSpecValues({
        stored: { a: "DN50" },
        presented: ["a", "z"],
        posted: { a: "DN50", z: "smuggled" },
        known,
      }),
    ).toEqual({ a: "DN50" });
  });

  it("keeps an orphan value the template no longer carries", () => {
    /*
       A field removed from a live platform template leaves values behind.
       Nothing prunes them and this must not become the thing that does: a
       removal that silently emptied every product's stored value is the
       retroactive destruction board 3h §5 exists to prevent, and the field may
       come back.
    */
    expect(
      mergeSpecValues({
        stored: { a: "DN50", gone: "Brass" },
        presented: ["a"],
        posted: { a: "DN50" },
        known,
      }),
    ).toEqual({ a: "DN50", gone: "Brass" });
  });

  it("changes nothing when the form showed nothing", () => {
    // A save from a screen with no spec section at all — the catalogue's
    // inline editor, a status flip — must not touch the specs.
    expect(
      mergeSpecValues({ stored: { a: "DN50", b: "Cast iron" }, presented: [], posted: {}, known }),
    ).toEqual({ a: "DN50", b: "Cast iron" });
  });

  it("does not mutate what it was given", () => {
    const stored = { a: "DN50" };
    mergeSpecValues({ stored, presented: ["a"], posted: { a: "" }, known });
    expect(stored).toEqual({ a: "DN50" });
  });
});

/**
 * Board 3g's additions: the array a multiselect stores, and the field the
 * seller invented.
 */
describe("multiselect values", () => {
  const known = new Set(["a", "cert"]);
  const arrayFields = new Set(["cert"]);

  it("stores an array, not the joined string it arrived as", () => {
    /*
       The bug this closes. `certification` is declared `multiselect` and the
       seed writes `["WRAS", "UL listed"]`; nothing here could represent one, so
       every branch assigned a trimmed string and the first save of a product
       carrying an array replaced it with whatever a single <Select> had posted.
       It was dormant only because the editor resolved no template and rendered
       no field at all.
    */
    expect(
      mergeSpecValues({
        stored: { cert: ["WRAS"] },
        presented: ["cert"],
        posted: { cert: "WRAS|UL listed" },
        known,
        arrayFields,
      }),
    ).toEqual({ cert: ["WRAS", "UL listed"] });
  });

  it("survives a save that posts the stored value back unchanged", () => {
    // The commonest save of all: the seller edited the name and touched nothing
    // else. This is the one that was destroying data on every product.
    expect(
      mergeSpecValues({
        stored: { cert: ["WRAS", "UL listed"] },
        presented: ["cert"],
        posted: { cert: "WRAS|UL listed" },
        known,
        arrayFields,
      }),
    ).toEqual({ cert: ["WRAS", "UL listed"] });
  });

  it("clears a multiselect the seller emptied", () => {
    expect(
      mergeSpecValues({
        stored: { cert: ["WRAS"] },
        presented: ["cert"],
        posted: { cert: "" },
        known,
        arrayFields,
      }),
    ).toEqual({});
  });

  it("keeps an option containing a comma whole", () => {
    // Why the wire format is `|` and not `,`. "Grooved, AWWA C606" is one
    // option, and the CSV importer already writes comma-joined strings into the
    // same column — a comma cannot mean both "inside an option" and "between
    // two".
    expect(
      mergeSpecValues({
        stored: {},
        presented: ["cert"],
        posted: { cert: "Grooved, AWWA C606|UL listed" },
        known,
        arrayFields,
      }),
    ).toEqual({ cert: ["Grooved, AWWA C606", "UL listed"] });
  });

  it("leaves a field that is not a multiselect as a string", () => {
    expect(
      mergeSpecValues({
        stored: {},
        presented: ["a"],
        posted: { a: "DN50|DN80" },
        known,
        arrayFields,
      }),
    ).toEqual({ a: "DN50|DN80" });
  });
});

describe("a field the seller invented", () => {
  it("is stored when the template says it exists", () => {
    /*
       `known` used to come from `specField.findMany`, which returns platform
       fields only — so a value typed into a seller's own field was posted,
       ignored, and silently lost. It is built from the resolved template now,
       and that carries both kinds.
    */
    expect(
      mergeSpecValues({
        stored: {},
        presented: ["own-warranty"],
        posted: { "own-warranty": "24" },
        known: new Set(["own-warranty"]),
      }),
    ).toEqual({ "own-warranty": "24" });
  });
});

describe("reading a stored multiselect back", () => {
  it("takes an array as it is", () => {
    expect(selectedMulti(["WRAS", "UL listed"])).toEqual(["WRAS", "UL listed"]);
  });

  it("splits the comma-joined string the CSV importer writes", () => {
    /*
       `lib/import/service.ts` builds `Record<string, string>` and never an
       array, so an imported product's certification is one comma-joined cell.
       A reader that understood only the array would show it as empty — and the
       next save would then clear a value the buyer can see on the storefront.
    */
    expect(selectedMulti("WRAS, UL listed")).toEqual(["WRAS", "UL listed"]);
  });

  it("is empty for an empty value", () => {
    expect(selectedMulti("")).toEqual([]);
    expect(selectedMulti(null)).toEqual([]);
    expect(selectedMulti(undefined)).toEqual([]);
  });
});

describe("what counts as a multiselect", () => {
  it("accepts the keyword", () => {
    expect(isMultiselect("multiselect")).toBe(true);
  });

  it("accepts the display label board 3h was writing into the column", () => {
    /*
       `stage()` pushed `typeLabel()` into `OwnField.type`, so some rows carry
       "Multi-select · 18 options" where a keyword belongs. The writer is fixed;
       a JSON column cannot be backfilled without a migration, so the read stays
       defensive. A plain `split(" · ")[0].toLowerCase()` yields "multi-select",
       misses, and sends the one field whose value is an array down the string
       branch that deletes it.
    */
    expect(isMultiselect("Multi-select · 18 options")).toBe(true);
    expect(isMultiselect("Multi-select")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isMultiselect("select")).toBe(false);
    expect(isMultiselect("Select · 18 options")).toBe(false);
    expect(isMultiselect("text")).toBe(false);
    expect(isMultiselect("number")).toBe(false);
  });
});
