import { A4, MARGIN, renderPdfPages, wrap, type PdfFont, type PdfOp } from "@/lib/billing/pdf";
import type { AcceptedRecord } from "@/lib/enquiry/accepted-record";
import { leadTime, totalLabel, windowLine } from "@/lib/enquiry/accepted-record-words";
import {
  agreedAmount,
  agreedFacts,
  agreedWindowLine,
  commitmentLines,
  isAcceptedProposal,
  paymentLine,
  proposalSummaryParts,
  siteLines,
} from "@/lib/enquiry/accepted-proposal-words";
import { formatAED, formatDate, formatPhone } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Board `7c` `B7` — the accepted quote as a PDF.
 *
 * *"The quote PDF is generated from the same computed figures as the page. Two
 * renderings of a total is two chances to disagree."* So this takes the page's
 * own value, `AcceptedRecord`, and computes nothing: every line total and the
 * sum arrive from `recordLines`, and every label comes from the same catalogue
 * keys the page renders. AC6 is then a property of the code rather than a thing
 * a test hopes for.
 *
 * ## Rendered on request, not stored
 *
 * Unlike a tax invoice, which is issued once and served byte for byte, this is a
 * view of a record that can still gain one thing — the buyer's own reference.
 * Storing it would freeze a copy that disagrees with the page the moment they
 * add a PO number. The figures cannot change (a sent quote is never edited), so
 * regenerating reproduces them exactly.
 *
 * Pure: a test renders a record to bytes and reads them.
 *
 * ## What it says about us
 *
 * The same three things the page says, because a buyer forwards this file to an
 * accounts team who never saw the page: the supplier invoices them directly, we
 * take no payment, and this is a record of a quote rather than an invoice from
 * anybody.
 */

const COL = {
  line: MARGIN.x + 8,
  lineWidth: 228,
  qty: 318,
  unit: 388,
  total: 468,
  lead: A4.width - MARGIN.x - 8,
} as const;

const MUTED = 0.42;
const RULE = 0.82;

/** Where a row must end for the page foot to stay clear. */
const CONTENT_BOTTOM = A4.height - MARGIN.bottom - 64;

export interface RenderedQuoteRecord {
  bytes: Buffer;
  pages: number;
  filename: string;
}

