import "server-only";
import { prisma } from "@/lib/db/client";
import { invoicePdfPath, putInvoicePdf } from "@/lib/storage";
import { invoicePdf } from "./invoice-pdf";
import { documentOf } from "./tax-invoice";

/**
 * Write the PDF for an invoice, once, and record where it went.
 *
 * Board 11g's new dependency. The rule is stricter than "generate a PDF": the
 * file is written **at issue** and the download serves *that file*, byte for
 * byte, for as long as it is asked for. A PDF regenerated later by an improved
 * template is a different document from the one the seller filed with their
 * accountant, even when every figure on it matches.
 *
 * ## Deliberately outside the issuing transaction
 *
 * `issueInvoice` runs inside `$transaction` alongside the plan change and the
 * MRR movement. Object storage is a network call to a different system, and
 * holding a write transaction open across one is how a slow bucket becomes a
 * database incident. More importantly the failure modes point opposite ways: an
 * invoice that exists without its PDF is recoverable — the screen says the
 * document is not available and this can be run again — while money moved with
 * no invoice row is not.
 *
 * So: the invoice is committed first, then this runs. A failure leaves
 * `pdfPath` null, which the screen reads and states.
 *
 * ## Idempotent, and refuses to overwrite
 *
 * Called twice, the second call finds a `pdfPath` already stored and does
 * nothing. If it somehow reached storage anyway, `putInvoicePdf` uploads with
 * `upsert: false` and the bucket refuses. Two fences, because this is the one
 * file on the platform that must not be replaced.
 */
export interface PdfWriteResult {
  ok: boolean;
  /** True when the invoice already had one and nothing was written. */
  skipped: boolean;
  /**
   * Why it failed, where it did.
   *
   * Carried back rather than only logged. A `console.warn` in a serverless
   * function reaches nobody, so a renewal that raised an invoice and could not
   * store its document was a failure with no reader — the seller saw "not
   * available" and nothing else did. The daily job puts this in its step report
   * and `writeMissingInvoicePdfs` retries on the next run.
   */
  reason?: string;
}

export async function writeInvoicePdf(invoiceId: string): Promise<PdfWriteResult> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, businessId: true, ref: true, pdfPath: true, status: true },
  });

  if (!invoice) return { ok: false, skipped: false, reason: "no such invoice" };
  // Already written. The file on storage is the document; nothing re-renders it.
  if (invoice.pdfPath) return { ok: true, skipped: true };
  // A draft has no number a seller should quote and nothing to evidence.
  if (invoice.status === "draft") return { ok: false, skipped: true };

  /*
     Read through the same function the screen reads through.

     Not a private assembly of the same fields: the whole of board 11g's central
     rule is that the screen and the PDF render one object, and two readers of
     one table is exactly how they would come to disagree.
  */
  const document = await documentOf(invoice.businessId, invoice.id);
  if (!document) return { ok: false, skipped: false, reason: "the document did not resolve" };

  const { bytes } = invoicePdf(document);
  const path = invoicePdfPath(invoice.businessId, invoice.id, invoice.ref);
  const stored = await putInvoicePdf(path, bytes);
  if (!stored.ok) return { ok: false, skipped: false, reason: stored.reason };

  await prisma.invoice.update({
    where: { id: invoice.id },
    // Both columns together, or the check constraint refuses the row: a path
    // with no size is a file nothing can report on.
    data: { pdfPath: stored.path, pdfBytes: bytes.byteLength },
  });

  return { ok: true, skipped: false };
}
