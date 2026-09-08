/**
 * A PDF writer, for the one document on this platform that is a legal record.
 *
 * Board 11g's new dependency: *"generated at issue at A4 portrait, stored,
 * served byte for byte. It is not a print stylesheet on this page."*
 *
 * ## Why this is hand-written rather than a library
 *
 * The stack has eleven runtime dependencies and no component library — the
 * primitives are ours. A PDF toolkit is two to six megabytes to render one
 * single-page document whose layout is fixed, and it would put the bytes a
 * seller files with their accountant behind somebody else's upgrade cadence.
 * What is actually needed is a fraction of PDF 1.4: one page, one font family,
 * text and lines. That is the file below.
 *
 * ## What it deliberately does not do
 *
 * No images, no embedded fonts, no transparency, no compression. The base
 * fourteen fonts are guaranteed present in every conforming reader, so Helvetica
 * needs no font programme in the file. Uncompressed content streams make the
 * output diffable, which matters for a document we promise to serve unchanged:
 * a byte comparison is how that promise gets checked.
 *
 * ## Determinism
 *
 * The same invoice produces the same bytes. No creation date, no producer
 * string, no object ids that depend on iteration order. That is what makes
 * "byte for byte" a testable claim rather than a hope — and it is why the file
 * carries no `/CreationDate`, which would otherwise change on every write.
 */

/** A4 portrait in PostScript points, which is the unit a PDF page box uses. */
export const A4 = { width: 595.28, height: 841.89 } as const;

/** 20 mm side margins and a 17 mm head, from the spec, converted to points. */
export const MARGIN = { x: 56.7, top: 48.2, bottom: 42.5 } as const;

export type PdfFont = "regular" | "bold" | "mono";

const FONT_RESOURCE: Record<PdfFont, string> = {
  regular: "F1",
  bold: "F2",
  mono: "F3",
};

/**
 * Widths of the base-fourteen fonts, in thousandths of an em.
 *
 * Only what is needed to right-align a column of money and to know when a line
 * of prose has to wrap. Helvetica's widths are a fixed table in the PDF
 * specification; Courier is monospaced at 600 throughout.
 *
 * Anything outside the table falls back to a lowercase-letter width, which is
 * close enough for wrapping and never used for alignment — every right-aligned
 * string on this document is digits, a space, a full stop or a comma.
 */
const HELVETICA_WIDTHS: Record<string, number> = {
  " ": 278, "!": 278, '"': 355, "#": 556, "$": 556, "%": 889, "&": 667, "'": 191,
  "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
  "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556,
  "8": 556, "9": 556, ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556,
  "@": 1015, A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722,
  I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
  S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611, "[": 278,
  "\\": 278, "]": 278, "^": 469, _: 556, "`": 333, a: 556, b: 556, c: 500,
  d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222,
  m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556,
  v: 500, w: 722, x: 500, y: 500, z: 500, "{": 334, "|": 260, "}": 334, "~": 584,
  // The typographic set, so a right-aligned column carrying an en dash or a
  // bullet lands where the layout expects it.
  "\u2013": 556, "\u2014": 1000, "\u2022": 350, "\u2026": 1000,
  "\u2018": 222, "\u2019": 222, "\u201c": 333, "\u201d": 333,
  "\u20ac": 556, "\u2122": 1000,
};

/** Bold is wider. The delta matters only where bold sits in a right-aligned column. */
const BOLD_EXTRA = 1.06;

/**
 * The typographic characters WinAnsi carries in its 0x80–0x9F block.
 *
 * Unicode puts these well above 255, so the naive rule — pass 32–126, octal
 * escape 160–255, replace the rest — turned every en dash into `?`. The invoice
 * is full of them: `14 Aug – 13 Sep 2026` on five lines, and `••••` before a
 * card's last four. Rendering the PDF is what showed it; the structural tests
 * could not.
 */
const WINANSI_HIGH: Record<string, number> = {
  "\u20ac": 0x80, "\u201a": 0x82, "\u0192": 0x83, "\u201e": 0x84, "\u2026": 0x85,
  "\u2020": 0x86, "\u2021": 0x87, "\u02c6": 0x88, "\u2030": 0x89, "\u0160": 0x8a,
  "\u2039": 0x8b, "\u0152": 0x8c, "\u017d": 0x8e, "\u2018": 0x91, "\u2019": 0x92,
  "\u201c": 0x93, "\u201d": 0x94, "\u2022": 0x95, "\u2013": 0x96, "\u2014": 0x97,
  "\u02dc": 0x98, "\u2122": 0x99, "\u0161": 0x9a, "\u203a": 0x9b, "\u0153": 0x9c,
  "\u017e": 0x9e, "\u0178": 0x9f,
};

/** Width of `text` at `size`, in points. */
export function textWidth(text: string, size: number, font: PdfFont): number {
  if (font === "mono") return text.length * 0.6 * size;
  const per = [...text].reduce((sum, ch) => sum + (HELVETICA_WIDTHS[ch] ?? 556), 0) / 1000;
  return per * size * (font === "bold" ? BOLD_EXTRA : 1);
}

