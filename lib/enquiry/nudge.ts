import "server-only";
import { prisma } from "@/lib/db/client";
import { canNudge, NUDGE_AFTER_MS } from "./tracking";

/**
 * A buyer asking one supplier, once, whether they are going to reply.
 *
 * Board 1i: one per recipient ever, only from `delivered`, and only after
 * twenty-four hours — the point is a single nudge, not a channel to badger
 * somebody through.
 *
 * **What the supplier sees.** This comment used to say it sent a WhatsApp. It
 * sent nothing, and nothing on any seller surface read the column it wrote, so
 * a nudge reached nobody. Since board 10e the supplier's lead inbox shows
 * *Buyer nudged you* on the unanswered lead (`LeadRailRow.nudgedAt`). A WhatsApp
 * or email is still owed: it needs its own `NotificationEvent`, a row in board
 * 7e's alert matrix and a Meta-approved template, and none of the three exists.
 *
 * The eligibility rule lives in `tracking.ts` and is shared with the render, so
 * the button a buyer can see and the action the server will accept cannot
 * disagree. The server re-checks rather than trusting the button: the request
 * arrives from a browser, and a control that was enabled a minute ago is not
 * evidence about now.
 */

export type NudgeResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "too_soon" | "already_nudged" | "wrong_state" | "closed" };

export async function nudge(input: {
  buyerId: string;
  ref: string;
  businessId: string;
  now?: Date;
}): Promise<NudgeResult> {
  const now = input.now ?? new Date();

  const recipient = await prisma.enquiryRecipient.findFirst({
    where: {
      businessId: input.businessId,
      // The buyer is part of the query, so somebody else's enquiry is a
      // `not_found` rather than a refusal that confirms it exists.
      enquiry: { ref: input.ref, buyerId: input.buyerId },
    },
    select: {
      enquiryId: true,
      businessId: true,
      state: true,
      buyerNudgedAt: true,
      createdAt: true,
      openedAt: true,
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
  if (recipient.state !== "delivered") return { ok: false, error: "wrong_state" };

  /* The same predicate the button renders from. One rule, one place. */
  if (!canNudge({ state: recipient.state, buyerNudgedAt: recipient.buyerNudgedAt, deliveredAt: recipient.createdAt }, now)) {
    return { ok: false, error: "too_soon" };
  }

  /*
     Conditional on `buyerNudgedAt` still being null, so two taps a second apart
     cannot send two WhatsApps. `updateMany` returns a count rather than
     throwing, which is what makes the race visible instead of fatal.
  */
  const { count } = await prisma.enquiryRecipient.updateMany({
    where: {
      enquiryId: recipient.enquiryId,
      businessId: recipient.businessId,
      buyerNudgedAt: null,
    },
    data: { buyerNudgedAt: now },
  });
  if (count === 0) return { ok: false, error: "already_nudged" };

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
 * conditional update rather than a loop: `buyer_nudged_at IS NULL`, still
 * `delivered`, delivered at least a day ago. A supplier nudged a moment ago from
 * the tracking page, one who opened the enquiry, and one who replied are all
 * left out by the `where` itself, so two presses — or a press racing a single
 * nudge — nudge each supplier once between them. The count returned is the
 * suppliers this press reached, which is the number the button promised.
 */
export async function nudgeUnanswered(input: { buyerId: string; ref: string; now?: Date }): Promise<NudgeAllResult> {
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

  const { count } = await prisma.enquiryRecipient.updateMany({
    where: {
      enquiryId: enquiry.id,
      state: "delivered",
      buyerNudgedAt: null,
      createdAt: { lte: new Date(now.getTime() - NUDGE_AFTER_MS) },
    },
    data: { buyerNudgedAt: now },
  });

  return count === 0 ? { ok: false, error: "nothing_to_nudge" } : { ok: true, nudged: count };
}