export function acceptedQuotePdf(record: AcceptedRecord, now: Date): RenderedQuoteRecord {
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
    text(t("accepted.col.line").toUpperCase(), COL.line, 7, "bold", { grey: MUTED, at });
    text(t("accepted.col.qty").toUpperCase(), COL.qty, 7, "bold", { grey: MUTED, align: "right", at });
    text(t("accepted.col.unit").toUpperCase(), COL.unit, 7, "bold", { grey: MUTED, align: "right", at });
    text(t("accepted.col.line_total").toUpperCase(), COL.total, 7, "bold", { grey: MUTED, align: "right", at });
    text(t("accepted.col.supplier_said").toUpperCase(), COL.lead, 7, "bold", { grey: MUTED, align: "right", at });
    y += 22;
  };

  const supplier = record.supplier;
  const quote = record.quote;
  const accepted = isAcceptedProposal(record) ? record : null;

  /* ── Head ────────────────────────────────────────────────────────────────── */
  text(t("site.name"), MARGIN.x, 15, "bold");
  text((accepted ? t("accepted.pdf.kind_proposal") : t("accepted.pdf.kind")).toUpperCase(), A4.width - MARGIN.x, 8, "bold", {
    align: "right",
    grey: MUTED,
  });
  y += 16;
  text(quote.ref, A4.width - MARGIN.x, 10.5, "mono", { align: "right" });
  y += 22;
  text(supplier.displayName, MARGIN.x, 13, "bold");
  y += 14;
  const summary = [
    record.acceptedAt ? t("accepted.summary.accepted", { when: formatDate(record.acceptedAt) }) : null,
    t("accepted.summary.enquiry", { ref: record.ref }),
    ...(accepted ? proposalSummaryParts(accepted) : []),
    record.buyerReference ? t("accepted.summary.reference", { reference: record.buyerReference }) : null,
  ]
    .filter(Boolean)
    .join("  ·  ");
  // A proposal's summary carries the engagement, fee and term too, and wraps rather than run off the page.
  const summaryLines = wrap(summary, A4.width - MARGIN.x * 2, 9, "regular");
  summaryLines.forEach((part, index) => {
    if (index > 0) y += 11;
    text(part, MARGIN.x, 9, "regular", { grey: MUTED });
  });
  y += 16;
  rule(y);
  y += 18;

  /* ── The three facts ─────────────────────────────────────────────────────── */
  const factsTop = y;
  const column = (x: number, label: string, lines: string[]) => {
    let at = factsTop;
    text(label.toUpperCase(), x, 7, "bold", { grey: MUTED, at });
    at += 13;
    for (const line of lines) {
      for (const part of wrap(line, 150, 9, "regular")) {
        text(part, x, 9, "regular", { at });
        at += 11;
      }
    }
    return at;
  };

  const contactLines = [
    supplier.person ? `${supplier.person.name}, ${supplier.person.role}` : supplier.displayName,
    supplier.person?.phone ? formatPhone(supplier.person.phone) : null,
    supplier.phone ? formatPhone(supplier.phone) : null,
    supplier.whatsapp ? t("accepted.contact.whatsapp", { number: formatPhone(supplier.whatsapp) }) : null,
  ].filter((line): line is string => Boolean(line));
  if (contactLines.length === 1) contactLines.push(t("accepted.contact.no_phone"));

  const whereLines = accepted
    ? siteLines(accepted).length > 0
      ? siteLines(accepted)
      : [t("accepted_proposal.where.none")]
    : supplier.location
    ? [
        supplier.location.addressLine,
        [supplier.location.areaName, t(`emirate.${supplier.location.emirate}` as "emirate.dubai")]
          .filter(Boolean)
          .join(", "),
      ]
    : [t("accepted.where.none")];

  const paymentLines = [
    accepted
      ? paymentLine(accepted).value
      : quote.paymentTerms
        ? t(`terms.${quote.paymentTerms}` as "terms.net_30")
        : t("accepted.not_stated"),
    t("accepted.payment.invoiced_by_them"),
  ];

  const bottom = Math.max(
    column(MARGIN.x, t("accepted.contact.who"), contactLines),
    column(MARGIN.x + 165, accepted ? t("accepted_proposal.where.label") : t("accepted.where.label"), whereLines),
    column(MARGIN.x + 330, t("accepted.payment.label"), paymentLines),
  );
  y = bottom + 14;
  rule(y);
  y += 18;

  /* ── What was agreed — board `7c-s` ──────────────────────────────────────── */
  if (accepted) {
    const proposal = accepted.quote.proposal;
    const width = A4.width - MARGIN.x * 2;
    const LABEL_W = 140;

    const paragraph = (body: string, size: number, font: PdfFont, options: { grey?: number; x?: number; w?: number } = {}) => {
      for (const line of body.split("\n")) {
        for (const part of wrap(line, options.w ?? width, size, font)) {
          if (y + size + 3 > CONTENT_BOTTOM) newPage();
          y += size + 3;
          text(part, options.x ?? MARGIN.x, size, font, options.grey === undefined ? {} : { grey: options.grey });
        }
      }
    };
    const heading = (title: string, aside?: string) => {
      if (y + 40 > CONTENT_BOTTOM) newPage();
      text(title, MARGIN.x, 10.5, "bold");
      if (aside) text(aside.toUpperCase(), A4.width - MARGIN.x, 7, "mono", { align: "right", grey: MUTED });
      y += 8;
    };
    const term = (label: string, value: string, font: PdfFont = "regular") => {
      const parts = wrap(value, width - LABEL_W, 9, font);
      if (y + parts.length * 11 + 8 > CONTENT_BOTTOM) newPage();
      y += 11;
      text(label.toUpperCase(), MARGIN.x, 7, "bold", { grey: MUTED });
      parts.forEach((part, index) => text(part, MARGIN.x + LABEL_W, 9, font, { at: y + index * 11 }));
      y += (parts.length - 1) * 11 + 4;
    };
    const block = () => {
      y += 12;
      if (y + 30 > CONTENT_BOTTOM) newPage();
      rule(y, 0.9);
      y += 18;
    };

    // The same fields as the page, in the same order, from the same words (AC10).
    heading(t("accepted_proposal.agreed.title"), agreedWindowLine(accepted));
    term(t("accepted_proposal.basis.label"), `${proposal.feeBasisLabel} · ${t("accepted_proposal.basis.note")}`);
    const amount = agreedAmount(accepted);
    term(t("accepted.proposal.fee"), `${amount.currency} ${amount.figure} ${amount.basis}`, "mono");
    for (const fact of agreedFacts(accepted)) term(fact.label, fact.value);
    y += 6;
    // No total, and the reason, as on the page (`B3`).
    paragraph(`${t("accepted_proposal.no_total.lead")} ${t("accepted_proposal.no_total.body")}`, 8, "regular", { grey: MUTED });

    block();
    heading(t("accepted_proposal.scope.title"), t("accepted_proposal.scope.note"));
    paragraph(proposal.scope, 9, "regular");
    y += 4;
    term(t("accepted_proposal.scope.service"), proposal.serviceName || t("accepted_proposal.not_stated"));
    term(t("accepted.proposal.deliverable"), proposal.deliverable ?? t("accepted_proposal.not_stated"));
    term(t("accepted.proposal.delivered_where"), proposal.deliveredWhere ?? t("accepted_proposal.not_stated"));

    // The exclusions, verbatim, in a box of their own — the loudest thing on the page.
    block();
    heading(t("accepted_proposal.excluded.title"), t("accepted_proposal.excluded.aside"));
    const excluded = proposal.exclusions ?? t("accepted.proposal.excluded_none", { supplier: supplier.displayName });
    const boxLines = excluded.split("\n").flatMap((line) => wrap(line, width - 20, 9, "regular"));
    if (y + 12 + boxLines.length * 12 > CONTENT_BOTTOM) newPage();
    y += 6;
    ops.push({ kind: "rect", x: MARGIN.x, y, w: width, h: boxLines.length * 12 + 12, fill: 0.97 });
    const boxTop = y + 14;
    boxLines.forEach((part, index) => text(part, MARGIN.x + 10, 9, "regular", { at: boxTop + index * 12 }));
    y += boxLines.length * 12 + 12;
    y += 4;
    paragraph(t("accepted_proposal.excluded.note"), 8, "regular", { grey: MUTED });

    block();
    heading(t("accepted.commitments.title"));
    const lines = commitmentLines(accepted);
    if (lines.length === 0) {
      paragraph(t("accepted_proposal.commitments.empty", { supplier: supplier.displayName }), 9, "regular", { grey: MUTED });
    }
    // The words, then where they came from beneath them — the rail's order, and a source can be long.
    for (const line of lines) {
      const parts = wrap(line.text, width, 9, "regular");
      if (y + parts.length * 11 + 22 > CONTENT_BOTTOM) newPage();
      y += 6;
      for (const part of parts) {
        y += 11;
        text(part, MARGIN.x, 9, "regular");
      }
      y += 10;
      text(line.source.toUpperCase(), MARGIN.x, 6.5, "mono", { grey: MUTED });
    }
    y += 6;
    paragraph(t("accepted_proposal.commitments.note"), 8, "regular", { grey: MUTED });
    y += 4;
  } else {
    /* ── What was quoted ─────────────────────────────────────────────────────── */
    text(t("accepted.quoted.title"), MARGIN.x, 10.5, "bold");
    text(windowLine(record, now).toUpperCase(), A4.width - MARGIN.x, 7, "mono", { align: "right", grey: MUTED });
    y += 12;
    tableHead();

    for (const line of quote.lines) {
      const described = wrap(line.description, COL.lineWidth, 9, "regular");
      const meta = line.manual ? t("accepted.line.manual") : line.sku;
      const height = 15 + (described.length - 1) * 11 + (meta ? 11 : 0) + 10;
      if (y + height > CONTENT_BOTTOM) {
        newPage();
        tableHead();
      }

      y += 15;
      const rowTop = y;
      described.forEach((part, index) => text(part, COL.line, 9, "regular", { at: rowTop + index * 11 }));
      y = rowTop + (described.length - 1) * 11;
      text(line.qty === null ? t("accepted.line.whole") : String(line.qty), COL.qty, 9, "regular", {
        align: "right",
        at: rowTop,
      });
      text(formatAED(line.unitPrice, { style: "quote" }), COL.unit, 9, "mono", { align: "right", at: rowTop });
      text(formatAED(line.lineTotal, { style: "quote" }), COL.total, 9, "mono", { align: "right", at: rowTop });
      text(leadTime(line.leadTimeDays), COL.lead, 8.5, "regular", { align: "right", at: rowTop });
      if (meta) {
        y += 11;
        text(meta.toUpperCase(), COL.line, 6.5, "mono", { grey: MUTED });
      }
      y += 10;
      rule(y, 0.9);
    }

    if (y + 60 > CONTENT_BOTTOM) newPage();
    y += 20;
    ops.push({ kind: "rect", x: MARGIN.x, y: y - 13, w: A4.width - MARGIN.x * 2, h: 22, fill: 0.96 });
    text(totalLabel(record), COL.line, 9.5, "bold");
    text(formatAED(quote.totalAed, { style: "quote" }), COL.total, 10.5, "mono", { align: "right" });
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
  }

  /* ── What this document is ───────────────────────────────────────────────── */
  const stance = wrap(accepted ? t("accepted.pdf.stance_proposal") : t("accepted.pdf.stance"), A4.width - MARGIN.x * 2, 8, "regular");
  if (y + 18 + stance.length * 11 > CONTENT_BOTTOM) newPage();
  y += 18;
  for (const part of stance) {
    text(part, MARGIN.x, 8, "regular", { grey: MUTED });
    y += 11;
  }

  pages.push(ops);

  /* ── Page foot, on every page, once the count is known ───────────────────── */
  const footY = A4.height - MARGIN.bottom;
  const foot = `${quote.ref}  ·  ${supplier.displayName.toUpperCase()}`;
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

  return {
    bytes: renderPdfPages(pages),
    pages: pages.length,
    filename: `${quote.ref}.pdf`,
  };
}
