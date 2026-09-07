import "server-only";
import { prisma } from "@/lib/db/client";
import { storedTotals } from "./invoice";

/**
 * Every invoice we have issued, for the console.
 *
 * Deliberately a list and not a ledger of payments received: nothing on this
 * platform captures a payment yet, so a "paid" invoice is one somebody marked
 * paid. The status column says what it says and nothing infers from it.
 *
 * Totals come from `storedTotals`, not from summing the lines here. Board 3m's
 * criterion 1 — one invoice, one total, everywhere it appears — is a property of
 * having one reader rather than of several readers agreeing.
 */

export interface InvoiceRow {
  id: string;
  ref: string;
  businessId: string;
  businessName: string;
  issuedAt: Date | null;
  status: string;
  lines: number;
  /**
   * Gross, in fils — what the seller was asked for, VAT included.
   *
   * This was the net figure while the list summed lines itself, so the console
   * showed one number and the seller's own invoice showed another 5% higher.
   * Negative throughout on a credit note.
   */
  totalFils: number;
  /** True when any line is a subscription credit. */
  hasCredit: boolean;
  /** True when this row is a credit note rather than an invoice. */
  isCreditNote: boolean;
}

export interface InvoiceList {
  rows: InvoiceRow[];
  /** Issued or overdue and not yet paid, in fils. */
  outstandingFils: number;
}

export async function invoiceList(limit = 200): Promise<InvoiceList> {
  const invoices = await prisma.invoice.findMany({
    orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }],
    take: limit,
    select: {
      id: true,
      ref: true,
      businessId: true,
      status: true,
      docType: true,
      issuedAt: true,
      vatRate: true,
      subtotalFils: true,
      vatFils: true,
      totalFils: true,
      billedToName: true,
      business: { select: { displayName: true } },
      lines: { select: { kind: true, amountAed: true, qty: true } },
    },
  });

  const rows: InvoiceRow[] = invoices.map((invoice) => ({
    id: invoice.id,
    ref: invoice.ref,
    businessId: invoice.businessId,
    // As billed, where the invoice recorded it. A rename does not rewrite a
    // document that has already been sent.
    businessName: invoice.billedToName ?? invoice.business.displayName,
    issuedAt: invoice.issuedAt,
    status: invoice.status,
    lines: invoice.lines.length,
    totalFils: storedTotals(invoice).totalFils,
    hasCredit: invoice.lines.some((line) => line.kind === "subscription_credit"),
    isCreditNote: invoice.docType === "credit_note",
  }));

  return {
    rows,
    outstandingFils: rows
      .filter((row) => row.status === "issued" || row.status === "overdue")
      .reduce((sum, row) => sum + row.totalFils, 0),
  };
}
