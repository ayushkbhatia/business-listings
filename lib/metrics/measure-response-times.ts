import type { Prisma } from "@/lib/db/generated/client";
import { measureReplies, windowStart, type RateObservation } from "./response-time";

/**
 * The response-time measurement — the median and the reply rate — against
 * whichever client is handed in.
 *
 * `job.ts` runs it on the app's client and the seed runs it on its own, so
 * there is one derivation and nowhere for a second to drift. The seed used to
 * carry a hand-copied version that only wrote businesses with rows in the
 * window, and a fixture that set a median on a firm with no enquiries kept it —
 * a claimed reply time on a storefront, until the daily job happened to run.
 *
 * No `server-only` here, for exactly that reason: the seed runs under Node, not
 * under the react-server condition. The wrapper in `job.ts` keeps the guard.
 */

export interface MeasurementResult {
  businessesConsidered: number;
  /** How many now have a median or a reply rate they did not have, or a different one. */
  updated: number;
  /** How many fell below the sample floor on both measures and were cleared to unmeasured. */
  cleared: number;
  ranAt: Date;
}

export async function measureResponseTimesIn(
  db: Prisma.TransactionClient,
  now: Date,
): Promise<MeasurementResult> {
  const since = windowStart(now);

  /*
   * Every recipient row inside the window, for every claimed business. An
   * unclaimed listing has nobody behind it to reply, so measuring one would
   * publish a reply time for a supplier who has never seen an enquiry.
   */
  const rows = await db.enquiryRecipient.findMany({
    where: {
      createdAt: { gte: since },
      business: { claimStatus: "claimed", suspendedAt: null },
    },
    select: {
      businessId: true,
      createdAt: true,
      firstReplyAt: true,
      enquiry: { select: { closesAt: true } },
    },
  });

  const byBusiness = new Map<string, RateObservation[]>();
  for (const row of rows) {
    const list = byBusiness.get(row.businessId) ?? [];
    list.push({ deliveredAt: row.createdAt, firstReplyAt: row.firstReplyAt, closesAt: row.enquiry.closesAt });
    byBusiness.set(row.businessId, list);
  }

  // Businesses that had a measure and now have no enquiries in the window at
  // all. Without this a supplier who stopped trading keeps their old numbers.
  const previouslyMeasured = await db.business.findMany({
    where: { OR: [{ responseTimeMedianMs: { not: null } }, { replyRate: { not: null } }] },
    select: { id: true, responseTimeMedianMs: true, replyRate: true, replySample: true },
  });
  const previous = new Map(previouslyMeasured.map((business) => [business.id, business]));
  for (const business of previouslyMeasured) {
    if (!byBusiness.has(business.id)) byBusiness.set(business.id, []);
  }

  let updated = 0;
  let cleared = 0;

  for (const [businessId, observations] of byBusiness) {
    const next = measureReplies(observations, now);
    const current = previous.get(businessId);
    if (
      next.medianMs === (current?.responseTimeMedianMs ?? null) &&
      next.rate === (current?.replyRate ?? null) &&
      next.sample === (current?.replySample ?? null)
    ) {
      continue;
    }

    await db.business.update({
      where: { id: businessId },
      data: {
        responseTimeMedianMs: next.medianMs,
        replyRate: next.rate,
        replySample: next.sample,
        derivedAt: now,
      },
    });
    if (next.medianMs === null && next.rate === null) cleared += 1;
    else updated += 1;
  }

  return {
    businessesConsidered: byBusiness.size,
    updated,
    cleared,
    ranAt: now,
  };
}
