import "server-only";
import { prisma } from "@/lib/db/client";
import { medianResponseMs, windowStart, type ReplyObservation } from "./response-time";

/**
 * The response-time measurement job.
 *
 * Reads `EnquiryRecipient.createdAt` and `firstReplyAt` — both stamped by the
 * services that do the work, never by a form — and writes
 * `Business.responseTimeMedianMs`. That column is the only place the number
 * lives, no API path writes it, and no seller-facing form has a field for it.
 * Criterion 5 asks for exactly that, and the asking is the point: a claimed
 * reply time is worth nothing, which is why every other directory's is.
 *
 * Idempotent. Running it twice produces the same numbers, so it is safe to
 * retry, safe to run by hand, and safe to schedule more often than needed.
 */

export interface MeasurementResult {
  businessesConsidered: number;
  /** How many now have a median they did not have, or a different one. */
  updated: number;
  /** How many fell below the sample floor and were cleared to unmeasured. */
  cleared: number;
  ranAt: Date;
}

export async function measureResponseTimes(now: Date = new Date()): Promise<MeasurementResult> {
  const since = windowStart(now);

  /*
   * Every recipient row inside the window, for every claimed business. An
   * unclaimed listing has nobody behind it to reply, so measuring one would
   * publish a reply time for a supplier who has never seen an enquiry.
   */
  const rows = await prisma.enquiryRecipient.findMany({
    where: {
      createdAt: { gte: since },
      business: { claimStatus: "claimed", suspendedAt: null },
    },
    select: { businessId: true, createdAt: true, firstReplyAt: true },
  });

  const byBusiness = new Map<string, ReplyObservation[]>();
  for (const row of rows) {
    const list = byBusiness.get(row.businessId) ?? [];
    list.push({ deliveredAt: row.createdAt, firstReplyAt: row.firstReplyAt });
    byBusiness.set(row.businessId, list);
  }

  // Businesses that had a median and now have no enquiries in the window at
  // all. Without this a supplier who stopped trading keeps their old number.
  const previouslyMeasured = await prisma.business.findMany({
    where: { responseTimeMedianMs: { not: null } },
    select: { id: true, responseTimeMedianMs: true },
  });
  for (const business of previouslyMeasured) {
    if (!byBusiness.has(business.id)) byBusiness.set(business.id, []);
  }

  let updated = 0;
  let cleared = 0;

  for (const [businessId, observations] of byBusiness) {
    const median = medianResponseMs(observations);
    const current = previouslyMeasured.find((b) => b.id === businessId)?.responseTimeMedianMs ?? null;
    if (median === current) continue;

    await prisma.business.update({
      where: { id: businessId },
      data: { responseTimeMedianMs: median, derivedAt: now },
    });
    if (median === null) cleared += 1;
    else updated += 1;
  }

  return {
    businessesConsidered: byBusiness.size,
    updated,
    cleared,
    ranAt: now,
  };
}
