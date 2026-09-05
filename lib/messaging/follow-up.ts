import "server-only";
import { prisma } from "@/lib/db/client";
import { onSellerMessage } from "@/lib/notify/events";
import { recordEvent } from "@/lib/telemetry/record";
import { detectOffPlatform, describeVerdict } from "./off-platform";

/**
 * The one follow-up a seller gets, and the schedule that sends it.
 *
 * ## What was here before
 *
 * `nudge()` stamped a column and returned. No message row, no notification,
 * nothing reaching the buyer — and the rail then rendered "Follow-up sent
 * {when}" over it. A seller reading that screen believed they had chased a
 * quiet buyer and had not. This module is that promise made true.
 *
 * It also ends a second defect: `nudgedAt` was written by two services for two
 * different actors. `lib/enquiry/nudge.ts` writes `buyerNudgedAt` when a BUYER
 * prods a supplier who has not answered; this writes `sellerNudgedAt`. One
 * column meant a buyer's nudge spent the seller's only follow-up.
 *
 * ## One, and the schema says so
 *
 * Board 11b: a second follow-up loses more deals than it wins, and the rail
 * says so out loud. `sellerNudgedAt` is a timestamp rather than a counter for
 * that reason — the schema cannot express "three nudges", so no future screen
 * can offer them. The guard is a conditional `updateMany`, not a read-then-
 * write, so two taps a second apart cannot send two messages.
 *
 * ## Why the body is stored rather than composed at send time
 *
 * 11b requires the draft to be editable *before* it goes, and to carry no
 * price, discount or deadline the seller did not type. A body written by the
 * job at three in the morning is text the seller never saw, which is exactly
 * the commitment-on-your-behalf the board's §3 correction removed. So the
 * seller's words are stored when they schedule it, and the job only sends.
 */

/** Board 11b: 24 hours after the last seller message, if the buyer has not replied. */
export const DEFAULT_NUDGE_AFTER_HOURS = 24;

/** Nothing shorter is a delay a seller meant to set. */
const MIN_NUDGE_HOURS = 1;
const MAX_NUDGE_HOURS = 168;

export type ScheduleResult =
  | { ok: true; dueAt: Date }
  | { ok: false; error: "not_a_participant" | "already_nudged" | "no_quote_yet" | "empty" };

/**
 * Arm the follow-up.
 *
 * Refuses before a quote exists for the same reason the button did: there is
 * nothing to follow up on, and a reminder about a message the seller has not
 * sent is a reminder about nothing.
 */
export async function scheduleFollowUp(input: {
  enquiryId: string;
  businessId: string;
  body: string;
  afterHours?: number;
  now?: Date;
}): Promise<ScheduleResult> {
  const now = input.now ?? new Date();
  const body = input.body.trim();
  if (!body) return { ok: false, error: "empty" };

  const recipient = await prisma.enquiryRecipient.findUnique({
    where: { enquiryId_businessId: { enquiryId: input.enquiryId, businessId: input.businessId } },
    select: { sellerNudgedAt: true, state: true },
  });
  if (!recipient) return { ok: false, error: "not_a_participant" };
  if (recipient.sellerNudgedAt) return { ok: false, error: "already_nudged" };
  if (recipient.state !== "quoted") return { ok: false, error: "no_quote_yet" };

  const hours = Math.min(
    MAX_NUDGE_HOURS,
    Math.max(MIN_NUDGE_HOURS, input.afterHours ?? DEFAULT_NUDGE_AFTER_HOURS),
  );
  const dueAt = new Date(now.getTime() + hours * 3_600_000);

  await prisma.enquiryRecipient.update({
    where: { enquiryId_businessId: { enquiryId: input.enquiryId, businessId: input.businessId } },
    data: { nudgeDueAt: dueAt, nudgeBody: body },
  });

  await recordEvent({
    name: "follow_up_scheduled",
    businessId: input.businessId,
    props: { hours },
  });

  return { ok: true, dueAt };
}

/**
 * Disarm it.
 *
 * Called on every event board 11b §4 lists: the buyer replies, the enquiry
 * closes, an outcome is marked. Clearing both columns is the whole cancellation
 * — there is no "cancelled" state to leave behind, because a follow-up that
 * will not send and one that was never armed are the same thing to every reader.
 *
 * Idempotent, and deliberately silent about whether it found anything. Every
 * caller is a side effect of something else succeeding, and none of them should
 * fail because there was no reminder to cancel.
 */
