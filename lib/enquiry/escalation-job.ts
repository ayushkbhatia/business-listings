import "server-only";
import { prisma } from "@/lib/db/client";
import { onEnquiryEscalated } from "@/lib/notify/events";

/**
 * Board 8d §8 — "anything unanswered for two hours escalates to you".
 *
 * That sentence is on the setup screen next to a paragraph telling the seller
 * their ranking depends on reply time, which is why §8 says an unkept version
 * of it is worse here than almost anywhere. This is the job that keeps it.
 *
 * ## What "unanswered" means, and what it cannot mean yet
 *
 * The promise escalates **to the owner**, so it needs no assignment — and that
 * matters, because there is none to have: `EnquiryRecipient` carries no
 * assignee, and `Business.leadRouting` is stored and applied nowhere. Round
 * robin does not currently route anything.
 *
 * So this reads exactly what the sentence says: an enquiry that reached this
 * business, has no first reply, and is older than the business's own
 * `leadEscalationMinutes`. When routing does start assigning, the escalation
 * gains an assignee to name and this query gains a join — the threshold and the
 * once-only rule do not move.
 *
 * ## Once per enquiry, ever
 *
 * `notify()` performs no deduplication — it never reads `NotificationDelivery`
 * before writing — so the guard is here, and it is the existence of a delivery
 * row for this event and this enquiry. Without it an owner with one slow
 * enquiry is paged every hour until they answer, which is the fastest way to
 * make somebody turn notifications off.
 *
 * The check is a read followed by a write, and that is acceptable for the same
 * reason it is on the setup nudge: the sweep is hourly and single-writer, so the
 * window is a run overlapping itself, and the cost of losing that race is one
 * duplicate message rather than a wrong state.
 */

/**
 * How far back to look.
 *
 * Without a floor the first run after deploy escalates every unanswered enquiry
 * in the history of the directory, which for a seeded database is hundreds of
 * messages to real owners. A week is comfortably past any threshold a seller
 * would set and short enough that the backlog is not a broadcast.
 */
const LOOK_BACK_DAYS = 7;

/** Nothing this small is a threshold a seller meant to set. */
const MIN_MINUTES = 5;

export interface EscalationSweep {
  considered: number;
  escalated: number;
  /** Already escalated on an earlier run. The guard doing its job. */
  alreadySent: number;
}

export async function sweepEscalations(now: Date = new Date()): Promise<EscalationSweep> {
  const floor = new Date(now.getTime() - LOOK_BACK_DAYS * 86_400_000);

  /*
     Delivered or opened, never quoted. `quoted` means the seller has answered
     with the thing the enquiry asked for — `firstReplyAt` is the stricter test
     and both are applied, because a quote sent without a message is still an
     answer and escalating it would be the product not reading its own tables.
  */
  const waiting = await prisma.enquiryRecipient.findMany({
    where: {
      firstReplyAt: null,
      state: { in: ["delivered", "opened"] },
      createdAt: { gte: floor, lte: new Date(now.getTime() - MIN_MINUTES * 60_000) },
      business: { suspendedAt: null },
    },
    select: {
      enquiryId: true,
      businessId: true,
      createdAt: true,
      business: { select: { leadEscalationMinutes: true } },
    },
    take: 500,
  });

  let escalated = 0;
  let alreadySent = 0;

  for (const row of waiting) {
    const minutes = Math.max(MIN_MINUTES, row.business.leadEscalationMinutes);
    const dueAt = row.createdAt.getTime() + minutes * 60_000;
    if (now.getTime() < dueAt) continue;

    const already = await prisma.notificationDelivery.findFirst({
      where: {
        event: "enquiry_escalated",
        businessId: row.businessId,
        enquiryId: row.enquiryId,
      },
      select: { id: true },
    });
    if (already) {
      alreadySent += 1;
      continue;
    }

    // One business failing must not stop the sweep — a carrier refusing for one
    // supplier is not a reason for every other owner to hear nothing.
    try {
      await onEnquiryEscalated({
        enquiryId: row.enquiryId,
        businessId: row.businessId,
        minutes,
      });
      escalated += 1;
    } catch (error) {
      console.error("[escalation] could not escalate", {
        businessId: row.businessId,
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  return { considered: waiting.length, escalated, alreadySent };
}
