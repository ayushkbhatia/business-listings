import { describe, expect, it } from "vitest";
import {
  PriceColumnError,
  assertNoPriceEscapes,
  looksLikeMoney,
  planIsUsable,
  resolveConflicts,
  resolveTargetKey,
  statusOf,
  suggestColumn,
  tallyOf,
  type SpecFieldOption,
  valuesLookLikeMoney,
} from "@/lib/import/columns";

const SPEC_FIELDS: SpecFieldOption[] = [
  { id: "f1", key: "body_material", label: "Body material", isFilterable: true },
  { id: "f2", key: "nominal_diameter", label: "Nominal diameter", isFilterable: true },
  { id: "f3", key: "pressure_rating", label: "Pressure rating", isFilterable: true },
  { id: "f4", key: "face_to_face", label: "Face to face", isFilterable: false },
];

const blank: string[] = [];

describe("criterion 7 — a price column cannot be imported", () => {
  it("refuses the column the board names", () => {
    const suggestion = suggestColumn("Unit Price AED", ["120.00", "340.00", "89.50"], SPEC_FIELDS);
    expect(suggestion.target.kind).toBe("blocked");
    expect(suggestion.reason).toContain("belong on a quote");
  });

  it("refuses every name a supplier's own export actually uses", () => {
    // Matching "price" alone would catch the first and wave through the rest,
    // and the rest are the same field.
    const headers = [
      "Price", "Unit Price", "Unit Price (AED)", "List Price", "Net Price",
      "Selling Price USD", "Purchase Price", "Rate", "Unit Rate", "Cost",
      "Landed Cost", "Ex-Works", "EXW", "FOB", "CIF", "MRP", "RRP", "MSRP",
      "Amount", "Total", "Subtotal", "VAT", "Tax", "AED", "Margin", "Markup",
      "Discount %", "Stock Value", "Charges", "Handling Fee",
    ];
    for (const header of headers) {
      expect(looksLikeMoney(header), header).toBe(true);
    }
  });

  it("does not refuse an engineering term that contains a money word", () => {
    // A valves directory sees these constantly. Kv is a flow coefficient, and
    // refusing it would be refusing a spec.
    for (const header of [
      "K Value", "Kv Value", "Cv Value", "pH Value", "Nominal Value",
      "Flow Rate", "Rated Pressure", "Rated Torque", "Total Length",
      "Total Weight", "Total Qty",
    ]) {
      expect(looksLikeMoney(header), header).toBe(false);
    }
  });

  it("refuses a column whose header hides it but whose values do not", () => {
    // "Col 7" holding "AED 1,240.00" is a price column whatever it is called.
    expect(valuesLookLikeMoney(["AED 1,240.00", "AED 89.00", "AED 12,500.00"])).toBe(true);
    const suggestion = suggestColumn("Col 7", ["1,240.00", "89.50", "12,500.00"], SPEC_FIELDS);
    expect(suggestion.target.kind).toBe("blocked");
    expect(suggestion.reason).toContain("amounts of money");
  });

  it("does not read quantities or lead times as money", () => {
    expect(valuesLookLikeMoney(["12", "40", "6", "18"])).toBe(false);
    expect(valuesLookLikeMoney(["7", "14", "21"])).toBe(false);
    expect(suggestColumn("Qty", ["12", "40", "6"], SPEC_FIELDS).target.kind).toBe("stock_qty");
    expect(suggestColumn("Lead Time", ["7", "14", "21"], SPEC_FIELDS).target.kind).toBe(
      "lead_time_days",
    );
  });

  it("checks money before anything else, so a price cannot be read as a name", () => {
    // "Price Description" contains both. Money wins, because the cost of being
    // wrong the other way is a price on a public product row.
    expect(suggestColumn("Price Description", blank, SPEC_FIELDS).target.kind).toBe("blocked");
  });

  it("throws rather than warns if a money column reaches the service", () => {
    // The mapper will not offer it, but the plan travels through a form and a
    // saved mapping, and both are strings the seller could edit.
    expect(() =>
      assertNoPriceEscapes({
        columns: [
          { header: "Item", target: { kind: "name" } },
          { header: "Unit Price AED", target: { kind: "spec", specFieldId: "f1" } },
        ],
      }),
    ).toThrow(PriceColumnError);
  });

  it("allows a money column that is honestly marked blocked", () => {
    expect(() =>
      assertNoPriceEscapes({
        columns: [
          { header: "Item", target: { kind: "name" } },
          { header: "Unit Price AED", target: { kind: "blocked" } },
        ],
      }),
    ).not.toThrow();
  });
});

