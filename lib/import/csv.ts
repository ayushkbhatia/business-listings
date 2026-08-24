/**
 * A CSV reader that survives a supplier's actual export.
 *
 * No dependency, because what arrives is narrower and weirder than a general
 * parser assumes. Files come out of Tally, Excel and a twenty-year-old ERP, and
 * the three things that break a naive `split(",")` are all present in every
 * batch: quoted fields containing commas, doubled quotes inside quoted fields,
 * and a UTF-8 byte-order mark on the first header.
 *
 * Deliberately tolerant. A ragged row is padded or trimmed rather than rejected:
 * refusing a 400-row catalogue because row 173 has a trailing comma is how a
 * seller decides the importer does not work.
 */

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  /** Rows whose column count did not match the header, and were adjusted. */
  raggedRows: number[];
}

const BOM = "﻿";

/**
 * Split on the delimiter that actually separates the header.
 *
 * A European or Gulf export set to a semicolon locale is common enough that
 * guessing wrong turns the whole file into one column, which reads to the
 * seller as "it did not work" rather than "it used the wrong separator".
 */
export function detectDelimiter(firstLine: string): "," | ";" | "\t" {
  const counts = {
    ",": (firstLine.match(/,/g) ?? []).length,
    ";": (firstLine.match(/;/g) ?? []).length,
    "\t": (firstLine.match(/\t/g) ?? []).length,
  };
  const best = (Object.entries(counts) as ["," | ";" | "\t", number][]).sort(
    (a, b) => b[1] - a[1],
  )[0];
  return best && best[1] > 0 ? best[0] : ",";
}

/** One pass, character by character, tracking whether we are inside quotes. */
function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!;

    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      out.push(field);
      field = "";
    } else {
      field += char;
    }
  }

  out.push(field);
  return out.map((f) => f.trim());
}

/**
 * Split into records, keeping quoted newlines together.
 *
 * A description field with a line break in it is a single record spanning two
 * physical lines, and splitting on `\n` first would turn it into two broken
 * products.
 */
function toRecords(text: string): string[] {
  const records: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        current += '""';
        i += 1;
        continue;
      }
      quoted = !quoted;
      current += char;
      continue;
    }
    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      records.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  if (current.trim() !== "") records.push(current);
  return records.filter((r) => r.trim() !== "");
}

export const MAX_ROWS = 5_000;

export class CsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvError";
  }
}

export function parseCsv(text: string): ParsedCsv {
  const clean = text.startsWith(BOM) ? text.slice(BOM.length) : text;
  const records = toRecords(clean);

  if (records.length === 0) {
    throw new CsvError("That file has no rows in it. Export it again and upload the new file.");
  }

  const delimiter = detectDelimiter(records[0]!);
  const headers = splitLine(records[0]!, delimiter);

  if (headers.filter((h) => h !== "").length < 2) {
    throw new CsvError(
      "The first row does not look like column headings. The importer needs a header row " +
        "naming each column, then one row per product.",
    );
  }

  const raggedRows: number[] = [];
  const rows: string[][] = [];

  for (const record of records.slice(1, MAX_ROWS + 1)) {
    const cells = splitLine(record, delimiter);
    if (cells.length !== headers.length) {
      raggedRows.push(rows.length + 2); // 1-based, and the header is row 1.
      // Padded or trimmed, never dropped. Refusing a 400-row catalogue because
      // row 173 has a trailing comma is how a seller decides this does not work.
      while (cells.length < headers.length) cells.push("");
      cells.length = headers.length;
    }
    rows.push(cells);
  }

  return { headers, rows, raggedRows };
}

/** Every value in one column, for guessing what the column is. */
export function columnValues(parsed: ParsedCsv, index: number): string[] {
  return parsed.rows.map((row) => row[index] ?? "");
}