export async function cancelFollowUp(
  enquiryId: string,
  businessId: string,
  reason: "buyer_replied" | "outcome_marked" | "closed" | "seller_cancelled" = "seller_cancelled",
): Promise<void> {
  const { count } = await prisma.enquiryRecipient.updateMany({
    where: { enquiryId, businessId, nudgeDueAt: { not: null } },
    data: { nudgeDueAt: null, nudgeBody: null },
  });

  /*
     Only when something was actually disarmed. Board 11b's number worth
     watching is the follow-up's reply rate, and a cancellation because the
     buyer answered first is a *success* of the feature rather than a use of it
     — so it has to be countable, and a row written every time nothing happened
     would drown it.
  */
  if (count > 0) {
    await recordEvent({ name: "follow_up_cancelled", businessId, props: { reason } });
  }
}

export type SendResult =
  | { ok: true; messageId: string }
  | { ok: false; error: "not_a_participant" | "already_nudged" | "no_quote_yet" | "empty" | "replied" };

/**
 * Send it — now, whether the seller pressed the button or the sweep did.
 *
 * One path for both, so a follow-up sent by hand and one sent by the schedule
 * are the same row with the same tag. The alternative — a manual send that
 * writes a message and a job that writes a different one — is how two things
 * called the same feature start to differ.
 *
 * ## Why it re-checks that the buyer is still quiet
 *
 * The sweep reads a due date that was set a day earlier. In between, a buyer may
 * have replied and `cancelFollowUp` may have raced with this read. So the last
 * word is a query for a buyer message newer than the seller's last one, and the
 * write is conditional on `sellerNudgedAt` still being null.
 */
export async function sendFollowUp(input: {
  enquiryId: string;
  businessId: string;
  senderId: string;
  body?: string;
  /**
   * Which surface sent it. Board 3k reaches this from the pipeline as well as
   * from the thread, and it is the same act — one message, one tag, one cap. A
   * second service for the second surface is how one feature becomes two that
   * disagree about the cap.
   */
  source?: "thread" | "pipeline" | "sweep";
  now?: Date;
}): Promise<SendResult> {
  const now = input.now ?? new Date();

  const recipient = await prisma.enquiryRecipient.findUnique({
    where: { enquiryId_businessId: { enquiryId: input.enquiryId, businessId: input.businessId } },
    select: { sellerNudgedAt: true, state: true, nudgeBody: true },
  });
  if (!recipient) return { ok: false, error: "not_a_participant" };
  if (recipient.sellerNudgedAt) return { ok: false, error: "already_nudged" };
  if (recipient.state !== "quoted") return { ok: false, error: "no_quote_yet" };

  const body = (input.body ?? recipient.nudgeBody ?? "").trim();
  if (!body) return { ok: false, error: "empty" };

  if (await buyerHasRepliedSince(input.enquiryId, input.businessId)) {
    await cancelFollowUp(input.enquiryId, input.businessId, "buyer_replied");
    return { ok: false, error: "replied" };
  }

  /*
     The same detector every other message goes through. A follow-up is text a
     seller typed, so it can carry an IBAN exactly as any other message can, and
     exempting it would make the automatic path the way around the check.
  */
  const verdict = detectOffPlatform(body, { contactReleased: false });

  const sent = await prisma.$transaction(async (tx) => {
    // Conditional, so two sweeps overlapping cannot both send.
    const claimed = await tx.enquiryRecipient.updateMany({
      where: {
        enquiryId: input.enquiryId,
        businessId: input.businessId,
        sellerNudgedAt: null,
      },
      data: { sellerNudgedAt: now, nudgeDueAt: null, nudgeBody: null },
    });
    if (claimed.count === 0) return null;

    const message = await tx.message.create({
      data: {
        enquiryId: input.enquiryId,
        businessId: input.businessId,
        senderId: input.senderId,
        body,
        // Board 11b tags it on screen. A buyer replying to a person deserves to
        // know when they did not get one.
        automatic: true,
        flaggedAt: verdict.flag ? now : null,
      },
      select: { id: true },
    });

    if (verdict.report) {
      await tx.supplierReport.create({
        data: {
          subjectBusinessId: input.businessId,
          reporterId: null,
          kind: "off_platform_payment",
          subjectField: `message:${message.id}`,
          detail: describeVerdict(verdict, body),
        },
      });
    }

    return message.id;
  });

  if (sent === null) return { ok: false, error: "already_nudged" };

  // Outside the transaction: a carrier being slow must not hold one open.
  await onSellerMessage({
    enquiryId: input.enquiryId,
    businessId: input.businessId,
    body,
  });

  await recordEvent({
    name: "follow_up_sent",
    businessId: input.businessId,
    actorId: input.senderId,
    props: {
      // Whether the schedule sent it or the seller pressed the button. The two
      // are the same row and the same tag; only this tells them apart.
      scheduled: input.body === undefined,
      source: input.source ?? (input.body === undefined ? "sweep" : "thread"),
    },
  });

  return { ok: true, messageId: sent };
}