describe("what a column becomes", () => {
  it("matches a spec field on its label, and names it by key", () => {
    /*
       A key, not an id — board 11d. The template is resolved per row now, so
       two subcategories in one file both have a `body_material` field and those
       are two `SpecField` rows with two ids. The column means the same thing in
       both, and only the key can say so.
    */
    const suggestion = suggestColumn("Body material", ["Ductile iron"], SPEC_FIELDS);
    expect(suggestion.target).toEqual({ kind: "spec", specFieldKey: "body_material" });
    expect(suggestion.confidence).toBe("certain");
  });

  it("says when a field drives a filter, because that is why it matters", () => {
    // The FILTER marker is what turns data entry into "this is why you get found".
    expect(suggestColumn("Body material", blank, SPEC_FIELDS).reason).toContain("findable");
    expect(suggestColumn("Face to face", blank, SPEC_FIELDS).reason).not.toContain("findable");
  });

  it("prefers a spec field over a fuzzy product field", () => {
    // "Body material" ends in a word the name list would otherwise claim.
    expect(suggestColumn("Body material", blank, SPEC_FIELDS).target.kind).toBe("spec");
  });

  it("maps the ordinary product columns", () => {
    expect(suggestColumn("Item Name", blank, SPEC_FIELDS).target.kind).toBe("name");
    expect(suggestColumn("Part No", blank, SPEC_FIELDS).target.kind).toBe("sku");
    expect(suggestColumn("MOQ", blank, SPEC_FIELDS).target.kind).toBe("min_order_qty");
    expect(suggestColumn("Availability", blank, SPEC_FIELDS).target.kind).toBe("availability");
  });

  it("leaves a column it cannot place alone rather than guessing wrongly", () => {
    const suggestion = suggestColumn("Internal notes ref 4", blank, SPEC_FIELDS);
    expect(suggestion.target.kind).toBe("ignore");
  });

  it("offers a split when two fields share a column", () => {
    // "DI / SS316" — the board's own example.
    const suggestion = suggestColumn(
      "Material",
      ["DI / SS316", "CI / SS304", "DI / SS316"],
      SPEC_FIELDS,
    );
    expect(suggestion.splittable).toEqual({ on: " / ", parts: 2 });
  });

  it("does not offer a split on a column that merely contains a slash", () => {
    const suggestion = suggestColumn(
      "Notes",
      ["fits 2/3 sizes", "standard", "n/a", "standard"],
      SPEC_FIELDS,
    );
    expect(suggestion.splittable).toBeUndefined();
  });
});

describe("a plan has to produce a product", () => {
  it("is unusable without a name column", () => {
    expect(planIsUsable({ columns: [{ header: "SKU", target: { kind: "sku" } }] })).toBe(false);
  });

  it("is usable with one", () => {
    expect(
      planIsUsable({
        columns: [
          { header: "Item", target: { kind: "name" } },
          { header: "Unit Price", target: { kind: "blocked" } },
        ],
      }),
    ).toBe(true);
  });
});

/* ── Board 11d ────────────────────────────────────────────────────────────── */

describe("the two columns the board counted and did not show", () => {
  it("recognises the column that selects the subcategory", () => {
    // Without it the import cannot know which template a row belongs to, which
    // is the whole of §"One template badge".
    expect(suggestColumn("Category", ["Butterfly valves"], []).target).toEqual({
      kind: "subcategory",
    });
    expect(suggestColumn("Product Group", ["Valves"], []).target).toEqual({ kind: "subcategory" });
  });

  it("does not read `Type` as the taxonomy", () => {
    /*
       The most tempting word on that list and the most dangerous. `Type` in a
       valves file is `Butterfly / Gate / Ball` — a spec field — and mapping it
       to the taxonomy files every row under a subcategory that does not exist
       and errors the lot.
    */
    expect(suggestColumn("Type", ["Butterfly"], []).target.kind).not.toBe("subcategory");
  });

  it("recognises the photo column, on the only bulk route to media", () => {
    expect(suggestColumn("Photo File", ["bf-100.jpg"], []).target).toEqual({ kind: "photo" });
    expect(suggestColumn("Image", ["a.jpg"], []).target).toEqual({ kind: "photo" });
  });

  it("does not read `Material` as the product name", () => {
    /*
       It was on the `name` word list, matched exactly, and therefore beat every
       spec field. In a valves directory `Material` is the single most common
       spec column there is, and the board's own render maps it to two.
    */
    expect(suggestColumn("Material", ["DI / SS316"], []).target.kind).not.toBe("name");
  });
});

