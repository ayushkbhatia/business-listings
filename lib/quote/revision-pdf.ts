import { A4, MARGIN, renderPdfPages, wrap, type PdfFont, type PdfOp } from "@/lib/billing/pdf";
import { formatAED, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { filsToAed } from "@/lib/quote/money";
import type { NegotiationQuote, RevisionComparison } from "@/lib/messaging/negotiation";
import { validityWords } from "@/lib/messaging/negotiation-words";

/**
 * Board `10h` — one revision as the document the thread's card opens.
 *
 * *"r1 is still there above it as an attachment, so the record holds both."* The
 * figures come from `compareRevision`, the value the thread's table renders, so
 * the file and the screen cannot disagree about a total (`7c` `B7`, the same rule
 * on the accepted record). Rendered on request and never stored: a sent revision
 * is never edited, so regenerating reproduces it exactly.
 *
 * Every line the total sums, and the requirement lines the revision leaves
 * unpriced beneath them, grey and totalling nothing — the table rule `B3` holds
 * on paper as well.
 *
 * Pure: a test renders a revision to bytes and reads them.
 */

const COL = {
  line: MARGIN.x + 8,
  lineWidth: 262,
  qty: 350,
  unit: 440,
  total: A4.width - MARGIN.x - 8,
} as const;

const MUTED = 0.42;
const RULE = 0.82;
const CONTENT_BOTTOM = A4.height - MARGIN.bottom - 64;

export interface RevisionPdfInput {
  supplierName: string;
  enquiryRef: string;
  quote: NegotiationQuote;
  comparison: RevisionComparison;
  now: Date;
}

export function revisionPdf(input: RevisionPdfInput): { bytes: Buffer; pages: number; filename: string } {
  const { quote, comparison, now } = input;
  const pages: PdfOp[][] = [];
  let ops: PdfOp[] = [];
  let y = MARGIN.top;

  const text = (
    value: string,
    x: number,
    size: number,
    font: PdfFont,
    options: { grey?: number; align?: "left" | "right"; at?: number } = {},
  ) => {
    ops.push({
      kind: "text",
      x,
      y: options.at ?? y,
      text: value,
      size,
      font,
      ...(options.grey === undefined ? {} : { grey: options.grey }),
      ...(options.align === undefined ? {} : { align: options.align }),
    });
  };
  const rule = (at: number, grey = RULE) =>
    ops.push({ kind: "line", x1: MARGIN.x, y1: at, x2: A4.width - MARGIN.x, y2: at, grey });
  const newPage = () => {
    pages.push(ops);
    ops = [];
    y = MARGIN.top;
  };
  const tableHead = () => {
    ops.push({ kind: "rect", x: MARGIN.x, y, w: A4.width - MARGIN.x * 2, h: 22, fill: 0.96 });
    const at = y + 14;
    text(t("negotiation.col.line").toUpperCase(), COL.line, 7, "bold", { grey: MUTED, at });
    text(t("accepted.col.qty").toUpperCase(), COL.qty, 7, "bold", { grey: MUTED, align: "right", at });
    text(t("negotiation.col.unit").toUpperCase(), COL.unit, 7, "bold", { grey: MUTED, align: "right", at });
    text(t("negotiation.col.line_total").toUpperCase(), COL.total, 7, "bold", { grey: MUTED, align: "right", at });
    y += 22;
  };
  const money = (fils: bigint) => formatAED(filsToAed(fils), { style: "quote" });

  /* ── Head ────────────────────────────────────────────────────────────────── */
  text(t("site.name"), MARGIN.x, 15, "bold");
  text(t("negotiation.pdf.kind", { revision: quote.revision }).toUpperCase(), A4.width - MARGIN.x, 8, "bold", {
    align: "right",
    grey: MUTED,
  });
  y += 16;
  text(quote.ref, A4.width - MARGIN.x, 10.5, "mono", { align: "right" });
  y += 22;
  text(input.supplierName, MARGIN.x, 13, "bold");
  y += 14;
  const summary = [
    quote.sentAt ? t("negotiation.pdf.sent", { when: formatDate(quote.sentAt) }) : null,
    t("accepted.summary.enquiry", { ref: input.enquiryRef }),
    validityWords(quote, now).label,
  ]
    .filter(Boolean)
    .join("  ·  ");
  wrap(summary, A4.width - MARGIN.x * 2, 9, "regular").forEach((part, index) => {
    if (index > 0) y += 11;
    text(part, MARGIN.x, 9, "regular", { grey: MUTED });
  });
  y += 16;
  rule(y);
  y += 18;

  /* ── Lines ───────────────────────────────────────────────────────────────── */
  tableHead();
  const row = (description: string, qty: string, unit: string, total: string, grey?: number) => {
    const described = wrap(description, COL.lineWidth, 9, "regular");
    const height = 15 + (described.length - 1) * 11 + 10;
    if (y + height > CONTENT_BOTTOM) {
      newPage();
      tableHead();
    }
    y += 15;
    const top = y;
    const tone = grey === undefined ? {} : { grey };
    described.forEach((part, index) => text(part, COL.line, 9, "regular", { ...tone, at: top + index * 11 }));
    y = top + (described.length - 1) * 11;
    text(qty, COL.qty, 9, "regular", { ...tone, align: "right", at: top });
    text(unit, COL.unit, 9, "mono", { ...tone, align: "right", at: top });
    text(total, COL.total, 9, "mono", { ...tone, align: "right", at: top });
    y += 10;
    rule(y, 0.9);
  };

  for (const line of comparison.lines) {
    row(
      line.description,
      line.qty === null ? t("accepted.line.whole") : String(line.qty),
      money(line.unitFils),
      money(line.lineFils),
    );
  }
  for (const line of comparison.notQuoted) {
    row(line.description, line.qty === null ? "" : String(line.qty), t("negotiation.not_quoted"), "", MUTED);
  }

  if (y + 60 > CONTENT_BOTTOM) newPage();
  y += 20;
  ops.push({ kind: "rect", x: MARGIN.x, y: y - 13, w: A4.width - MARGIN.x * 2, h: 22, fill: 0.96 });
  text(t("negotiation.total"), COL.line, 9.5, "bold");
  text(money(comparison.totalFils), COL.total, 10.5, "mono", { align: "right" });
  y += 22;

  if (quote.note) {
    y += 8;
    text(t("accepted.pdf.note").toUpperCase(), MARGIN.x, 7, "bold", { grey: MUTED });
    for (const part of wrap(quote.note, A4.width - MARGIN.x * 2, 9, "regular")) {
      y += 12;
      if (y > CONTENT_BOTTOM) newPage();
      text(part, MARGIN.x, 9, "regular");
    }
    y += 8;
  }

  /* ── What this document is ───────────────────────────────────────────────── */
  const stance = wrap(t("negotiation.pdf.stance", { supplier: input.supplierName }), A4.width - MARGIN.x * 2, 8, "regular");
  if (y + 18 + stance.length * 11 > CONTENT_BOTTOM) newPage();
  y += 18;
  for (const part of stance) {
    text(part, MARGIN.x, 8, "regular", { grey: MUTED });
    y += 11;
  }

  pages.push(ops);

  const footY = A4.height - MARGIN.bottom;
  const foot = `${quote.ref}  ·  ${input.supplierName.toUpperCase()}`;
  pages.forEach((page, index) => {
    page.push({ kind: "line", x1: MARGIN.x, y1: footY - 12, x2: A4.width - MARGIN.x, y2: footY - 12, grey: 0.85 });
    page.push({ kind: "text", x: MARGIN.x, y: footY, text: foot, size: 7, font: "mono", grey: MUTED });
    page.push({
      kind: "text",
      x: A4.width - MARGIN.x,
      y: footY,
      text: t("accepted.pdf.page", { page: index + 1, pages: pages.length }).toUpperCase(),
      size: 7,
      font: "mono",
      grey: MUTED,
      align: "right",
    });
  });

  return { bytes: renderPdfPages(pages), pages: pages.length, filename: `${quote.ref}.pdf` };
}
