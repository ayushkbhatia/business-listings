import "server-only";
import { prisma } from "@/lib/db/client";
import { onSuppliersNudged } from "@/lib/notify/events";
import { recordEvent } from "@/lib/telemetry/record";
import { canNudge, NUDGE_AFTER_MS, NUDGEABLE_STATES } from "./tracking";

/**
 * A buyer asking a supplier, once, whether they are going to reply.
 *
 * Board 1i: one per recipient ever, and only after twenty-four hours — the
 * point is a single nudge, not a channel to badger somebody through. Since
 * board `1n` it reaches any supplier who has not answered, opened or not; see
 * `canNudge`, which the button and this service both read so the control a
 * buyer can see and the action the server will accept cannot disagree.
 *
 * **What the supplier sees.** Since board 10e, *Buyer nudged you* on the lead
 * rail. Since board `1n` (`B10`), also the `enquiry_nudged` notification — in
 * app always (`PLATFORM_FLOOR`), by email or WhatsApp where the seller chose on
 * 7e — worded as a reminder about the enquiry they already hold, never as a new
 * one. It is the carrier this comment used to say was owed.
 *
 * The server re-checks rather than trusting the button: the request arrives
 * from a browser, and a control that was enabled a minute ago is not evidence
 * about now.
 */

/** Which screen the nudge was pressed on, for telemetry only. */
export type NudgeSource = "compare" | "tracking" | "inbox";

export type NudgeResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "too_soon" | "already_nudged" | "wrong_state" | "closed" };

export async function nudge(input: {
  buyerId: string;
  ref: string;
  businessId: string;
  now?: Date;
  source?: NudgeSource;
}): Promise<NudgeResult> {
  const now = input.now ?? new Date();

  const recipient = await prisma.enquiryRecipient.findFirst({
    where: {
      businessId: input.businessId,
      // The buyer is part of the query, so somebody else's enquiry is a
      // `not_found` rather than a refusal that confirms it exists. A reference
      // or an id, like every route under `/enquiry/:id`.
      enquiry: { OR: [{ ref: input.ref }, { id: input.ref }], buyerId: input.buyerId },
    },
    select: {
      enquiryId: true,
      businessId: true,
      state: true,
      buyerNudgedAt: true,
      firstReplyAt: true,
      createdAt: true,
      enquiry: { select: { closesAt: true, contactReleasedToBusinessId: true } },
    },
  });
  if (!recipient) return { ok: false, error: "not_found" };
  // A nudge asks for a quote the buyer can still use. Found by board 10e: the
  // rule never checked, so a closed or accepted enquiry could still be nudged.
  if (recipient.enquiry.contactReleasedToBusinessId || recipient.enquiry.closesAt.getTime() <= now.getTime()) {
    return { ok: false, error: "closed" };
  }
  if (recipient.buyerNudgedAt) return { ok: false, error: "already_nudged" };
  if (!(NUDGEABLE_STATES as readonly string[]).includes(recipient.state) || recipient.firstReplyAt) {
    return { ok: false, error: "wrong_state" };
  }

  /* The same predicate the button renders from. One rule, one place. */
  if (
    !canNudge(
      { state: recipient.state, buyerNudgedAt: recipient.buyerNudgedAt, deliveredAt: recipient.createdAt, repliedAt: recipient.firstReplyAt },
      now,
    )
  ) {
    return { ok: false, error: "too_soon" };
  }

  /*
     Conditional on `buyerNudgedAt` still being null, so two taps a second apart
     cannot send two messages. `updateMany` returns a count rather than
     throwing, which is what makes the race visible instead of fatal.
  */
  const { count } = await prisma.enquiryRecipient.updateMany({
    where: {
      enquiryId: recipient.enquiryId,
      businessId: recipient.businessId,
      buyerNudgedAt: null,
      firstReplyAt: null,
      state: { in: [...NUDGEABLE_STATES] },
    },
    data: { buyerNudgedAt: now },
  });
  if (count === 0) return { ok: false, error: "already_nudged" };

  await onSuppliersNudged({ enquiryId: recipient.enquiryId, businessIds: [recipient.businessId] });
  await recordEvent({
    name: "suppliers_nudged",
    actorId: input.buyerId,
    props: { source: input.source ?? "tracking", count: 1 },
  });
  return { ok: true };
}

export type NudgeAllResult =
  | { ok: true; nudged: number }
  | { ok: false; error: "not_found" | "closed" | "nothing_to_nudge" };

/**
 * Board 10e `B5` — *Nudge 6 sellers*: every supplier on one enquiry who may
 * still be nudged, in one press.
 *
 * The same rule as the single nudge, and the same guarantee, held by one
 * conditional update rather than a loop: `buyer_nudged_at IS NULL`, not yet
 * answered, delivered at least a day ago. A supplier nudged a moment ago from
 * the tracking page and one who replied are both left out by the `where`
 * itself, so two presses — or a press racing a single nudge — nudge each
 * supplier once between them. The rows come back from the same statement, so
 * the carrier reaches exactly the suppliers this press nudged, and the count
 * returned is the number the button promised.
 */
export async function nudgeUnanswered(input: {
  buyerId: string;
  ref: string;
  now?: Date;
  source?: NudgeSource;
}): Promise<NudgeAllResult> {
  const now = input.now ?? new Date();

  const enquiry = await prisma.enquiry.findFirst({
    // The buyer is in the query: somebody else's reference is not found.
    where: { OR: [{ ref: input.ref }, { id: input.ref }], buyerId: input.buyerId },
    select: { id: true, closesAt: true, contactReleasedToBusinessId: true },
  });
  if (!enquiry) return { ok: false, error: "not_found" };
  if (enquiry.contactReleasedToBusinessId || enquiry.closesAt.getTime() <= now.getTime()) {
    return { ok: false, error: "closed" };
  }

  const nudged = await prisma.enquiryRecipient.updateManyAndReturn({
    where: {
      enquiryId: enquiry.id,
      state: { in: [...NUDGEABLE_STATES] },
      firstReplyAt: null,
      buyerNudgedAt: null,
      createdAt: { lte: new Date(now.getTime() - NUDGE_AFTER_MS) },
    },
    data: { buyerNudgedAt: now },
    select: { businessId: true },
  });
  if (nudged.length === 0) return { ok: false, error: "nothing_to_nudge" };

  await onSuppliersNudged({ enquiryId: enquiry.id, businessIds: nudged.map((row) => row.businessId) });
  await recordEvent({
    name: "suppliers_nudged",
    actorId: input.buyerId,
    props: { source: input.source ?? "inbox", count: nudged.length },
  });
  return { ok: true, nudged: nudged.length };
}
