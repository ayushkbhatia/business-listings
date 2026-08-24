import { describe, expect, it } from "vitest";
import {
  assertNoPriceEscapes,
  looksLikeMoney,
  planIsUsable,
  PriceColumnError,
  suggestColumn,
  valuesLookLikeMoney,
  type SpecFieldOption,
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
  it("matches a spec field on its label", () => {
    const suggestion = suggestColumn("Body material", ["Ductile iron"], SPEC_FIELDS);
    expect(suggestion.target).toEqual({ kind: "spec", specFieldId: "f1" });
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
