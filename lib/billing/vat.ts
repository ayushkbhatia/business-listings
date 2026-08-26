import "server-only";
import { prisma } from "@/lib/db/client";
import { FILS_PER_AED } from "./proration";

/**
 * Board 12e — the VAT export.
 *
 * UAE output VAT on our own subscription and placement invoices. Not on
 * anything a buyer pays a supplier: the platform is never party to that
 * transaction, holds none of that money and has no VAT position on it. This
 * export covers exactly the invoices in `Invoice`, which are subscription
 * lines, placement lines and subscription credits, and nothing else.
 *
 * ## Why the emirate column
 *
 * The FTA return splits standard-rated supplies by emirate — the boxes are per
 * emirate, not one national figure — so an export without it needs redoing by
 * hand every quarter. The emirate is the one on the seller's head office, which
 * is where the supply is made.
 *
 * ## Arithmetic
 *
 * Everything in fils, integer, from `InvoiceLine.amountAed` which is a
 * `Decimal(12,2)`. Credits are negative lines and stay negative all the way
 * through — a credit note reduces output VAT, and dropping the sign is how a
 * return ends up overstating what is owed.
 */

export interface VatRow {
  invoiceRef: string;
  issuedAt: Date;
  businessId: string;
  businessName: string;
  /** The seller's TRN, or null. A missing TRN is not an error — it is a note. */
  trn: string | null;
  emirate: string | null;
  netFils: number;
  vatFils: number;
  grossFils: number;
  /** As stored on the invoice, so a rate change is visible line by line. */
  vatRate: number;
}

export interface VatSummary {
  from: Date;
  to: Date;
  rows: VatRow[];
  netFils: number;
  vatFils: number;
  grossFils: number;
  byEmirate: { emirate: string; netFils: number; vatFils: number }[];
  /** Invoices in the window whose seller has no TRN recorded. */
  missingTrn: number;
}

function aedStringToFils(value: unknown): number {
  // `Decimal(12,2)` arrives as a string or a Decimal. Through Number and
  // rounded, because two decimal places times one hundred is exact.
  return Math.round(Number(value) * FILS_PER_AED);
}

/**
 * Every issued invoice in the window, with its VAT.
 *
 * Draft invoices are excluded — nothing has been supplied yet. Void invoices
 * are excluded. Overdue and paid are both included: VAT is due on the supply,
 * not on the payment.
 */
export async function vatReturn(from: Date, to: Date): Promise<VatSummary> {
  const invoices = await prisma.invoice.findMany({
    where: {
      status: { in: ["issued", "paid", "overdue"] },
      issuedAt: { gte: from, lt: to },
    },
    orderBy: { issuedAt: "asc" },
    select: {
      ref: true,
      issuedAt: true,
      vatRate: true,
      businessId: true,
      business: {
        select: {
          displayName: true,
          trn: true,
          locations: {
            where: { type: "head_office" },
            select: { emirate: true },
            take: 1,
          },
        },
      },
      lines: { select: { amountAed: true, qty: true } },
    },
  });

  const rows: VatRow[] = invoices.map((invoice) => {
    const netFils = invoice.lines.reduce(
      (sum, line) => sum + aedStringToFils(line.amountAed) * line.qty,
      0,
    );
    const vatRate = Number(invoice.vatRate);
    /*
     * Rounded per invoice, not per line. The FTA allows either as long as it is
     * consistent; per invoice is what the seller sees on their copy, and a
     * return that disagrees with the documents it is built from is the one that
     * costs a morning to explain.
     */
    const vatFils = Math.round(netFils * vatRate);
    return {
      invoiceRef: invoice.ref,
      // Filtered on `issuedAt` above, so it is not null here.
      issuedAt: invoice.issuedAt as Date,
      businessId: invoice.businessId,
      businessName: invoice.business.displayName,
      trn: invoice.business.trn,
      emirate: invoice.business.locations[0]?.emirate ?? null,
      netFils,
      vatFils,
      grossFils: netFils + vatFils,
      vatRate,
    };
  });

  const byEmirateMap = new Map<string, { netFils: number; vatFils: number }>();
  for (const row of rows) {
    const key = row.emirate ?? "unknown";
    const current = byEmirateMap.get(key) ?? { netFils: 0, vatFils: 0 };
    byEmirateMap.set(key, {
      netFils: current.netFils + row.netFils,
      vatFils: current.vatFils + row.vatFils,
    });
  }

  return {
    from,
    to,
    rows,
    netFils: rows.reduce((sum, row) => sum + row.netFils, 0),
    vatFils: rows.reduce((sum, row) => sum + row.vatFils, 0),
    grossFils: rows.reduce((sum, row) => sum + row.grossFils, 0),
    byEmirate: [...byEmirateMap.entries()]
      .map(([emirate, totals]) => ({ emirate, ...totals }))
      .sort((a, b) => b.netFils - a.netFils),
    missingTrn: rows.filter((row) => !row.trn).length,
  };
}

function aed(fils: number): string {
  return (fils / FILS_PER_AED).toFixed(2);
}

function csvCell(value: string): string {
  /*
   * A trade name with a comma in it is common — "Al Quoz Trading, LLC" — and a
   * name beginning with `=` is a formula injection into whoever opens this in
   * Excel. Quote everything and prefix the four dangerous leaders.
   */
  const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

/**
 * The export itself.
 *
 * CSV rather than a PDF or the FTA's own format: this goes to an accountant who
 * will put it in a spreadsheet, and every step between here and there that
 * needs a tool is a step that gets skipped.
 */
export function toCsv(summary: VatSummary): string {
  const header = [
    "Invoice",
    "Issued",
    "Supplier",
    "TRN",
    "Emirate",
    "Net AED",
    "VAT rate",
    "VAT AED",
    "Gross AED",
  ];

  const lines = [
    header.map(csvCell).join(","),
    ...summary.rows.map((row) =>
      [
        csvCell(row.invoiceRef),
        csvCell(row.issuedAt.toISOString().slice(0, 10)),
        csvCell(row.businessName),
        csvCell(row.trn ?? ""),
        csvCell(row.emirate ?? ""),
        csvCell(aed(row.netFils)),
        csvCell(`${(row.vatRate * 100).toFixed(2)}%`),
        csvCell(aed(row.vatFils)),
        csvCell(aed(row.grossFils)),
      ].join(","),
    ),
    // A total row, because the first thing anybody does with this is add it up.
    [
      csvCell("Total"),
      csvCell(""),
      csvCell(`${summary.rows.length} invoices`),
      csvCell(""),
      csvCell(""),
      csvCell(aed(summary.netFils)),
      csvCell(""),
      csvCell(aed(summary.vatFils)),
      csvCell(aed(summary.grossFils)),
    ].join(","),
  ];

  return `${lines.join("\n")}\n`;
}

/** `vat-2026-q1.csv`. Named so a folder of them sorts. */
export function exportFilename(from: Date): string {
  const quarter = Math.floor(from.getUTCMonth() / 3) + 1;
  return `vat-${from.getUTCFullYear()}-q${quarter}.csv`;
}
