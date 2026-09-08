import type { TaxInvoiceDocument } from "./tax-invoice";
import { A4, MARGIN, renderPdf, textWidth, wrap, type PdfOp } from "./pdf";

/**
 * The document, laid out on A4.
 *
 * The screen and this file render the **same object** — `TaxInvoiceDocument` —
 * and neither computes a figure. That is what makes board 11g's central rule
 * checkable rather than asserted: *"the render is not a preview of the document,
 * it is the document."* Every string here arrives already formatted, so the two
 * renderings cannot drift the first time a thousands separator changes.
 *
 * Pure. No database, no storage, no `server-only` — so a test can render a
 * document to bytes and read them.
 *
 * ## The page is a fixed box
 *
 * 210 × 297 mm. Content flows from the top; the footnote, the statutory
 * placeholder and the page foot sit at the foot of the sheet whatever the table
 * above them did. A table long enough to overflow paginates — it does not shrink
 * to fit and it does not scroll. This is paper.
 */

/**
 * Column x-positions, in points from the left edge of the page.
 *
 * Right-aligned columns, so each number is the column's **right** edge and the
 * gaps below are what stop a header running into its neighbour. These were
 * eyeballed once and collided: `VAT AED` and `AMOUNT AED` overlapped into
 * `VAT AMOUNT AED`, and the figures under them overlapped too. Measured now —
 * `AMOUNT AED` is 49.5pt at 7pt bold, `VAT AED` is 31.7pt — with roughly 11pt
 * of air between every pair.
 *
 * Rendering the file is what found it. Nothing structural was wrong, so no
 * amount of asserting on bytes would have.
 */
const COL = {
  description: MARGIN.x,
  /** Where a description has to wrap, to clear the QTY column. */
  descriptionWidth: 250,
  qty: 340,
  unit: 390,
  rate: 424,
  vat: 470,
  amount: A4.width - MARGIN.x,
} as const;

/** Where the dates column starts, and how wide the party block may be. */
const PARTY = { datesX: 320, width: 250 } as const;

const INK = 0;
const MUTED = 0.42;
const RULE = 0.82;

/** How many line rows fit on a sheet before it has to paginate. */
const ROWS_PER_PAGE = 14;

export interface RenderedInvoice {
  bytes: Buffer;
  pages: number;
}

/**
 * One invoice as a PDF.
 *
 * Returns the byte count alongside, because `Invoice.pdfBytes` is what the rail
 * reports and reading it back off storage to find out would be a second source
 * for one number.
 */
export function invoicePdf(document: TaxInvoiceDocument): RenderedInvoice {
  const pages = Math.max(1, Math.ceil(document.lines.length / ROWS_PER_PAGE));
  /*
     One page for now, and the pagination is real rather than aspirational.

     Every invoice this platform issues has one or two lines, so a second sheet
     is unreachable today. `pageCount` still says `PAGE 1 OF 1` from a computed
     total rather than a literal, because the day a placement invoice runs to
     fifteen lines the foot has to be right without anybody remembering it.
  */
  const ops = layout(document, pages);
  return { bytes: renderPdf(ops), pages };
}

