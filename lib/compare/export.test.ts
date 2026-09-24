import { describe, expect, it } from "vitest";
import { cellWords, productComparisonSheet } from "./export";
import { buildComparison, type CompareField, type CompareProduct } from "./table";

/**
 * Board `10d` — the comparison as a file, on the exporter `1n` specified for
 * both. The rows are the table's rows and every cell says what the screen says.
 */

const FIELDS: CompareField[] = [
  { id: "size", key: "size", label: "Nominal size", unit: null, type: "text", isFilterable: true, options: [] },
  { id: "seat", key: "seat", label: "Seat material", unit: null, type: "text", isFilterable: true, options: [] },
  { id: "pressure", key: "pressure", label: "Pressure rating", unit: "bar", type: "number", isFilterable: true, options: [] },
];

const product = (id: string, spec: Record<string, unknown>, over: Partial<CompareProduct> = {}): CompareProduct => ({
  id,
  specValues: spec,
  availability: "in_stock",
  stockQty: null,
  leadTimeDays: null,
  replyMs: null,
  ...over,
});

const comparison = buildComparison(
  FIELDS,
  [
    product("a", { size: "DN100", seat: "EPDM", pressure: "16" }, { stockQty: 240, replyMs: 2 * 3_600_000 }),
    product("b", { size: "4 inch" }, { availability: "made_to_order", leadTimeDays: 14 }),
  ],
  { availability: "Availability", reply: "Reply time", completeness: "Spec completeness" },
);

describe("the product comparison as a sheet", () => {
  const sheet = productComparisonSheet({
    trade: "Butterfly valves",
    columns: [
      { name: "Grooved butterfly valve", seller: "Al Waha" },
      { name: "Wafer butterfly valve", seller: "Technopump" },
    ],
    comparison,
  });

  it("names the trade and the basis before any column head", () => {
    expect(sheet.caveat).toMatch(/^2 products in Butterfly valves, field by field/);
    expect(sheet.caveat).toMatch(/Not provided is a gap in a listing, not a difference\.$/);
  });

  it("heads each column with the product and its seller's display name", () => {
    expect(sheet.head).toEqual(["Field", "Grooved butterfly valve — Al Waha", "Wafer butterfly valve — Technopump"]);
  });

  it("carries every template row, in the template's order, and words a gap as the screen does", () => {
    expect(sheet.rows.map((row) => row[0])).toEqual([
      "Nominal size",
      "Seat material",
      "Pressure rating",
      "Availability",
      "Reply time",
      "Spec completeness",
    ]);
    expect(sheet.rows[1]).toEqual(["Seat material", "EPDM", "Not provided"]);
    expect(sheet.rows[2]).toEqual(["Pressure rating", "16 bar", "Not provided"]);
  });

  it("words availability, reply time and completeness in the platform's own terms", () => {
    const [availability, reply, completeness] = comparison.rows.slice(-3);
    expect(cellWords(availability!, availability!.cells[0]!)).toBe("In stock · 240 in stock");
    expect(cellWords(availability!, availability!.cells[1]!)).toBe("Made to order · Lead time 14 days");
    expect(cellWords(reply!, reply!.cells[0]!)).toBe("Typically replies in 2 h");
    expect(cellWords(reply!, reply!.cells[1]!)).toBe("Not enough enquiries to measure");
    expect(cellWords(completeness!, completeness!.cells[1]!)).toBe("1 / 3 fields");
  });
});
