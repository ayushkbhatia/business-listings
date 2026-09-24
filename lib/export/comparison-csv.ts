import { toCsv } from "@/lib/import/csv";

/**
 * A comparison, as a file a buyer can keep — boards `1n` and `10d`.
 *
 * Both boards drew an export and neither defined it (`1n` flag 5, `10d` flag 4):
 * *Export comparison* on the quotes, *Export as PDF* on the products. Two
 * undefined buttons are one missing feature, so there is one writer and both
 * boards hand it a sheet.
 *
 * ## What a sheet is
 *
 * The table as the screen draws it — one head row, one row per subject — with
 * the **basis on the first line**, before any reader reaches a column head. A
 * spreadsheet outlives the screen it came from, and a figure with its
 * qualification removed is a different claim (`3k` §9's rule for the pipeline
 * export, and the same reason here: *all amounts in AED, excluding VAT*).
 *
 * Amounts go out bare — `7920.00` — so a spreadsheet can add them. Every text
 * field passes the shared writer's formula guard, which matters most here: a
 * requirement line and a supplier's name are both text somebody else typed.
 */
export interface ComparisonSheet {
  /** The file's first line: what the figures are, and what they are not. */
  caveat: string;
  head: readonly string[];
  rows: readonly (readonly (string | number | null)[])[];
  /** Summary rows after a blank line — the lowest per line, for `1n`. */
  foot?: readonly (readonly (string | number | null)[])[];
}

/** Excel reads a bare UTF-8 file as Windows-1252 and mangles every non-ASCII name. */
const BOM = "\uFEFF";

export function comparisonCsv(sheet: ComparisonSheet): string {
  const cell = (value: string | number | null) => (value === null ? "" : String(value));
  const width = sheet.head.length;
  const pad = (row: readonly (string | number | null)[]) =>
    Array.from({ length: Math.max(width, row.length) }, (_, index) => cell(row[index] ?? null));
  const lines: string[][] = [
    pad([sheet.caveat]),
    [...sheet.head],
    ...sheet.rows.map(pad),
    ...(sheet.foot && sheet.foot.length > 0 ? [pad([]), ...sheet.foot.map(pad)] : []),
  ];
  return `${BOM}${toCsv(lines)}\r\n`;
}

/** A file name from a reference: letters, digits and dashes only. */
export function exportFilename(ref: string, what: string): string {
  const safe = `${ref}-${what}`.replace(/[^A-Za-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return `${safe || "comparison"}.csv`;
}
