import { describe, expect, it } from "vitest";
import {
  buildComparison,
  sameValues,
  visibleRows,
  type CompareField,
  type CompareProduct,
} from "./table";

/**
 * Board `10d` — which cells differ, which is the whole screen.
 *
 * The fixture is the board's own: four butterfly valves from four sellers, the
 * same size written two ways, one field nobody-but-three filled, one field
 * nobody filled at all. Each rule is asserted against the row it decides.
 */

const field = (id: string, label: string, overrides: Partial<CompareField> = {}): CompareField => ({
  id,
  key: id,
  label,
  unit: null,
  type: "text",
  isFilterable: true,
  options: [],
  ...overrides,
});

const FIELDS: CompareField[] = [
  field("size", "Nominal size", { key: "size", type: "text" }),
  field("end", "End connection", { type: "select", options: ["Grooved, AWWA C606", "Lugged wafer", "Wafer"] }),
  field("body", "Body material", { type: "select", options: ["Ductile iron GGG40", "Ductile iron", "Cast iron GG25"] }),
  field("seat", "Seat material"),
  field("cert", "Certification"),
  field("pressure", "Pressure rating"),
  field("coating", "Coating"),
];

const product = (id: string, spec: Record<string, unknown>, overrides: Partial<CompareProduct> = {}): CompareProduct => ({
  id,
  specValues: spec,
  availability: "in_stock",
  stockQty: null,
  leadTimeDays: null,
  replyMs: 2 * 3_600_000,
  ...overrides,
});

const PRODUCTS: CompareProduct[] = [
  product("p1", { size: "DN100", end: "Grooved, AWWA C606", body: "Ductile iron GGG40", seat: "EPDM", cert: "UL/FM, Civil Defence", pressure: "PN16" }, { stockQty: 240 }),
  product("p2", { size: '4"', end: "Lugged wafer", body: "Ductile iron", seat: "EPDM", cert: "UL listed", pressure: "232 psi" }),
  product("p3", { size: "DN100", end: "Grooved, AWWA C606", body: "Ductile iron GGG40", seat: "EPDM", cert: "UL/FM, Civil Defence", pressure: "PN16" }),
  product("p4", { size: "4 inch", end: "Wafer", body: "Cast iron GG25", pressure: "PN16" }, { availability: "made_to_order", leadTimeDays: 14 }),
];

const LABELS = { availability: "Availability", reply: "Reply time", completeness: "Spec completeness" };
const table = buildComparison(FIELDS, PRODUCTS, LABELS);
const row = (key: string) => table.rows.find((candidate) => candidate.key === key)!;

describe("B1 — the template makes the rows", () => {
  it("renders every template field, in template order, then the product and seller rows", () => {
    expect(table.rows.map((candidate) => candidate.label)).toEqual([
      "Nominal size",
      "End connection",
      "Body material",
      "Seat material",
      "Certification",
      "Pressure rating",
      "Coating",
      "Availability",
      "Reply time",
      "Spec completeness",
    ]);
  });

  it("keeps a field no column filled, marked empty rather than dropped", () => {
    expect(row("spec:coating")).toMatchObject({ empty: true, differs: false });
    expect(row("spec:coating").cells.every((cell) => cell.text === null)).toBe(true);
  });
});

describe("B4/B5 — a tint is computed on normalised values", () => {
  it("does not tint a size written as DN100, 4 inch and 4\"", () => {
    expect(row("spec:size").differs).toBe(false);
  });

  it("does not tint a pressure class written as PN16 and as 232 psi", () => {
    expect(row("spec:pressure").differs).toBe(false);
  });

  it("tints the field that decides the purchase", () => {
    expect(row("spec:end").differs).toBe(true);
  });

  it("compares a closed vocabulary on the option chosen, and infers nothing", () => {
    // Two options the template offers are two things; the comparison does not decide they are one.
    expect(row("spec:body").differs).toBe(true);
    expect(sameValues(["Ductile iron"], ["ductile  iron"], true)).toBe(true);
    expect(sameValues(["Ductile iron GGG40"], ["Ductile iron"], true)).toBe(false);
  });

  it("holds a multi-valued field to every value on both sides", () => {
    expect(sameValues(["UL", "FM"], ["FM", "UL"], false)).toBe(true);
    expect(sameValues(["UL"], ["UL", "FM"], false)).toBe(false);
  });
});

describe("B6 — Not provided is not a value", () => {
  it("never makes a row differ: three EPDM and one blank match", () => {
    expect(row("spec:seat").differs).toBe(false);
    expect(row("spec:seat").cells[3]!.text).toBeNull();
  });

  it("still lets the filled cells differ around a blank", () => {
    expect(row("spec:cert").differs).toBe(true);
  });

  it("treats a blank as agreeing with anything, so it can never be the difference", () => {
    expect(sameValues([], ["EPDM"], false)).toBe(true);
  });
});

describe("the rows that may tint, and the ones that may not", () => {
  it("tints availability on the state, not on the count beside it", () => {
    expect(row("availability").differs).toBe(true);
    const matching = buildComparison(FIELDS, [PRODUCTS[0]!, PRODUCTS[2]!], LABELS);
    // In stock with 240 and in stock with no count are both in stock.
    expect(matching.rows.find((candidate) => candidate.key === "availability")!.differs).toBe(false);
  });

  it("never tints the seller rows (B11)", () => {
    expect(row("reply").differs).toBe(false);
    expect(row("completeness").differs).toBe(false);
  });

  it("counts completeness against the template, not the filled fields alone", () => {
    expect(row("completeness").cells.map((cell) => [cell.filled, cell.total])).toEqual([
      [6, 7],
      [6, 7],
      [6, 7],
      [4, 7],
    ]);
  });

  it("carries a stock count for in stock and a lead time otherwise", () => {
    const cells = row("availability").cells;
    expect(cells[0]).toMatchObject({ stockQty: 240, leadTimeDays: null, tone: "ok" });
    expect(cells[3]).toMatchObject({ stockQty: null, leadTimeDays: 14, tone: "info" });
  });
});

describe("the summary's number", () => {
  it("counts the product rows that differ — the four on the board's fixture", () => {
    // End connection, body material, certification, availability.
    expect(table.deciding).toBe(4);
  });
});

describe("Hide matching rows", () => {
  it("keeps the differing rows and the seller rows, and drops the rest", () => {
    expect(visibleRows(table, true).map((candidate) => candidate.key)).toEqual([
      "spec:end",
      "spec:body",
      "spec:cert",
      "availability",
      "reply",
      "completeness",
    ]);
  });

  it("changes nothing when off", () => {
    expect(visibleRows(table, false)).toBe(table.rows);
  });
});

describe("B12 — columns stay in the order chosen", () => {
  it("never reorders", () => {
    const reversed = buildComparison(FIELDS, [...PRODUCTS].reverse(), LABELS);
    expect(reversed.rows.find((candidate) => candidate.key === "availability")!.cells[0]!.tone).toBe("info");
  });
});
