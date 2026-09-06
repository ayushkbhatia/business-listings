import "server-only";
import { prisma } from "@/lib/db/client";
import { onLicenceExpiring } from "@/lib/notify/events";
import { daysUntil, LICENCE_NOTICE_DAYS, LICENCE_URGENT_DAYS } from "@/lib/verification";

/**
 * The first two points of board 3e §5, which nothing performed.
 *
 * The rail on the verification screen writes the sequence out in three rows —
 * sixty days an email and a banner, fourteen days the banner stays and the row
 * turns amber, the day it lapses the tier drops and the badge goes. Only the
 * third existed: `sweepExpiredLicences` has performed the drop since it was
 * written, and a supplier's first notice of an expiry was the badge being gone.
 *
 * `document_expiring` had been declared in the enum, seeded with a live email
 * template and emitted by nothing since handoff 1. This is its emitter.
 *
 * ## Two stages, and a row each
 *
 * `notify()` deduplicates nothing, so a daily sweep over a sixty-day window
 * would send sixty emails. The guard is the delivery log — the same shape
 * `sweepSetupNudges` and `sweepExpiringQuotes` use, for the same reason: it is
 * the record of what was sent, so asking it is asking the thing that knows.
 *
 * The two stages have to be told apart inside that log, and
 * `NotificationDelivery` has no column for a stage. What it does have is
 * `createdAt` and the licence's own expiry date, so a stage is identified by
 * *when the row was written relative to the expiry*: a delivery created more
 * than fourteen days before the licence lapses was the sixty-day notice, and
 * one created inside fourteen days was the urgent one. That reads off data the
 * log already carries rather than adding a column to hold a number that is
 * derivable — and it stays correct if the constants move, because the same
 * function computes both sides.
 *
 * ## Why no audit row
 *
 * The argument `app/api/jobs/daily/route.ts` makes for every step in it:
 * `AuditEvent.actorId` is NOT NULL because the log records decisions, and a
 * platform following its own published sequence on a schedule has no actor.
 * The sequence here is published on the seller's own screen.
 *
 * ## What it will not do
 *
 * It never writes to `Business`. Not the tier, not `verifiedAt`, not a
 * "notified" flag. A licence notice is a message; the state it describes lives
 * on `licenceExpiry`, which nobody but the seller's renewal changes.
 */

export interface NoticeSweepResult {
  considered: number;
  notified: number;
  alreadySent: number;
}

export async function sweepExpiringLicences(now: Date = new Date()): Promise<NoticeSweepResult> {
  const horizon = new Date(now.getTime() + (LICENCE_NOTICE_DAYS + 1) * 86_400_000);

  /*
     Inside the window and not yet lapsed. A licence that expired last night
     belongs to `sweepExpiredLicences`, which drops the tier — there is nothing
     left to warn about, and an email saying "expires in 0 days" the morning
     after would arrive as news of something already done.

     Suspended listings are skipped for the same reason the tier sweep skips
     them: nothing about their licence is currently deciding anything.
  */
  const businesses = await prisma.business.findMany({
    where: {
      licenceExpiry: { gt: now, lte: horizon },
      suspendedAt: null,
      claimStatus: "claimed",
    },
    select: { id: true, licenceExpiry: true },
  });
  if (businesses.length === 0) return { considered: 0, notified: 0, alreadySent: 0 };

  /*
     One query for what has already gone out, not one per business. A daily job
     over the whole directory is where a per-row read becomes a thousand round
     trips.
  */
  const sent = await prisma.notificationDelivery.findMany({
    where: {
      event: "document_expiring",
      businessId: { in: businesses.map((business) => business.id) },
    },
    select: { businessId: true, createdAt: true },
  });

  const byBusiness = new Map<string, Date[]>();
  for (const row of sent) {
    if (!row.businessId) continue;
    const list = byBusiness.get(row.businessId);
    if (list) list.push(row.createdAt);
    else byBusiness.set(row.businessId, [row.createdAt]);
  }

  let notified = 0;
  let alreadySent = 0;

  for (const business of businesses) {
    const days = daysUntil(business.licenceExpiry, now);
    const stage = days <= LICENCE_URGENT_DAYS ? LICENCE_URGENT_DAYS : LICENCE_NOTICE_DAYS;

    const already = (byBusiness.get(business.id) ?? []).some(
      (at) => stageOf(business.licenceExpiry, at) === stage,
    );
    if (already) {
      alreadySent += 1;
      continue;
    }

    await onLicenceExpiring({
      businessId: business.id,
      expiresAt: business.licenceExpiry,
      days,
    });
    notified += 1;
  }

  return { considered: businesses.length, notified, alreadySent };
}

/**
 * Which stage a delivery already in the log belonged to.
 *
 * Read off the gap between when it was written and when the licence lapses,
 * because that is what the log records. A row written 41 days out was the
 * sixty-day notice; one written 9 days out was the urgent one.
 */
function stageOf(licenceExpiry: Date, sentAt: Date): number {
  return daysUntil(licenceExpiry, sentAt) <= LICENCE_URGENT_DAYS
    ? LICENCE_URGENT_DAYS
    : LICENCE_NOTICE_DAYS;
}
