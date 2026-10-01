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
  /** Every invoice there is, not the rows this list carries. */
  total: number;
  /** Issued or overdue and not yet paid, in fils — across every invoice, not the rows listed. */
  outstandingFils: number;
  /** How many invoices that outstanding figure is owed on. */
  outstandingCount: number;
}

/** What "outstanding" means: sent and not settled. Overdue is still owed. */
const OUTSTANDING_STATUSES = ["issued", "overdue"] as const;

const TOTAL_SELECT = {
  subtotalFils: true,
  vatFils: true,
  totalFils: true,
  vatRate: true,
  lines: { select: { amountAed: true, qty: true } },
} as const;

/**
 * What is owed, across every invoice rather than the ones a list shows.
 *
 * The console's header summed the two hundred most recent rows and called it
 * outstanding — a page cap wearing a total, the defect build plan 1.3 fixed on
 * three other screens. Board 4a links its *Invoices outstanding* figure here, so
 * the two now read one function: the count and the amount it states are what
 * this header states.
 */
export async function outstandingInvoices(): Promise<{ count: number; fils: number }> {
  const owed = await prisma.invoice.findMany({
    where: { status: { in: [...OUTSTANDING_STATUSES] } },
    select: TOTAL_SELECT,
  });
  return {
    count: owed.length,
    fils: owed.reduce((sum, invoice) => sum + storedTotals(invoice).totalFils, 0),
  };
}

export async function invoiceList(limit = 200): Promise<InvoiceList> {
  const invoices = await prisma.invoice.findMany({
    orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
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

  const [total, outstanding] = await Promise.all([prisma.invoice.count(), outstandingInvoices()]);

  return {
    rows,
    total,
    outstandingFils: outstanding.fils,
    outstandingCount: outstanding.count,
  };
}
