import { describe, expect, it } from "vitest";
import {
  CORE_COLUMNS,
  DOC_COLUMNS,
  PHOTO_COLUMNS,
  REFERENCE_COLUMNS,
  exportHeaders,
  looksLikeExport,
  roundTripPlan,
  roundTripTargetFor,
  specColumn,
  specKeyOf,
} from "@/lib/import/round-trip";

/**
 * Board `3f` Q3's answer, as a test rather than a promise: whatever `Export ▾`
 * writes, the mapper reads back.
 *
 * The reason this is testable at all is that both halves take their column
 * names from one module. A round trip agreed by hand between two files drifts
 * on the first field anybody adds, and drifts silently — the file still
 * imports, one column short.
 */

describe("the header row", () => {
  it("round-trips every column it writes", () => {
    // The assertion that matters: read the file's own headers back and every
    // one lands somewhere deliberate.
    const headers = exportHeaders(["nominal_size", "body_material"]);
    for (const header of headers) {
      expect(roundTripTargetFor(header), header).not.toBeNull();
    }
  });

  it("puts the reference columns beyond reach of an import", () => {
    // §5: exported for reference, ignored on import. They are derived metrics
    // and a derived metric has no writable path.
    for (const column of REFERENCE_COLUMNS) {
      expect(roundTripTargetFor(column)).toEqual({ kind: "ignore" });
    }
  });

  it("carries no price column in either direction", () => {
    const headers = exportHeaders(["nominal_size"]);
    expect(headers.some((header) => /price|cost|rate|aed/i.test(header))).toBe(false);
  });

  it("carries no views column, because there is no per-product view count", () => {
    // §5 lists `views`. `StorefrontDailyStat` rolls views up per business per
    // day and nothing attributes one to a product, so the column would be a
    // measurement made of zeros.
    expect(exportHeaders([])).not.toContain("views");
  });

  it("writes the photo and document columns the library resolves", () => {
    const headers = exportHeaders([]);
    for (const column of [...PHOTO_COLUMNS, ...DOC_COLUMNS]) {
      expect(headers).toContain(column);
      expect(roundTripTargetFor(column)).toEqual({ kind: "photo" });
    }
  });
});

describe("spec columns", () => {
  it("names a field by key, which is what survives across templates", () => {
    expect(specColumn("nominal_size")).toBe("spec:nominal_size");
    expect(specKeyOf("spec:nominal_size")).toBe("nominal_size");
    expect(specKeyOf("Nominal size")).toBeNull();
    expect(specKeyOf("spec:")).toBeNull();
  });

  it("maps back to the same key it was written from", () => {
    expect(roundTripTargetFor(specColumn("body_material"))).toEqual({
      kind: "spec",
      specFieldKey: "body_material",
    });
  });
});

describe("looksLikeExport", () => {
  it("recognises our own file", () => {
    expect(looksLikeExport(exportHeaders(["nominal_size"]))).toBe(true);
  });

  it("still recognises one the seller trimmed", () => {
    // The most useful version of the round trip is the bulk edit: export, keep
    // three columns, fix four hundred rows, re-import. Demanding an exact
    // header row would refuse exactly that.
    expect(looksLikeExport(["sku", "name", "stock_qty"])).toBe(true);
    expect(looksLikeExport(["sku", "name", "spec:nominal_size"])).toBe(true);
  });

  it("does not claim a supplier's own stock file", () => {
    expect(looksLikeExport(["Part No", "Item Description", "Unit Price AED"])).toBe(false);
    // `sku` and `name` alone is any stock file in the world.
    expect(looksLikeExport(["sku", "name"])).toBe(false);
    expect(looksLikeExport(["sku", "subcategory"])).toBe(false);
  });
});

describe("roundTripPlan", () => {
  it("maps every one of ours and leaves the seller's own column alone", () => {
    const headers = [...exportHeaders(["nominal_size"]), "Warehouse bay"];
    const { plan, matched, unknown } = roundTripPlan(headers);
    expect(matched).toBe(headers.length - 1);
    expect(unknown).toEqual(["Warehouse bay"]);
    expect(plan.columns).toHaveLength(headers.length);
    expect(plan.columns.find((column) => column.header === "sku")?.target).toEqual({ kind: "sku" });
  });

  it("maps the core columns exactly once each", () => {
    const { plan } = roundTripPlan([...CORE_COLUMNS]);
    expect(plan.columns.filter((column) => column.target.kind === "name")).toHaveLength(1);
    expect(plan.columns.filter((column) => column.target.kind === "sku")).toHaveLength(1);
    expect(plan.columns.filter((column) => column.target.kind === "subcategory")).toHaveLength(1);
  });
});
