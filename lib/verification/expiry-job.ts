import "server-only";
import { prisma } from "@/lib/db/client";
import { EXPIRED_LICENCE_TIER } from "@/lib/verification";

/**
 * The tier drop the schema has promised since handoff 1 and nothing performed.
 *
 * `Business.verificationTier` carries the rule in its own doc comment — the
 * tier moves "the day licenceExpiry passes — a scheduled job, no grace period".
 * No such job existed. Nothing in the codebase read `licenceExpiry` to move a
 * tier, so a supplier whose licence lapsed last year still carried a
 * verification badge, and search still weighted them at 22 for it.
 *
 * Board 1d suppresses the badge at render, which fixed what a buyer sees on one
 * page. It did not fix the stored value, and the stored value is what ranking,
 * the sitemap, the publish thresholds and the admin matrix all read.
 *
 * ## Why tier 1 and not tier 2
 *
 * The schema comment says "drops to 2" and that is wrong in the dangerous
 * direction. `VERIFIED_TIER` is 2, so a listing left at 2 keeps its badge — and
 * tier 2's own published requirement is "we check the licence against the
 * issuing authority and confirm it is **current**", which is exactly the claim
 * an expired licence falsifies.
 *
 * Tier 1 is "the supplier gives us a trade licence number". That stays true
 * after expiry: we have the number, we simply can no longer say it is current.
 * So the drop lands there, the badge goes, and nothing on the platform asserts
 * something it cannot support.
 *
 * ## Why no audit row
 *
 * The same argument `app/api/jobs/daily/route.ts` and `dunning-job.ts` already
 * make: `AuditEvent.actorId` is NOT NULL because the log records *decisions*,
 * and a platform following its own published rule on a schedule has no actor to
 * attribute. Non-negotiable 3 is about staff state changes; a cron is not a
 * member of staff. The rule here was published in the schema before any of this
 * was written.
 *
 * ## What it will not do
 *
 * It never raises a tier. Restoring verification after a renewal is a decision
 * with an actor — an ops lead who looked at the new licence — and that path
 * already exists with its audit row and its written reason. A job that could
 * promote would be a job that could re-verify a business nobody re-checked.
 *
 * It also never touches `verifiedAt` or `visitedAt`. Those record that
 * something happened on a date, and it did; rewriting them would erase the
 * history that lets staff see what to re-check.
 */

export interface ExpirySweepResult {
  /**
   * Rows the update actually wrote.
   *
   * Normally equal to `dropped.length`. A shortfall means a staff decision
   * landed between the read and the write and the guard refused to overwrite
   * it, which is the one case worth being able to see in the job log.
   */
  expired: number;
  /** The unsuspended lapsed listings found above the floor, and what they held. */
  dropped: { slug: string; from: number; expiredOn: Date }[];
}

export async function sweepExpiredLicences(
  now: Date = new Date(),
): Promise<ExpirySweepResult> {
  /*
     Only the ones actually carrying a claim.

     A listing already at tier 1 or 0 has nothing to drop, and rewriting it
     would churn `updatedAt` on thousands of rows every night for no change —
     which is also how a sweep starts looking like activity when it is not.
  */
  const lapsed = await prisma.business.findMany({
    where: {
      licenceExpiry: { lt: now },
      verificationTier: { gt: EXPIRED_LICENCE_TIER },
      suspendedAt: null,
    },
    select: { id: true, slug: true, verificationTier: true, licenceExpiry: true },
  });

  if (lapsed.length === 0) return { expired: 0, dropped: [] };

  /*
     One statement, and the guard repeated rather than trusted.

     `where: { id: { in: [...] } }` alone would be a read-then-write with a gap
     an ops lead can act inside: they raise a tier between the two, and this
     writes over a decision that has an audit row. Restating the three
     conditions makes the update refuse any row that stopped qualifying — the
     count below is what actually changed, not what was found.
  */
  const { count } = await prisma.business.updateMany({
    where: {
      id: { in: lapsed.map((business) => business.id) },
      licenceExpiry: { lt: now },
      verificationTier: { gt: EXPIRED_LICENCE_TIER },
      suspendedAt: null,
    },
    data: { verificationTier: EXPIRED_LICENCE_TIER },
  });

  return {
    expired: count,
    dropped: lapsed.map((business) => ({
      slug: business.slug,
      from: business.verificationTier,
      expiredOn: business.licenceExpiry,
    })),
  };
}

export { EXPIRED_LICENCE_TIER } from "@/lib/verification";