describe("a column's status, and a tally that sums", () => {
  it("blocks a price column whatever else is true of it", () => {
    expect(statusOf({ target: { kind: "blocked" }, confidence: "certain" })).toBe("blocked");
  });

  it("asks for the seller on a split, an unresolved value, or a guess", () => {
    expect(statusOf({ target: { kind: "spec" }, splitPending: true })).toBe("needs_you");
    expect(statusOf({ target: { kind: "photo" }, unresolved: 7 })).toBe("needs_you");
    expect(statusOf({ target: { kind: "sku" }, confidence: "guess" })).toBe("needs_you");
  });

  it("is matched when nothing is outstanding", () => {
    expect(statusOf({ target: { kind: "name" }, confidence: "certain", unresolved: 0 })).toBe(
      "matched",
    );
  });

  it("sums to the column count, which is what the board's header did not", () => {
    // `Auto-matched 7 of 9` over statuses showing four matched, one needing
    // input, one blocked and one ignored — seven rows for nine columns.
    const tally = tallyOf(["matched", "matched", "needs_you", "blocked", "ignored"]);
    expect(tally.matched + tally.needs_you + tally.blocked + tally.ignored).toBe(tally.total);
    expect(tally.total).toBe(5);
  });
});

describe("a saved mapping from before board 11d", () => {
  it("reads a stored field id back as a key", () => {
    const keyById = new Map([["field-abc", "nominal_size"]]);
    expect(resolveTargetKey({ kind: "spec", specFieldId: "field-abc" }, keyById)).toBe(
      "nominal_size",
    );
  });

  it("prefers the key when the plan carries one", () => {
    expect(
      resolveTargetKey({ kind: "spec", specFieldKey: "body_material", specFieldId: "x" }, new Map()),
    ).toBe("body_material");
  });

  it("gives up on an id whose field has been deleted, rather than guessing a replacement", () => {
    // Guessing by position or by name is how a saved mapping quietly starts
    // filling the wrong column.
    expect(resolveTargetKey({ kind: "spec", specFieldId: "gone" }, new Map())).toBeUndefined();
  });
});

describe("two columns cannot claim one field", () => {
  /*
     Found by reading the running screen, not the diff.

     `Part No` matched `sku` outright and `Supplier Ref` matched it too, on the
     word `ref`, at `guess` confidence. The table told the seller both were
     `Your reference` while the import reads the first and drops the second —
     a lie about what the screen was about to do, on the one screen whose whole
     job is being exact about where a column lands.
  */
  const suggest = (header: string) => suggestColumn(header, ["x", "y", "z"], []);

  it("keeps the confident column and unplaces the guess", () => {
    const resolved = resolveConflicts([suggest("Part No"), suggest("Supplier Ref")]);
    expect(resolved[0]!.target).toEqual({ kind: "sku" });
    expect(resolved[1]!.target).toEqual({ kind: "ignore" });
  });

  it("leaves the loser reading `Needs you`, not `Ignored`", () => {
    // We do not know what that column is. Saying so is the honest version of
    // the same answer, and it is what stops a column going missing unnoticed.
    const resolved = resolveConflicts([suggest("Part No"), suggest("Supplier Ref")]);
    expect(statusOf({ target: resolved[1]!.target, confidence: resolved[1]!.confidence })).toBe(
      "needs_you",
    );
  });

  it("keeps the earlier column when both are equally sure", () => {
    const resolved = resolveConflicts([suggest("SKU"), suggest("Item Code")]);
    expect(resolved[0]!.target).toEqual({ kind: "sku" });
    expect(resolved[1]!.target).toEqual({ kind: "ignore" });
  });

  it("never demotes a photo or a spec column, because a file has several", () => {
    // `photo_1…photo_6` is what our own export writes.
    const photos = resolveConflicts([suggest("photo_1"), suggest("photo_2"), suggest("photo_3")]);
    expect(photos.every((column) => column.target.kind === "photo")).toBe(true);
  });
});

describe("a column the matcher could not place", () => {
  it("asks rather than dropping it silently", () => {
    /*
       `Size` had no field to match and read `Ignored` — identical to
       `Supplier Ref`, which the seller means to discard. On a forty-column file
       that is how a column goes missing without anyone noticing.
    */
    const unplaced = suggestColumn("Warehouse bay", ["A1", "B2", "C3"], []);
    expect(unplaced.target.kind).toBe("ignore");
    expect(unplaced.confidence).toBe("guess");
    expect(statusOf({ target: unplaced.target, confidence: unplaced.confidence })).toBe("needs_you");
  });

  it("reads as ignored once the seller has said so", () => {
    // No confidence means the seller set it, and then `Ignored` means what it
    // says.
    expect(statusOf({ target: { kind: "ignore" } })).toBe("ignored");
  });

  it("places a three-word stock heading, which is most of them", () => {
    // `Qty on hand` fell through to `ignore` at a two-word limit and the screen
    // offered to drop it.
    expect(suggestColumn("Qty on hand", ["24", "12", "8"], []).target).toEqual({
      kind: "stock_qty",
    });
  });

  it("still refuses a long header carrying one incidental match", () => {
    // The reason the limit exists: `ref` inside four words is not a reference
    // column, and a wrong column mapped to SKU is worse than one left alone.
    expect(suggestColumn("Internal notes ref 4", ["a", "b", "c"], []).target.kind).toBe("ignore");
  });
});