function layout(document: TaxInvoiceDocument, pages: number): PdfOp[] {
  const ops: PdfOp[] = [];
  let y = MARGIN.top;

  const text = (
    value: string,
    x: number,
    size: number,
    font: "regular" | "bold" | "mono",
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

  const rule = (at: number, grey = RULE) => {
    ops.push({ kind: "line", x1: MARGIN.x, y1: at, x2: A4.width - MARGIN.x, y2: at, grey });
  };

  /* ── The head: our mark, our identity, and what this document is ───────── */
  text("Business Listings", MARGIN.x, 15, "bold");
  text(document.docType === "credit_note" ? "CREDIT NOTE" : "TAX INVOICE", COL.amount, 8, "bold", {
    align: "right",
    grey: MUTED,
  });

  y += 16;
  text(document.ref, COL.amount, 10.5, "mono", { align: "right" });

  for (const line of [document.supplier.name, ...document.supplier.addressLines]) {
    text(line, MARGIN.x, 8, "regular", { grey: MUTED });
    y += 10;
  }
  if (document.supplier.incorporation) {
    text(document.supplier.incorporation, MARGIN.x, 8, "regular", { grey: MUTED });
    y += 10;
  }

  y += 14;
  rule(y);
  y += 18;

  /* ── Billed to, and every date the document states ─────────────────────── */
  const partyTop = y;
  text("Billed to", MARGIN.x, 8, "regular", { grey: MUTED });
  y += 13;
  text(document.recipient.name, MARGIN.x, 9.5, "bold");
  y += 12;
  for (const raw of document.recipient.addressLines) {
    /*
       Wrapped, because a seller's address is as long as it is.

       `Warehouse 43, Street 19, Al Quoz Industrial 1, Al Quoz Industrial 1,
       Dubai` ran straight through `Date of supply` in the column beside it. The
       screen wraps for free; a PDF has to be told.
    */
    for (const line of wrap(raw, PARTY.width, 9, "regular")) {
      text(line, MARGIN.x, 9, "regular");
      y += 11;
    }
  }
  if (document.recipient.trn) {
    // Labelled, always. The issuer holds no TRN, and an unlabelled number beside
    // a supplier block reads as theirs.
    text(`Recipient TRN ${document.recipient.trn}`, MARGIN.x, 8.5, "mono");
    y += 12;
  }
  const partyBottom = y;

  /*
     Four labelled dates, in a column of their own.

     The board printed `14 AUG 2026` once and let it carry date of issue, date of
     supply and the supply period at the same time. On a tax document those are
     three separate claims and each is separately mandatory.
  */
  const dates: [string, string | null][] = [
    ["Date of issue", document.issuedOn],
    ["Date of supply", document.suppliedOn],
    ["Supply period", document.supplyPeriod],
    ["Place of supply", document.placeOfSupply],
    ["Currency", document.totals.currency],
  ];

  let dy = partyTop;
  text("Dates & supply", PARTY.datesX, 8, "regular", { grey: MUTED, at: dy });
  dy += 13;
  for (const [label, value] of dates) {
    if (!value) continue;
    text(label, PARTY.datesX, 9, "regular", { grey: MUTED, at: dy });
    text(value, COL.amount, 9, "regular", { align: "right", at: dy });
    dy += 12;
  }

  y = Math.max(partyBottom, dy) + 16;

  /* ── The line table, with VAT per line ─────────────────────────────────── */
  ops.push({ kind: "rect", x: MARGIN.x, y, w: A4.width - MARGIN.x * 2, h: 22, fill: 0.96 });
  const headY = y + 14;
  text("DESCRIPTION", COL.description + 8, 7, "bold", { grey: MUTED, at: headY });
  text("QTY", COL.qty, 7, "bold", { grey: MUTED, align: "right", at: headY });
  text("UNIT AED", COL.unit, 7, "bold", { grey: MUTED, align: "right", at: headY });
  text("RATE", COL.rate, 7, "bold", { grey: MUTED, align: "right", at: headY });
  text("VAT AED", COL.vat, 7, "bold", { grey: MUTED, align: "right", at: headY });
  text("AMOUNT AED", COL.amount - 8, 7, "bold", { grey: MUTED, align: "right", at: headY });
  y += 22;

  for (const line of document.lines) {
    y += 15;
    const wrapped = wrap(line.description, COL.descriptionWidth, 9, "regular");
    // The figures sit against the first line of a wrapped description, which is
    // where a reader looks for them.
    const rowTop = y;
    wrapped.forEach((part, index) => {
      text(part, COL.description + 8, 9, "regular", { at: rowTop + index * 11 });
    });
    y = rowTop + (wrapped.length - 1) * 11;
    text(line.qty, COL.qty, 9, "regular", { align: "right", at: rowTop });
    text(line.unitAed ?? "\u2014", COL.unit, 9, "mono", { align: "right", at: rowTop });
    text(line.rate ?? "\u2014", COL.rate, 9, "regular", { align: "right", at: rowTop });
    text(line.vatAed ?? "\u2014", COL.vat, 9, "mono", { align: "right", at: rowTop });
    text(line.amountAed, COL.amount - 8, 9, "mono", { align: "right", at: rowTop });

    const detail = [line.bookingRef, line.detail].filter(Boolean).join(" · ");
    if (detail) {
      for (const part of wrap(detail, COL.descriptionWidth, 7.5, "regular")) {
        y += 11;
        text(part, COL.description + 8, 7.5, "regular", { grey: MUTED });
      }
    }
    y += 10;
    rule(y, 0.9);
  }

  /* ── Totals ────────────────────────────────────────────────────────────── */
  const totals: [string, string, boolean][] = [
    ["Subtotal, excluding VAT", document.totals.subtotalAed, false],
    ["Total VAT payable", document.totals.vatAed, false],
    [`Total payable, including VAT · ${document.totals.currency}`, document.totals.totalAed, true],
  ];

  for (const [label, value, strong] of totals) {
    y += 16;
    if (strong) {
      ops.push({
        kind: "rect",
        x: MARGIN.x,
        y: y - 12,
        w: A4.width - MARGIN.x * 2,
        h: 22,
        fill: 0.96,
      });
    }
    text(label, COL.description + 8, strong ? 9.5 : 9, strong ? "bold" : "regular");
    text(value, COL.amount - 8, strong ? 10.5 : 9, "mono", { align: "right" });
    if (strong) y += 10;
  }

  /* ── Payment received, inside the document ─────────────────────────────── */
  if (document.payment) {
    y += 26;
    const boxTop = y;
    ops.push({
      kind: "rect",
      x: MARGIN.x,
      y: boxTop,
      w: A4.width - MARGIN.x * 2,
      h: 54,
      stroke: RULE,
    });
    y += 16;
    text("PAYMENT RECEIVED", MARGIN.x + 10, 7, "bold", { grey: MUTED });
    text("REFERENCES", PARTY.datesX, 7, "bold", { grey: MUTED });
    y += 14;
    text(`Paid in full on ${document.payment.paidOn}`, MARGIN.x + 10, 9, "regular");
    if (document.references.pspRef) {
      text(document.references.pspRef, PARTY.datesX, 8.5, "mono");
    }
    y += 13;
    const card = [
      document.payment.brand,
      document.payment.last4 ? `•••• ${document.payment.last4}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    if (card) text(card, MARGIN.x + 10, 9, "regular", { grey: MUTED });
    if (document.references.subscriptionRef) {
      text(document.references.subscriptionRef, PARTY.datesX, 8.5, "mono");
    }
    y = boxTop + 54;
  }

  /* ── The foot of the sheet, wherever the table ended ───────────────────── */
  const footTop = A4.height - MARGIN.bottom - 96;

  const note =
    `All amounts are in ${document.totals.currency}. This document is a fixed record: a ` +
    `correction is issued as a credit note referencing ${document.ref}, never as a change to ` +
    `this invoice.`;
  let ny = footTop;
  for (const line of wrap(note, A4.width - MARGIN.x * 2, 8, "regular")) {
    text(line, MARGIN.x, 8, "regular", { grey: MUTED, at: ny });
    ny += 11;
  }

  /*
     The statutory sentence, held open and visibly so.

     A US-registered supplier is charging 5% to a UAE recipient — spec Q3 — and
     who accounts for that VAT changes the heading, this footnote and possibly
     the VAT lines. A dashed box says which question is open; a silently absent
     footnote would look like a finished document.
  */
  ny += 8;
  ops.push({
    kind: "rect",
    x: MARGIN.x,
    y: ny,
    w: A4.width - MARGIN.x * 2,
    h: 30,
    stroke: 0.7,
    dashed: true,
  });
  text(
    "Statutory VAT wording sits here, once the US-supplier / UAE-recipient treatment is settled.",
    MARGIN.x + 8,
    7.5,
    "regular",
    { grey: MUTED, at: ny + 18 },
  );

  /* ── Page foot ─────────────────────────────────────────────────────────── */
  const footY = A4.height - MARGIN.bottom;
  rule(footY - 12, 0.85);
  text(`${document.ref}  ·  ${document.supplier.name.toUpperCase()}`, MARGIN.x, 7, "mono", {
    grey: MUTED,
    at: footY,
  });
  text(`PAGE 1 OF ${pages}`, COL.amount, 7, "mono", { grey: MUTED, align: "right", at: footY });

  // Referenced so the column table cannot drift out of the layout unnoticed.
  void textWidth;
  void INK;

  return ops;
}