/**
 * Has the buyer said anything since the seller last did?
 *
 * Board 11b cancels the follow-up when the buyer replies, and "replies" means
 * after the thing being followed up on. A buyer message from before the quote
 * is not a reply to it.
 */
async function buyerHasRepliedSince(enquiryId: string, businessId: string): Promise<boolean> {
  const [lastSeller, lastBuyer] = await Promise.all([
    prisma.message.findFirst({
      where: { enquiryId, businessId, sender: { businessId } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.message.findFirst({
      // Not this business's seats — the same test `getThread` uses to decide
      // which side of the thread a message sits on.
      where: { enquiryId, businessId, NOT: { sender: { businessId } } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  if (!lastBuyer) return false;
  if (!lastSeller) return true;
  return lastBuyer.createdAt.getTime() > lastSeller.createdAt.getTime();
}

export interface FollowUpSweep {
  due: number;
  sent: number;
  /** Cancelled on the way — the buyer replied, or the enquiry closed. */
  dropped: number;
}

/**
 * The hourly pass.
 *
 * Joined to `/api/jobs/sweep` beside the escalation sweep, which is the other
 * half of the same clock: one chases a seller who has not answered a buyer, this
 * chases a buyer who has not answered a seller.
 *
 * Bounded at 200 a run. The queue is followed-up leads rather than the whole
 * table — `enquiry_recipient_nudge_due_idx` is partial on `nudge_due_at IS NOT
 * NULL` — and an hourly job that cannot finish is worse than one that catches up
 * on the next tick.
 */
export async function sweepFollowUps(now: Date = new Date()): Promise<FollowUpSweep> {
  const due = await prisma.enquiryRecipient.findMany({
    where: {
      nudgeDueAt: { lte: now },
      sellerNudgedAt: null,
      state: "quoted",
      business: { suspendedAt: null },
    },
    select: {
      enquiryId: true,
      businessId: true,
      nudgeBody: true,
      enquiry: { select: { closesAt: true, buyerId: true } },
      business: { select: { team: { where: { roles: { has: "seller_owner" } }, select: { id: true }, take: 1 } } },
    },
    take: 200,
  });

  let sent = 0;
  let dropped = 0;

  for (const row of due) {
    /*
       A closed enquiry gets no follow-up. The buyer is not weighing quotes any
       more, and `postMessage` would refuse it anyway for everyone but the
       accepted pair — a message the thread will not take is not a message.
    */
    if (row.enquiry.closesAt.getTime() < now.getTime()) {
      await cancelFollowUp(row.enquiryId, row.businessId, "closed");
      dropped += 1;
      continue;
    }

    /*
       Sent as the owner seat. The follow-up is the business speaking rather than
       a person — nobody typed it at this hour — and `Message.senderId` is NOT
       NULL, so it needs an author. The `AUTOMATIC` tag is what tells the buyer
       which it was.
    */
    const owner = row.business.team[0];
    if (!owner) {
      await cancelFollowUp(row.enquiryId, row.businessId);
      dropped += 1;
      continue;
    }

    // One failure must not stop the sweep: a carrier refusing for one supplier
    // is no reason for every other buyer to hear nothing.
    try {
      const result = await sendFollowUp({
        enquiryId: row.enquiryId,
        businessId: row.businessId,
        senderId: owner.id,
        source: "sweep",
        now,
      });
      if (result.ok) sent += 1;
      else dropped += 1;
    } catch (cause) {
      console.error("[follow-up] send failed", { enquiryId: row.enquiryId, cause });
      dropped += 1;
    }
  }

  return { due: due.length, sent, dropped };
}
