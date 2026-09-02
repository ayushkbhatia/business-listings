import { describe, expect, it } from "vitest";
import {
  buildBusinessSearchText,
  buildProductSearchText,
  isCode,
  matchNeedle,
  valueAliases,
} from "./index-text";

/**
 * Board 1c criteria 1–3, at the layer that decides them.
 *
 * These are unit tests rather than integration ones on purpose: the index is a
 * pure function of a row, and if `DN100` and `4"` do not produce the same token
 * here then no amount of query tuning downstream will make the search work.
 */

const SIZE_FIELD = { id: "f_size", label: "Nominal diameter" };
const APPLICATION = { id: "f_app", label: "Application" };

describe("valueAliases", () => {
  it("reaches a nominal bore from either spelling", () => {
    // Criterion 1, the whole of it in one line.
    expect(valueAliases("DN100")).toContain('4"');
    expect(valueAliases('4"')).toContain("dn100");
  });

  it("expands a trade abbreviation both ways", () => {
    expect(valueAliases("AMC")).toContain("annual maintenance contract");
    expect(valueAliases("annual maintenance contract")).toContain("amc");
  });

  it("indexes a pressure class alongside its psi", () => {
    expect(valueAliases("PN16")).toContain("232 psi");
  });

  it("returns a value that is no kind of size as itself", () => {
    // `sizeAliases` already promises this; the point is that nothing here
    // invents a conversion for a unit it does not know.
    expect(valueAliases("600 CFM")).toEqual(["600 cfm"]);
    expect(valueAliases(null)).toEqual([]);
    expect(valueAliases("  ")).toEqual([]);
  });
});

describe("buildProductSearchText", () => {
  it("finds a product by a size the seller did not type", () => {
    const text = buildProductSearchText({
      name: "Butterfly valve",
      sku: "BV-4-316",
      specValues: { f_size: '4"' },
      fields: [SIZE_FIELD],
    });
    // The seller typed 4". A buyer typing DN100 must still land here.
    expect(text).toContain("dn100");
    expect(text).toContain("bv-4-316");
  });

  it("indexes a spec value under its field label as well as bare", () => {
    // Criterion 3. Both phrasings, because a buyer types either.
    const text = buildProductSearchText({
      name: "End suction pump",
      specValues: { f_app: "chilled water" },
      fields: [APPLICATION],
    });
    expect(text).toContain("chilled water");
    expect(text).toContain("application chilled water");
  });

  it("indexes each entry of a multi-value field", () => {
    const text = buildProductSearchText({
      name: "Ball valve",
      specValues: { f_app: ["chilled water", "potable water"] },
      fields: [APPLICATION],
    });
    expect(text).toContain("chilled water");
    expect(text).toContain("potable water");
  });

  it("survives a spec value whose field is not in the template", () => {
    // A field deleted from a newer template version leaves values behind. The
    // value is still worth indexing; only its label is gone.
    const text = buildProductSearchText({
      name: "Gate valve",
      specValues: { f_gone: "bronze" },
      fields: [],
    });
    expect(text).toContain("bronze");
  });

  it("holds no price, whatever it is handed", () => {
    // The one invariant this file can assert on its own. `Product` has no price
    // column, and nothing may quietly reintroduce one through the index.
    const text = buildProductSearchText({
      name: "Pressure gauge",
      specValues: { f_app: "chilled water" },
      fields: [APPLICATION],
    });
    expect(text).not.toMatch(/aed|price|\bcost\b/i);
  });
});

describe("buildBusinessSearchText", () => {
  it("finds a supplier by what their catalogue can supply", () => {
    /*
     * The board's own example, and the thing business search could not do:
     * "chilled water pumps" naming a specification rather than the supplier.
     */
    const text = buildBusinessSearchText({
      displayName: "Technopump Trading LLC",
      categoryNames: ["Pumps & motors"],
      products: [
        {
          name: "End suction pump",
          specValues: { f_app: "chilled water" },
          fields: [APPLICATION],
        },
      ],
    });
    expect(text).toContain("chilled water");
    expect(text).toContain("pumps & motors");
    expect(text).toContain("technopump trading llc");
  });

  it("carries category synonyms, which is how an Arabic query lands", () => {
    // Criterion 1's third clause. The supplier writes no Arabic; the category
    // does, and the supplier inherits it.
    const text = buildBusinessSearchText({
      displayName: "Gulf Valve Centre",
      categoryNames: ["Valves"],
      synonyms: ["صمامات"],
    });
    expect(text).toContain("صمامات");
  });
});

describe("criterion 2 — a code matches whole, or not at all", () => {
  /*
     The trap this pairing exists to close. `searchText` is matched with a
     substring test, so without the padding on the stored column and the padding
     in the needle, a buyer searching DN10 gets every DN100 product on the site
     — and a wrong size is the one search result that costs somebody money.
  */
  const stored = buildProductSearchText({
    name: "Butterfly valve",
    sku: "6205-2RS",
    specValues: { f_size: "DN100" },
    fields: [SIZE_FIELD],
  });

  const matches = (token: string) => stored.includes(matchNeedle(token));

  it("does not let DN10 reach DN100", () => {
    expect(matches("dn100")).toBe(true);
    expect(matches("dn10")).toBe(false);
  });

  it("does not let a near-miss part number reach the real one", () => {
    expect(matches("6205-2rs")).toBe(true);
    expect(matches("6205-2r")).toBe(false);
    expect(matches("6205")).toBe(false);
  });

  it("still matches a name as a substring, which is where tolerance lives", () => {
    expect(matches("butterfly")).toBe(true);
    expect(matches("valv")).toBe(true);
  });

  it("pads the stored column at both ends so the first and last token match", () => {
    // A token at either edge is the case an unpadded join gets wrong.
    expect(stored.startsWith(" ")).toBe(true);
    expect(stored.endsWith(" ")).toBe(true);
  });

  it("returns empty rather than a lone space when there is nothing to index", () => {
    // Null reads as empty, never as "matches everything".
    expect(buildBusinessSearchText({ displayName: "" })).toBe("");
  });
});

describe("isCode", () => {
  it("treats anything with a digit as a code", () => {
    // Criterion 2: these must never be fuzzy-matched.
    expect(isCode("dn100")).toBe(true);
    expect(isCode("6205-2rs")).toBe(true);
    expect(isCode("ss316")).toBe(true);
  });

  it("treats a plain word as a name", () => {
    expect(isCode("technopump")).toBe(false);
    expect(isCode("pumps")).toBe(false);
  });
});
