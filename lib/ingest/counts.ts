import "server-only";
import type { Prisma } from "@/lib/db/generated/client";

/**
 * The stored figures, recounted from the records.
 *
 * `categorisedCount` and `queuedCount` were written once at staging and never
 * again, so a run whose queue had been worked still said 1,208 waiting.
 * Recounted inside every transaction that moves a record.
 */
export async function runCounts(tx: Prisma.TransactionClient, runId: string) {
  const grouped = await tx.stagedListing.groupBy({
    by: ["disposition"],
    where: { runId },
    _count: { _all: true },
  });
  const of = (disposition: string) =>
    grouped.find((row) => row.disposition === disposition)?._count._all ?? 0;
  const categorised = of("ready") + of("published");
  const queued = of("needs_category");
  return {
    stagedCount: categorised + queued,
    categorisedCount: categorised,
    queuedCount: queued,
    rejectedCount: of("rejected"),
    duplicateCount: of("duplicate") + of("merged") + of("discarded"),
  };
}
