import "server-only";
import { prisma } from "@/lib/db/client";
import { canNudge, type TrackedRecipient } from "./tracking";

/**
 * A buyer asking one supplier, once, whether they are going to reply.
 *
 * Board 1i: one per recipient ever, only from `delivered`, and only after
 * twenty-four hours. Sends one WhatsApp and nothing else — the point is a
 * single nudge, not a channel to badger somebody through.
 *
 * The eligibility rule lives in `tracking.ts` and is shared with the render, so
 * the button a buyer can see and the action the server will accept cannot
 * disagree. The server re-checks rather than trusting the button: the request
 * arrives from a browser, and a control that was enabled a minute ago is not
 * evidence about now.
 */

export type NudgeResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "too_soon" | "already_nudged" | "wrong_state" };

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
    },
  });
  if (!recipient) return { ok: false, error: "not_found" };
  if (recipient.buyerNudgedAt) return { ok: false, error: "already_nudged" };
  if (recipient.state !== "delivered") return { ok: false, error: "wrong_state" };

  /* The same predicate the button renders from. One rule, one place. */
  const asTracked = {
    state: recipient.state,
    buyerNudgedAt: recipient.buyerNudgedAt,
    deliveredAt: recipient.createdAt,
  } as TrackedRecipient;
  if (!canNudge(asTracked, now)) return { ok: false, error: "too_soon" };

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
