import { prisma } from "@/lib/db/client";
import type { NotificationEvent, Prisma } from "@/lib/db/generated/client";

/**
 * Deleting claims a test submitted.
 *
 * Since board 4c a claim can open a conflict the moment it is submitted — a
 * challenge on a listing that already has an owner, a race with another
 * undecided claim — and a conflict holds its first two claims by a restricting
 * key. A suite that deletes its claims directly fails on that key, and the
 * conflict it leaves open sits in the queue every later suite counts.
 *
 * So, in order: the conflicts these claims opened, the flag those conflicts put
 * on any seeded claim they swept in, a listing a race marked `disputed`, the
 * messages the conflict sent, and then the claims. A seeded conflict a test
 * claim only joined is left alone — the claim leaves it by its own
 * `conflict_id`.
 */

const CLAIM_EVENTS: NotificationEvent[] = [
  "claim_conflict_opened",
  "claim_awarded",
  "claim_not_awarded",
  "claim_documents_requested",
  "claim_new_listing_created",
];

const OPEN = { resolvedAt: null, dissolvedAt: null } as const;

export async function deleteClaims(where: Prisma.ClaimSubmissionWhereInput): Promise<number> {
  const claims = await prisma.claimSubmission.findMany({ where, select: { id: true, claimantId: true, createdAt: true } });
  if (claims.length === 0) return 0;
  const ids = claims.map((claim) => claim.id);

  const opened = await prisma.claimConflict.findMany({
    where: { OR: [{ submissionAId: { in: ids } }, { submissionBId: { in: ids } }] },
    select: { id: true, businessId: true, challenge: true, claims: { where: { id: { notIn: ids } }, select: { id: true } } },
  });
  if (opened.length > 0) {
    const swept = opened.flatMap((conflict) => conflict.claims.map((claim) => claim.id));
    await prisma.claimConflict.deleteMany({ where: { id: { in: opened.map((conflict) => conflict.id) } } });
    if (swept.length > 0) {
      await prisma.claimSubmission.updateMany({ where: { id: { in: swept } }, data: { contested: false } });
    }
    for (const conflict of opened) {
      if (conflict.challenge) continue;
      const stillOpen = await prisma.claimConflict.count({ where: { businessId: conflict.businessId, ...OPEN } });
      if (stillOpen === 0) {
        await prisma.business.updateMany({ where: { id: conflict.businessId, claimStatus: "disputed" }, data: { claimStatus: "unclaimed" } });
      }
    }
  }

  const since = new Date(Math.min(...claims.map((claim) => claim.createdAt.getTime())));
  await prisma.notificationDelivery.deleteMany({
    where: {
      event: { in: CLAIM_EVENTS },
      recipientUserId: { in: [...new Set(claims.map((claim) => claim.claimantId))] },
      createdAt: { gte: since },
    },
  });

  const { count } = await prisma.claimSubmission.deleteMany({ where: { id: { in: ids } } });
  return count;
}
