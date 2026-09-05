import "server-only";
import { prisma } from "@/lib/db/client";
import type { LeadScope } from "@/lib/leads/inbox";

/**
 * Board 3k §7 — "your reply speed and your outcomes".
 *
 * The argument for answering quickly, made out of the seller's own record rather
 * than a claim about sellers in general. Two buckets, each a count of resolved
 * quotes and how many of them the seller marked won.
 *
 * ## Counts, not rates
 *
 * §8.1, and it is the whole discipline of this card. The board read `61% won`
 * over 23 resolved quotes split into buckets of 13 and 10 — a percentage on
 * thirteen observations is a number that swings eight points when one deal
 * lands, and it was the same unsourced figure already cut from board 3j.
 *
 * So the card says `8 of 13`. A reader can do the division; what they cannot do
 * is un-see a percentage that implies a precision the sample does not have.
 *
 * ## What "resolved" means, and why unresolved quotes are excluded
 *
 * A quote still awaiting a decision has no outcome to attribute to speed, so it
 * is in neither bucket and in neither denominator. Including them would put
 * every recent, fast, undecided quote in the slow bucket's favour by simply not
 * being lost yet.
 *
 * ## Won is what the seller marked
 *
 * §8.3. We take no payment and never see the order, so every outcome here is
 * seller-reported and the card is captioned as such. The one exception is the
 * buyer's own acceptance, which the platform does observe — it counts as won
 * for the same reason board 3k's `Won` tab counts it.
 */

/** §7's two buckets. Everything between them is in neither. */
export const FAST_HOURS = 2;
export const SLOW_HOURS = 6;

export interface SpeedBucket {
  /** Resolved quotes that were sent inside (or outside) the boundary. */
  resolved: number;
  won: number;
}

export interface SpeedCard {
  fast: SpeedBucket;
  slow: SpeedBucket;
  /** Expired quotes, and how many were sent more than a day after the enquiry. */
  expired: number;
  expiredAfterADay: number;
  /** True when there is nothing measured yet, so the card says so rather than zeroes. */
  empty: boolean;
}

/**
 * How long the seller took to answer, in hours.
 *
 * From the enquiry reaching them to their first reply, which is the same pair
 * `lib/metrics/job.ts` measures the median from — one definition of response
 * time, not two.
 */
function hoursToReply(createdAt: Date, firstReplyAt: Date): number {
  return (firstReplyAt.getTime() - createdAt.getTime()) / 3_600_000;
}

function scopeWhere(scope: LeadScope) {
  switch (scope.kind) {
    case "all":
      return {};
    case "unassigned":
      return { assignedToId: null };
    case "mine":
    case "seat":
      return { assignedToId: scope.userId };
  }
}

export async function replySpeed(input: {
  businessId: string;
  scope: LeadScope;
  now?: Date;
}): Promise<SpeedCard> {
  const now = input.now ?? new Date();

  const recipients = await prisma.enquiryRecipient.findMany({
    where: {
      businessId: input.businessId,
      ...scopeWhere(input.scope),
      firstReplyAt: { not: null },
      enquiry: { quotes: { some: { businessId: input.businessId, status: { not: "draft" } } } },
    },
    select: {
      createdAt: true,
      firstReplyAt: true,
      outcome: true,
      state: true,
      enquiry: {
        select: {
          contactReleasedToBusinessId: true,
          quotes: {
            where: { businessId: input.businessId, status: { not: "draft" } },
            orderBy: { revision: "desc" },
            take: 1,
            select: { expiresAt: true },
          },
        },
      },
    },
  });

  const card: SpeedCard = {
    fast: { resolved: 0, won: 0 },
    slow: { resolved: 0, won: 0 },
    expired: 0,
    expiredAfterADay: 0,
    empty: true,
  };

  for (const r of recipients) {
    if (!r.firstReplyAt) continue;
    const hours = hoursToReply(r.createdAt, r.firstReplyAt);

    const observedWin = r.enquiry.contactReleasedToBusinessId === input.businessId;
    const won = r.outcome === "won" || (r.outcome === null && observedWin);
    const lost = r.outcome === "lost" || (r.outcome === null && r.state === "declined");
    const expiry = r.enquiry.quotes[0]?.expiresAt ?? null;
    const expired =
      !won && !lost && expiry !== null && expiry.getTime() <= now.getTime();

    if (expired) {
      card.expired += 1;
      // §7's plain-language read: how many of the dead ones were slow.
      if (hours > 24) card.expiredAfterADay += 1;
    }

    /*
       Resolved means decided one way or the other. A quote still awaiting a
       decision has no outcome to attribute to speed, and counting it would flatter
       whichever bucket happens to hold the newest work.

       An expired quote is resolved — the window closed with nobody accepting,
       which is an answer even though nobody gave it.
    */
    if (!won && !lost && !expired) continue;

    const bucket = hours <= FAST_HOURS ? card.fast : hours >= SLOW_HOURS ? card.slow : null;
    if (!bucket) continue; // Between the two boundaries: measured, not claimed about.

    bucket.resolved += 1;
    if (won) bucket.won += 1;
    card.empty = false;
  }

  return card;
}
