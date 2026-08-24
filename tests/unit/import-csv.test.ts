import { describe, expect, it } from "vitest";
import { columnValues, CsvError, detectDelimiter, parseCsv } from "@/lib/import/csv";

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
