import { describe, expect, it } from "vitest";
import { CsvError, columnValues, csvField, detectDelimiter, parseCsv, toCsv } from "@/lib/import/csv";

describe("what a supplier's export actually looks like", () => {
  it("keeps a comma inside a quoted field", () => {
    const { rows } = parseCsv('Item,Notes\n"Valve, gate, DN150",Standard\n');
    expect(rows[0]).toEqual(["Valve, gate, DN150", "Standard"]);
  });

  it("reads a doubled quote as one literal quote", () => {
    const { rows } = parseCsv('Item,Size\nNipple,"2"" BSP"\n');
    expect(rows[0]).toEqual(["Nipple", '2" BSP']);
  });

  it("strips a byte-order mark from the first header", () => {
    // Excel writes one, and without this the first column is named "﻿Item"
    // and matches nothing.
    const { headers } = parseCsv('﻿Item,SKU\nValve,V1\n');
    expect(headers[0]).toBe("Item");
  });

  it("handles a semicolon export without turning the file into one column", () => {
    const { headers, rows } = parseCsv("Item;SKU;Qty\nValve;V1;12\n");
    expect(headers).toEqual(["Item", "SKU", "Qty"]);
    expect(rows[0]).toEqual(["Valve", "V1", "12"]);
  });

  it("handles a tab export", () => {
    expect(detectDelimiter("Item\tSKU\tQty")).toBe("\t");
  });

  it("keeps a quoted line break inside one record", () => {
    // Otherwise a description with a line break becomes two broken products.
    const { rows } = parseCsv('Item,Notes\nValve,"Line one\nLine two"\n');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[1]).toBe("Line one\nLine two");
  });

  it("survives CRLF", () => {
    const { rows } = parseCsv("Item,SKU\r\nValve,V1\r\nFlange,F2\r\n");
    expect(rows).toHaveLength(2);
  });

  it("pads a short row rather than rejecting the file", () => {
    // Refusing a 400-row catalogue because row 173 has a trailing comma is how
    // a seller decides the importer does not work.
    const { rows, raggedRows } = parseCsv("Item,SKU,Qty\nValve,V1,12\nFlange,F2\n");
    expect(rows[1]).toEqual(["Flange", "F2", ""]);
    expect(raggedRows).toEqual([3]);
  });

  it("trims an over-long row to the header width", () => {
    const { rows, raggedRows } = parseCsv("Item,SKU\nValve,V1,extra\n");
    expect(rows[0]).toEqual(["Valve", "V1"]);
    expect(raggedRows).toEqual([2]);
  });

  it("skips blank lines between records", () => {
    const { rows } = parseCsv("Item,SKU\nValve,V1\n\n\nFlange,F2\n");
    expect(rows).toHaveLength(2);
  });

  it("says what is wrong with an empty file, and what correct looks like", () => {
    expect(() => parseCsv("")).toThrow(CsvError);
    expect(() => parseCsv("")).toThrow(/no rows/);
  });

  it("says what is wrong with a file that has no header row", () => {
    expect(() => parseCsv("just one column\nvalue\n")).toThrow(/column headings/);
  });

  it("reads a whole column for guessing what it is", () => {
    const parsed = parseCsv("Item,Price\nValve,120.00\nFlange,45.00\n");
    expect(columnValues(parsed, 1)).toEqual(["120.00", "45.00"]);
  });
});

/* ── Board 11d ────────────────────────────────────────────────────────────── */

describe("the header row is a control, not an assumption", () => {
  it("names the columns by position when the first row is data", () => {
    /*
       Criterion 9. A stock file with `AL WAHA TRADING — AUGUST 2026` in A1 and
       the real headings in row 2 is common enough that the assumption has to be
       changeable — and switching it off must re-read the file rather than
       relabelling what was already parsed.
    */
    const parsed = parseCsv("Valve,42\nFlange,17\n", { headerRow: false });
    expect(parsed.headers).toEqual(["Column 1", "Column 2"]);
    expect(parsed.rows).toEqual([
      ["Valve", "42"],
      ["Flange", "17"],
    ]);
  });

  it("keeps the first row as headings by default", () => {
    const parsed = parseCsv("Item,Qty\nValve,42\n");
    expect(parsed.headers).toEqual(["Item", "Qty"]);
    expect(parsed.rows).toEqual([["Valve", "42"]]);
  });

  it("accepts a one-column file once the header row is off", () => {
    // With headings assumed, this file is refused for not looking like one.
    // Without them it is a perfectly good single-column list.
    expect(() => parseCsv("just one column\nvalue\n")).toThrow(/column headings/);
    expect(parseCsv("just one column\nvalue\n", { headerRow: false }).rows).toHaveLength(2);
  });

  it("still takes a bare row ceiling, which handoff 4's importer passes", () => {
    const parsed = parseCsv("Item,Qty\nA,1\nB,2\nC,3\n", 2);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.truncated).toBe(1);
  });

  it("numbers a ragged row from the top of the file when there is no header", () => {
    const parsed = parseCsv("A,1\nB\n", { headerRow: false });
    expect(parsed.raggedRows).toEqual([2]);
  });
});

describe("writing a file the reader can read back", () => {
  it("escapes what would otherwise break the round trip", () => {
    expect(csvField('Valve, 4"')).toBe('"Valve, 4"""');
    expect(csvField("plain")).toBe("plain");
    expect(csvField("line\nbreak")).toBe('"line\nbreak"');
  });

  it("defuses a cell Excel would read as a formula", () => {
    // A part number like `-40C-SEAL` becomes a broken cell in the seller's own
    // file otherwise. Not a security measure — a correctness one.
    expect(csvField("-40C-SEAL")).toBe("'-40C-SEAL");
    expect(csvField("=SUM(A1)")).toBe("'=SUM(A1)");
  });

  it("survives its own round trip", () => {
    const rows = [
      ["sku", "name"],
      ["AW-BF-100", 'Butterfly valve, 4" wafer'],
      ["AW-BF-150", "Line\nbreak"],
    ];
    const parsed = parseCsv(toCsv(rows));
    expect(parsed.headers).toEqual(["sku", "name"]);
    expect(parsed.rows).toEqual(rows.slice(1));
  });
});
