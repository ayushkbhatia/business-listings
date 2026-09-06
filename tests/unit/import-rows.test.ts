import { describe, expect, it } from "vitest";
import { FilenameIndex } from "@/lib/import/filenames";
import {
  analyseRows,
  assertSums,
  listableCount,
  readAvailability,
  type RowContext,
} from "@/lib/import/rows";
import type { ColumnPlan } from "@/lib/import/columns";

/**
 * Board 11d's row rules — the three the board itself got wrong.
 *
 *   · the template is per row, and a row naming no subcategory errors rather
 *     than importing into a default one;
 *   · an existing reference updates rather than duplicating;
 *   · new + updated + errors equals the row count, asserted.
 */

const VALVE_FIELDS = new Map([
  ["nominal_size", "field-valve-size"],
  ["body_material", "field-valve-body"],
]);
const PUMP_FIELDS = new Map([
  ["nominal_size", "field-pump-size"],
  ["flow_rate", "field-pump-flow"],
]);

function context(over: Partial<RowContext> = {}): RowContext {
  return {
    categoryByKey: new Map([
      ["butterflyvalves", "cat-valve"],
      ["centrifugalpumps", "cat-pump"],
    ]),
    fieldIdsByCategory: new Map([
      ["cat-valve", VALVE_FIELDS],
      ["cat-pump", PUMP_FIELDS],
    ]),
    productBySku: new Map(),
    takenSlugs: new Set(),
    photos: new FilenameIndex([]),
    keyById: new Map(),
    fallbackCategoryId: "cat-valve",
    ...over,
  };
}

const plan = (columns: { header: string; kind: string; key?: string }[]): ColumnPlan => ({
  columns: columns.map((column) => ({
    header: column.header,
    target: column.key
      ? { kind: "spec" as const, specFieldKey: column.key }
      : { kind: column.kind as never },
  })),
});

describe("the template is resolved per row", () => {
  const headers = ["Item Description", "Category", "Size"];
  const columnPlan = plan([
    { header: "Item Description", kind: "name" },
    { header: "Category", kind: "subcategory" },
    { header: "Size", kind: "spec", key: "nominal_size" },
  ]);

  it("writes one column into two different field ids, per row", () => {
    // The board's `Template: Valves v3` chip over a file spanning three
    // subcategories. `nominal_size` is a different SpecField row in each
    // template, and `specValues` is keyed by id — so one column has to become
    // two ids or two thirds of the file loses its size.
    const analysis = analyseRows(
      headers,
      [
        ["Butterfly valve DN100", "Butterfly valves", "DN100"],
        ["End suction pump", "Centrifugal pumps", "DN80"],
      ],
      columnPlan,
      context(),
    );

    expect(analysis.created).toBe(2);
    const [valve, pump] = analysis.verdicts;
    expect(valve).toMatchObject({ kind: "create", categoryId: "cat-valve" });
    expect(pump).toMatchObject({ kind: "create", categoryId: "cat-pump" });
    if (valve?.kind !== "create" || pump?.kind !== "create") throw new Error("unreachable");
    expect(valve.specValues).toEqual({ "field-valve-size": "DN100" });
    expect(pump.specValues).toEqual({ "field-pump-size": "DN80" });
  });

  it("errors a row whose category matches nothing, rather than defaulting it", () => {
    // §"One template badge": a default-template import files the row against
    // the wrong sheet and drops every value that sheet has no field for.
    const analysis = analyseRows(
      headers,
      [["Ball valve", "Hydraulic hoses", "DN50"]],
      columnPlan,
      context(),
    );
    expect(analysis.created).toBe(0);
    expect(analysis.errors).toBe(1);
    expect(analysis.verdicts[0]).toMatchObject({
      kind: "error",
      error: { reason: "unknown_category", value: "Hydraulic hoses" },
    });
    expect(analysis.unknownCategories).toEqual(["Hydraulic hoses"]);
  });

  it("drops a value the row's own template has no field for, without erroring", () => {
    const analysis = analyseRows(
      ["Item Description", "Category", "Flow"],
      [["Butterfly valve", "Butterfly valves", "40 m3/h"]],
      plan([
        { header: "Item Description", kind: "name" },
        { header: "Category", kind: "subcategory" },
        { header: "Flow", kind: "spec", key: "flow_rate" },
      ]),
      context(),
    );
    // `flow_rate` is a pump field. The valve row is not an error; the column
    // simply does not apply to it.
    expect(analysis.created).toBe(1);
    expect(analysis.verdicts[0]).toMatchObject({ kind: "create", specValues: {} });
  });
});

