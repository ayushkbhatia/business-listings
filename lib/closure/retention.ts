import "server-only";
import { prisma } from "@/lib/db/client";
import { DOCUMENT_BUCKET, removeObject } from "@/lib/storage";
import { addMonths, DOCUMENT_RETENTION_MONTHS, RETAINED_DOCUMENT_KINDS } from "./policy";

/**
 * Board `11i` build note `B5` and acceptance criterion 5 — licence documents
 * kept for the published period, then hard-deleted.
 *
 * The period is Privacy §07's, not this board's: verification documents are
 * kept *"12 months after expiry or removal"*. For a closed business the removal
 * is the day the closure became final — before that it could still be
 * reversed, and deleting the licence of a listing that comes back on day
 * thirteen would send its owner back through verification for nothing.
 *
 * ## What this deletes, and what it does not
 *
 * Only `trade_licence` and `vat_certificate` documents belonging to the
 * business. A quote attachment is part of an enquiry thread, which Privacy §07
 * keeps for five years from the last message, and a product datasheet is
 * catalogue, not evidence. The storage object goes first and the row second:
 * a row whose object is gone is a broken link the next reader reports, while an
 * object whose row is gone is a file nobody will ever find to delete.
 *
 * ## The half of §07 r4 this does not cover
 *
 * *"12 months after expiry"* for a business that is still open — an expired
 * licence nobody replaced — is a sweep over every business, not a closure
 * rule, and deleting evidence behind a live listing is a decision worth its own
 * board. It is recorded in docs/platform-state.md as outstanding.
 */

export interface DocumentPurgeResult {
  businesses: number;
  documents: number;
  /** Objects the storage API refused. Their rows are kept so the next run retries. */
  storageFailures: number;
}

export async function purgeRetainedDocuments(now: Date = new Date()): Promise<DocumentPurgeResult> {
  const cutoff = addMonths(now, -DOCUMENT_RETENTION_MONTHS);

  const closures = await prisma.businessClosure.findMany({
    where: { finalisedAt: { lte: cutoff }, documentsPurgedAt: null },
    select: { id: true, businessId: true },
  });

  const result: DocumentPurgeResult = { businesses: 0, documents: 0, storageFailures: 0 };

  for (const closure of closures) {
    // A business reopened for its licence holder after its closure became
    // final (Q2) is open again, and its documents are live evidence.
    const business = await prisma.business.findUnique({
      where: { id: closure.businessId },
      select: { closedAt: true },
    });
    if (!business?.closedAt) {
      await prisma.businessClosure.update({
        where: { id: closure.id },
        data: { documentsPurgedAt: now },
      });
      continue;
    }

    const documents = await prisma.document.findMany({
      where: { businessId: closure.businessId, kind: { in: [...RETAINED_DOCUMENT_KINDS] } },
      select: { id: true, storagePath: true },
    });

    let failed = 0;
    for (const document of documents) {
      try {
        await removeObject(DOCUMENT_BUCKET, document.storagePath);
      } catch (cause) {
        console.error("[closure] could not delete a retained document object", {
          documentId: document.id,
          cause,
        });
        failed += 1;
        continue;
      }

      await prisma.$transaction([
        // `ClaimSubmission.document` is Restrict. The claim record stays; the
        // evidence it pointed at is what the policy says goes.
        prisma.claimSubmission.updateMany({
          where: { documentId: document.id },
          data: { documentId: null },
        }),
        prisma.document.delete({ where: { id: document.id } }),
      ]);
      result.documents += 1;
    }

    result.storageFailures += failed;
    if (failed === 0) {
      await prisma.businessClosure.update({
        where: { id: closure.id },
        data: { documentsPurgedAt: now },
      });
      result.businesses += 1;
    }
  }

  return result;
}