/**
 * Escape a string for a PDF literal, and drop what WinAnsi cannot carry.
 *
 * Backslash, and both parens, end a literal early — a supplier called
 * `Al Waha (Trading)` would otherwise truncate the document at its own name.
 *
 * Characters above the WinAnsi range are replaced rather than encoded. Arabic
 * is spec Q2 and a bilingual invoice is a different A4 layout that cannot be
 * retrofitted into sheets already issued, so this refuses to half-render it: a
 * question mark is visibly wrong, where a silently dropped glyph is not.
 */
export function pdfString(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 63;
    if (ch === "\\" || ch === "(" || ch === ")") out += `\\${ch}`;
    else if (code >= 32 && code <= 126) out += ch;
    else if (code >= 160 && code <= 255) out += `\\${code.toString(8).padStart(3, "0")}`;
    else {
      // The 0x80–0x9F block, where WinAnsi keeps the dashes and quotes Unicode
      // puts in the two-thousands.
      const high = WINANSI_HIGH[ch];
      out += high === undefined ? "?" : `\\${high.toString(8).padStart(3, "0")}`;
    }
  }
  return out;
}

export interface TextOp {
  kind: "text";
  x: number;
  /** From the top of the page. Converted to PDF's bottom-up axis on write. */
  y: number;
  text: string;
  size: number;
  font: PdfFont;
  /** Greys are a single channel, 0 black to 1 white. */
  grey?: number;
  align?: "left" | "right";
}

export interface LineOp {
  kind: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  grey?: number;
  width?: number;
}

export interface RectOp {
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  /** Fill grey. Omit for an outline. */
  fill?: number;
  stroke?: number;
  /** Dashes, for the statutory placeholder box. */
  dashed?: boolean;
}

export type PdfOp = TextOp | LineOp | RectOp;

/** Two decimal places, and never exponential notation, which readers reject. */
function num(value: number): string {
  return value.toFixed(2);
}

/** One content stream, in the order the ops were given. */
function contentStream(ops: readonly PdfOp[]): string {
  const parts: string[] = [];
  let grey: number | null = null;

  const setGrey = (next: number, stroking: boolean) => {
    // Emitted per op rather than tracked across both colour spaces: a stroke
    // and a fill keep separate greys in PDF, and conflating them tints text.
    parts.push(`${num(next)} ${stroking ? "G" : "g"}`);
    grey = next;
  };

  for (const op of ops) {
    if (op.kind === "text") {
      const width = textWidth(op.text, op.size, op.font);
      const x = op.align === "right" ? op.x - width : op.x;
      setGrey(op.grey ?? 0, false);
      parts.push("BT");
      parts.push(`/${FONT_RESOURCE[op.font]} ${num(op.size)} Tf`);
      // PDF's origin is bottom-left; every y in this module is from the top.
      parts.push(`1 0 0 1 ${num(x)} ${num(A4.height - op.y)} Tm`);
      parts.push(`(${pdfString(op.text)}) Tj`);
      parts.push("ET");
      continue;
    }

    if (op.kind === "line") {
      setGrey(op.grey ?? 0.8, true);
      parts.push(`${num(op.width ?? 0.5)} w`);
      parts.push(`${num(op.x1)} ${num(A4.height - op.y1)} m`);
      parts.push(`${num(op.x2)} ${num(A4.height - op.y2)} l`);
      parts.push("S");
      continue;
    }

    if (op.dashed) parts.push("[3 2] 0 d");
    if (op.fill !== undefined) {
      setGrey(op.fill, false);
      parts.push(`${num(op.x)} ${num(A4.height - op.y - op.h)} ${num(op.w)} ${num(op.h)} re f`);
    }
    if (op.stroke !== undefined) {
      setGrey(op.stroke, true);
      parts.push("0.5 w");
      parts.push(`${num(op.x)} ${num(A4.height - op.y - op.h)} ${num(op.w)} ${num(op.h)} re S`);
    }
    if (op.dashed) parts.push("[] 0 d");
  }

  void grey;
  return parts.join("\n");
}

/**
 * One A4 page of ops, as PDF bytes.
 *
 * Seven objects, written in order with a cross-reference table computed from the
 * actual byte offsets — a reader uses that table to find objects, and an offset
 * that is one byte out makes the file unopenable in some readers and fine in
 * others, which is the worst kind of wrong.
 *
 * `latin1` throughout. A content stream is bytes, not text: encoding it as UTF-8
 * would silently widen every octal escape above 127 and shift every offset in
 * the table after it.
 */
export function renderPdf(ops: readonly PdfOp[]): Buffer {
  const stream = contentStream(ops);

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(A4.width)} ${num(A4.height)}] ` +
      "/Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>",
  ];

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefAt = Buffer.byteLength(body, "latin1");
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }

  /*
     No `/CreationDate` and no `/Producer`.

     Both are conventional and both would make the same invoice produce different
     bytes on every write, which would quietly retire the one guarantee this
     module exists to make. The issue date is on the page, where a reader can
     see it.
  */
  const trailer =
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;

  return Buffer.from(body + xref + trailer, "latin1");
}

/**
 * Break `text` to fit `maxWidth`, on spaces.
 *
 * A word longer than the column is left to overhang rather than being cut: a
 * truncated company name on a tax document is worse than an ugly one, and the
 * only strings this wraps are descriptions and the footnote.
 */
export function wrap(text: string, maxWidth: number, size: number, font: PdfFont): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && textWidth(candidate, size, font) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}
