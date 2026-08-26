import "server-only";
import { prisma } from "@/lib/db/client";
import { FILS_PER_AED } from "./proration";

/**
 * Every invoice we have issued, for the console.
 *
 * Deliberately a list and not a ledger of payments received: nothing on this
 * platform captures a payment yet, so a "paid" invoice is one somebody marked
 * paid. The status column says what it says and nothing infers from it.
 */

export interface InvoiceRow {
  id: string;
  ref: string;
  businessId: string;
  businessName: string;
  issuedAt: Date | null;
  status: string;
  lines: number;
  /** Net of credits, in fils. A credit line is negative and stays negative. */
  totalFils: number;
  /** True when any line is a subscription credit. */
  hasCredit: boolean;
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
      issuedAt: true,
      business: { select: { displayName: true } },
      lines: { select: { kind: true, amountAed: true, qty: true } },
    },
  });

  const rows: InvoiceRow[] = invoices.map((invoice) => ({
    id: invoice.id,
    ref: invoice.ref,
    businessId: invoice.businessId,
    businessName: invoice.business.displayName,
    issuedAt: invoice.issuedAt,
    status: invoice.status,
    lines: invoice.lines.length,
    totalFils: invoice.lines.reduce(
      (sum, line) => sum + Math.round(Number(line.amountAed) * FILS_PER_AED) * line.qty,
      0,
    ),
    hasCredit: invoice.lines.some((line) => line.kind === "subscription_credit"),
  }));

  return {
    rows,
    outstandingFils: rows
      .filter((row) => row.status === "issued" || row.status === "overdue")
      .reduce((sum, row) => sum + row.totalFils, 0),
  };
}
