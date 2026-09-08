import "server-only";
import { Prisma } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { writeInvoicePdf } from "./issue-pdf";

/**
 * The invoices that have no document behind them, written again.
 *
 * Board 11g wrote the PDF at issue and made a failure recoverable rather than
 * fatal: the invoice is committed first, the file is written after, and a
 * failure leaves `pdfPath` null — which the screen reads and states. That was
 * the right shape and it was only half of it. Nothing ever tried again, and
 * nothing reported that there was anything to try: `putInvoicePdf` warned to a
 * console, which in a serverless function is a message with no reader.
 *
 * So the honest failure was also a silent one. A storage outage during the
 * nightly renewal run left every invoice raised that night undownloadable, for
 * good, and the first anybody would hear of it is an accountant asking a seller
 * for a document.
 *
 * This is the other half. It runs daily, after the steps that issue invoices,
 * and it reports what it found as well as what it fixed — `outstanding` is the
 * number that matters, because a step that writes nothing and leaves forty
 * behind reads identically to one with nothing to do unless it says so.
 *
 * ## Why it is safe to run every day
 *
 * `writeInvoicePdf` is idempotent twice over: it returns early on an invoice
 * that already has a `pdfPath`, and `putInvoicePdf` uploads with `upsert: false`
 * so the bucket refuses a second write anyway. The document a seller filed with
 * their accountant cannot be replaced by a later template — criterion 7 — and
 * that holds here as much as at issue.
 *
 * ## Bounded, and it says when it stopped
 *
 * A backlog of thousands would otherwise turn a daily job into an hour of
 * uploads. The cap is stated in the result rather than applied quietly: a
 * truncated sweep that reports "written: 50" and nothing else reads as finished.
 */

/** How many to attempt in one run. Generous against a night's renewals. */
export const PDF_BACKFILL_LIMIT = 50;

export interface PdfBackfillResult {
  /** Invoices found with no stored document, up to the limit. */
  considered: number;
  written: number;
  failed: number;
  /**
   * How many are still without one after this run, across the whole table.
   *
   * The number an operator acts on. Counted rather than inferred from
   * `considered - written`, because the limit means those two say nothing about
   * the size of the backlog.
   */
  outstanding: number;
  /** Distinct failure reasons, so the report names the cause rather than a count. */
  reasons: string[];
  /** True where the limit cut the run short. Never a silent truncation. */
  capped: boolean;
  ranAt: Date;
}

export async function writeMissingInvoicePdfs(
  limit: number = PDF_BACKFILL_LIMIT,
  now: Date = new Date(),
): Promise<PdfBackfillResult> {
  /*
     Issued documents only.

     A draft has no number a seller should quote and nothing to evidence —
     `writeInvoicePdf` refuses one anyway, and selecting them here would make
     `outstanding` count rows that are not missing anything. A void invoice is
     the same: it was withdrawn, and a document for it would be a document for
     something that did not happen.
  */
  const where: Prisma.InvoiceWhereInput = {
    pdfPath: null,
    status: { notIn: ["draft", "void"] },
  };

  const missing = await prisma.invoice.findMany({
    where,
    // Oldest first. A seller chasing a document is chasing the one their
    // accountant asked for, which is never the one raised last night.
    orderBy: { issuedAt: "asc" },
    take: limit,
    select: { id: true },
  });

  let written = 0;
  let failed = 0;
  const reasons = new Set<string>();

  for (const invoice of missing) {
    const result = await writeInvoicePdf(invoice.id);
    if (result.ok) written += 1;
    else {
      failed += 1;
      if (result.reason) reasons.add(result.reason);
    }
  }

  const outstanding = await prisma.invoice.count({ where });

  return {
    considered: missing.length,
    written,
    failed,
    outstanding,
    reasons: [...reasons],
    capped: missing.length === limit,
    ranAt: now,
  };
}
