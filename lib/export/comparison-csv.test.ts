import { describe, expect, it } from "vitest";
import { comparisonCsv, exportFilename } from "./comparison-csv";

/**
 * The one comparison exporter — boards `1n` and `10d` both hand it a sheet.
 */
describe("comparisonCsv", () => {
  const csv = comparisonCsv({
    caveat: "All amounts in AED, excluding VAT.",
    head: ["Supplier", "Valve", "Total"],
    rows: [
      ["Al Waha, Industrial", "7920.00", "14880.00"],
      ["=HYPERLINK(\"x\")", null, "0.00"],
    ],
    foot: [["Lowest per line", "Emirates Valve & Fitting Co."]],
  });
  const lines = csv.replace(/^﻿/, "").trimEnd().split("\r\n");

  it("opens with a byte-order mark, so a spreadsheet reads the names as UTF-8", () => {
    expect(csv.startsWith("﻿")).toBe(true);
  });

  it("states the basis on the first line, before any column head", () => {
    expect(lines[0]).toBe('"All amounts in AED, excluding VAT.",,');
    expect(lines[1]).toBe("Supplier,Valve,Total");
  });

  it("pads every row to the head's width and writes a gap as empty, never as a value", () => {
    expect(lines[3]).toBe(`"'=HYPERLINK(""x"")",,0.00`);
  });

  it("quotes a field with a comma, and guards one that would run as a formula", () => {
    expect(lines[2]).toBe('"Al Waha, Industrial",7920.00,14880.00');
    expect(lines[3]!.startsWith('"\'=HYPERLINK')).toBe(true);
  });

  it("puts the summary rows after a blank line", () => {
    expect(lines[4]).toBe(",,");
    expect(lines[5]).toBe("Lowest per line,Emirates Valve & Fitting Co.,");
  });
});

describe("exportFilename", () => {
  it("keeps letters, digits and dashes only", () => {
    expect(exportFilename("ENQ-8864", "quotes")).toBe("ENQ-8864-quotes.csv");
    expect(exportFilename("Valves & fittings", "comparison")).toBe("Valves-fittings-comparison.csv");
    expect(exportFilename("", "")).toBe("comparison.csv");
  });
});
