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
  /**
   * Rows past the ceiling that were not returned.
   *
   * Reported rather than swallowed. This used to be a silent `slice`: a seller
   * uploading six thousand products got five thousand and no indication which
   * thousand were missing, which is the worst way for an importer to fail
   * because it looks exactly like success.
   */
  truncated: number;
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

/**
 * The default ceiling, and it is the seller's.
 *
 * A catalogue is bounded by what one supplier stocks; a licence-authority
 * export is bounded by how many companies an emirate has licensed. Handoff 4's
 * importer passes its own, which is why this is a default rather than a
 * constant.
 */
export const MAX_ROWS = 5_000;

export class CsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvError";
  }
}

export interface ParseOptions {
  maxRows?: number;
  /**
   * Whether the first row names the columns.
   *
   * Board 11d §2: *"`first row used as headers` is a control, not a sentence."*
   * A stock file whose first row is a title — `AL WAHA TRADING — AUGUST 2026` in
   * A1 and the real headings in row 2 — is common enough that the assumption has
   * to be changeable, and changing it re-parses. Same defect corrected on `3f`
   * §5's `Newest first` and `3i` §3's `Sort`.
   *
   * When false, the columns are named `Column 1…Column N` and every row in the
   * file is data. The seller then maps by position, which is the only thing left
   * to map by.
   */
  headerRow?: boolean;
}

export function parseCsv(text: string, options: ParseOptions | number = {}): ParsedCsv {
  // Handoff 4's licence importer passes a bare row ceiling. Kept working rather
  // than changed at both ends: it has nothing to say about header rows.
  const settings: ParseOptions = typeof options === "number" ? { maxRows: options } : options;
  const maxRows = settings.maxRows ?? MAX_ROWS;
  const headerRow = settings.headerRow ?? true;
  const clean = text.startsWith(BOM) ? text.slice(BOM.length) : text;
  const records = toRecords(clean);

  if (records.length === 0) {
    throw new CsvError("That file has no rows in it. Export it again and upload the new file.");
  }

  const delimiter = detectDelimiter(records[0]!);
  const firstRow = splitLine(records[0]!, delimiter);

  /*
     With the header row switched off, the file has no names to offer, so the
     columns are numbered. `Column 3` is a worse label than `Part No` and it is
     an honest one — the alternative is presenting the first product in the file
     as though it were a set of headings, which is exactly the state this
     control exists to get out of.
  */
  const headers = headerRow ? firstRow : firstRow.map((_, i) => `Column ${i + 1}`);

  if (headerRow && headers.filter((h) => h !== "").length < 2) {
    throw new CsvError(
      "The first row does not look like column headings. The importer needs a header row " +
        "naming each column, then one row per product — or switch off \u201cFirst row " +
        "names the columns\u201d and map them by position.",
    );
  }

  const raggedRows: number[] = [];
  const rows: string[][] = [];

  const body = headerRow ? records.slice(1) : records;
  const truncated = Math.max(0, body.length - maxRows);

  for (const record of body.slice(0, maxRows)) {
    const cells = splitLine(record, delimiter);
    if (cells.length !== headers.length) {
      // 1-based. Row 1 is the header when there is one, and data when there is not.
      raggedRows.push(rows.length + (headerRow ? 2 : 1));
      // Padded or trimmed, never dropped. Refusing a 400-row catalogue because
      // row 173 has a trailing comma is how a seller decides this does not work.
      while (cells.length < headers.length) cells.push("");
      cells.length = headers.length;
    }
    rows.push(cells);
  }

  return { headers, rows, raggedRows, truncated };
}

/** Every value in one column, for guessing what the column is. */
export function columnValues(parsed: ParsedCsv, index: number): string[] {
  return parsed.rows.map((row) => row[index] ?? "");
}

/**
 * One cell, escaped.
 *
 * The writer lives beside the reader on purpose. The export and the import are
 * one schema — board `3f` Q3's answer — and a round trip whose two halves
 * disagree about what a quote means inside a field is a round trip that loses a
 * product description on the way home.
 *
 * A leading `=`, `+`, `-` or `@` is prefixed with an apostrophe. Excel reads
 * those as the start of a formula, and a part number like `-40C-SEAL` becomes a
 * broken cell in the seller's own file. Not a security measure — the file goes
 * to the person who asked for it — but a correctness one.
 */
export function csvField(value: string): string {
  const risky = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(risky) ? `"${risky.replace(/"/g, '""')}"` : risky;
}

/** A whole file. CRLF, because the readers this writes for are Excel's. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(csvField).join(",")).join("\r\n");
}