describe("an existing reference updates", () => {
  const headers = ["Part No", "Item Description", "Qty on hand"];
  const columnPlan = plan([
    { header: "Part No", kind: "sku" },
    { header: "Item Description", kind: "name" },
    { header: "Qty on hand", kind: "stock_qty" },
  ]);

  it("updates rather than duplicating, and keeps the product's own URL", () => {
    const analysis = analyseRows(
      headers,
      [["AW-BF-100", "Butterfly valve DN100", "42"]],
      columnPlan,
      context({
        productBySku: new Map([["aw-bf-100", { id: "p1", slug: "butterfly-valve-dn100" }]]),
        takenSlugs: new Set(["butterfly-valve-dn100"]),
      }),
    );
    expect(analysis.updated).toBe(1);
    expect(analysis.created).toBe(0);
    expect(analysis.verdicts[0]).toMatchObject({
      kind: "update",
      productId: "p1",
      // Its URL is published. An import renames the product, never moves it.
      fields: { slug: "butterfly-valve-dn100", stockQty: 42 },
    });
  });

  it("matches a reference whatever case the file wrote it in", () => {
    const analysis = analyseRows(
      headers,
      [["aw-bf-100 ", "Butterfly valve", "1"]],
      columnPlan,
      context({ productBySku: new Map([["aw-bf-100", { id: "p1", slug: "s" }]]) }),
    );
    expect(analysis.updated).toBe(1);
  });

  it("errors a duplicate name with no reference to match on, rather than making a second copy", () => {
    const analysis = analyseRows(
      ["Item Description"],
      [["Butterfly valve DN100"]],
      plan([{ header: "Item Description", kind: "name" }]),
      context({ takenSlugs: new Set(["butterfly-valve-dn100"]) }),
    );
    expect(analysis.errors).toBe(1);
    expect(analysis.verdicts[0]).toMatchObject({
      kind: "error",
      error: { reason: "duplicate_name" },
    });
  });
});

describe("photographs are references", () => {
  it("gives forty rows the same file id rather than forty copies", () => {
    const photos = new FilenameIndex([
      { id: "media:m1", filename: "bf-100.jpg", storagePath: "biz/gallery/bf-100-aaa111.jpg" },
    ]);
    const rows = Array.from({ length: 40 }, (_, i) => [`Valve ${i}`, "bf-100.jpg"]);
    const analysis = analyseRows(
      ["Item Description", "Photo File"],
      rows,
      plan([
        { header: "Item Description", kind: "name" },
        { header: "Photo File", kind: "photo" },
      ]),
      context({ photos }),
    );

    expect(analysis.created).toBe(40);
    expect(analysis.photosMatched).toBe(40);
    for (const verdict of analysis.verdicts) {
      expect(verdict).toMatchObject({ kind: "create", photos: { ids: ["media:m1"] } });
    }
  });

  it("imports a row whose filename resolves to nothing, without a photo", () => {
    // Criterion 8. The 7 of 412 that do not resolve are not failed rows.
    const analysis = analyseRows(
      ["Item Description", "Photo File"],
      [["Valve", "missing.jpg"]],
      plan([
        { header: "Item Description", kind: "name" },
        { header: "Photo File", kind: "photo" },
      ]),
      context(),
    );
    expect(analysis.created).toBe(1);
    expect(analysis.errors).toBe(0);
    expect(analysis.photosUnmatched).toBe(1);
    expect(analysis.verdicts[0]).toMatchObject({ photos: { ids: [], unmatched: ["missing.jpg"] } });
  });
});

describe("the sums", () => {
  it("adds up, and throws rather than rendering a total that does not", () => {
    const analysis = analyseRows(
      ["Item Description"],
      [["A"], [""], ["B"]],
      plan([{ header: "Item Description", kind: "name" }]),
      context(),
    );
    expect(analysis.created + analysis.updated + analysis.errors).toBe(analysis.rowCount);
    expect(() => assertSums({ ...analysis, created: analysis.created + 1 })).toThrow(
      /does not add up/,
    );
  });
});

describe("listableCount", () => {
  it("lists everything on an uncapped plan", () => {
    expect(listableCount(386, null)).toBe(386);
  });

  it("lists up to the cap and never refuses the rest", () => {
    // Criterion 10. The rows still import; this is only how many go live.
    expect(listableCount(412, 10)).toBe(10);
    expect(listableCount(412, 0)).toBe(0);
  });

  it("never returns more than were created", () => {
    expect(listableCount(3, 100)).toBe(3);
  });
});

describe("readAvailability", () => {
  it("reads what somebody's export actually says", () => {
    expect(readAvailability("Made to Order")).toBe("made_to_order");
    expect(readAvailability("MTO")).toBe("made_to_order");
    expect(readAvailability("Indent")).toBe("indent");
    expect(readAvailability("Out of stock")).toBe("out_of_stock");
    expect(readAvailability("In stock")).toBe("in_stock");
  });
});
