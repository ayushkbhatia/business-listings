import "server-only";
import { prisma } from "@/lib/db/client";
import { assertCan, can } from "@/lib/auth/can";
import type { Actor } from "@/lib/auth/roles";
import { recordEvent } from "@/lib/telemetry/record";

/**
 * Board 3k §5 — extending a quote's window.
 *
 * The action this board exists for. Board 3j's composer sets a validity window
 * and board 3a's queue draws an `Extend` button, and until now **nothing in the
 * product could extend anything**.
 *
 * ## What it changes, and what it deliberately does not
 *
 * The date on the sent quote. Not a price, not a line, not a version. The buyer
 * sees the new date on the quote they already hold, and **is sent nothing** —
 * extending is silent, and a seller who wants the buyer to know uses the one
 * follow-up. The card says so in as many words, because a seller who assumes it
 * messages will not send the follow-up that would have.
 *
 * ## The boundary that is the point
 *
 * An expired quote cannot be extended. A closed window reopened after the fact
 * is a different commitment at a stale price, and the row offers `Re-quote`
 * instead — board 3j's composer, preloaded from the old lines under a new ref.
 * §5: "do not soften it."
 *
 * ## The ceiling
 *
 * Sixty days from the original send. An indefinitely extended price is not a
 * quote: at some point the steel moved, and a window pushed out for a quarter is
 * a seller quietly holding a price they would not offer today. Past it, the
 * answer is a new quote rather than an older one worn thin.
 */

/** §5: the two presets, and a date picker between and beyond them. */
export const EXTEND_PRESET_DAYS = [7, 14] as const;

/** §13.1: an indefinitely extended price is not a quote. */
export const MAX_DAYS_FROM_SEND = 60;

export type ExtendResult =
  | { ok: true; expiresAt: Date; extensionCount: number }
  | {
      ok: false;
      error: "not_your_quote" | "not_yours_to_extend" | "expired" | "decided" | "too_far" | "backwards" | "suspended";
    };

/**
 * Who may extend.
 *
 * §5: the assignee, owner or manager — the same rule board 3j applies to marking
 * an outcome, answered once for both screens rather than twice. A seat that
 * cannot see a lead in the inbox must not move its window here.
 */
function mayExtend(actor: Actor, assignedToId: string | null): boolean {
  if (!can(actor, "quote.send")) return false;
  if (can(actor, "routing.manage")) return true;
  return assignedToId !== null && assignedToId === actor.id;
}

export async function extendQuote(
  actor: Actor,
  businessId: string,
  input: { quoteId: string; until: Date; now?: Date },
): Promise<ExtendResult> {
  assertCan(actor, "quote.send");
  const now = input.now ?? new Date();

  const quote = await prisma.quote.findFirst({
    where: { id: input.quoteId, businessId, status: { not: "draft" } },
    select: {
      id: true,
      enquiryId: true,
      sentAt: true,
      expiresAt: true,
      extensionCount: true,
      business: { select: { suspendedAt: true } },
    },
  });
  // An unknown quote and somebody else's give the same answer.
  if (!quote) return { ok: false, error: "not_your_quote" };

  const recipient = await prisma.enquiryRecipient.findUnique({
    where: { enquiryId_businessId: { enquiryId: quote.enquiryId, businessId } },
    select: {
      assignedToId: true,
      outcome: true,
      state: true,
      enquiry: { select: { contactReleasedToBusinessId: true } },
    },
  });
  if (!recipient) return { ok: false, error: "not_your_quote" };
  if (!mayExtend(actor, recipient.assignedToId)) return { ok: false, error: "not_yours_to_extend" };

  // §10: a suspended listing is read-only. No Extend, no Nudge.
  if (quote.business.suspendedAt) return { ok: false, error: "suspended" };

  /*
     §5: "Where it appears — any row whose window is live. Not on Won, Lost, or
     Expired rows." Both halves are checked here rather than only hidden in the
     UI, because a hidden button is not a fence.
  */
  const decided =
    recipient.outcome !== null ||
    recipient.state === "declined" ||
    recipient.enquiry.contactReleasedToBusinessId === businessId;
  if (decided) return { ok: false, error: "decided" };

  if (!quote.expiresAt || quote.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, error: "expired" };
  }

  // Extending is pushing out. A date earlier than the one the buyer holds would
  // shorten a commitment already made, which is a different act with a different
  // name, and this screen does not offer it.
  if (input.until.getTime() <= quote.expiresAt.getTime()) {
    return { ok: false, error: "backwards" };
  }

  const ceiling = new Date(
    (quote.sentAt ?? now).getTime() + MAX_DAYS_FROM_SEND * 86_400_000,
  );
  if (input.until.getTime() > ceiling.getTime()) return { ok: false, error: "too_far" };

  const daysAdded = Math.round(
    (input.until.getTime() - quote.expiresAt.getTime()) / 86_400_000,
  );
  const daysRemaining = Math.round((quote.expiresAt.getTime() - now.getTime()) / 86_400_000);

  const updated = await prisma.quote.update({
    where: { id: quote.id },
    data: {
      expiresAt: input.until,
      extensionCount: { increment: 1 },
      lastExtendedAt: now,
      extendedById: actor.id,
    },
    select: { expiresAt: true, extensionCount: true },
  });

  /*
     §11's number worth watching. `timesPreviouslyExtended` points somewhere
     else on purpose: quotes routinely extended twice mean board 3j's default
     validity window is too short, and the fix belongs in the composer.
  */
  await recordEvent({
    name: "quote_extended",
    businessId,
    actorId: actor.id,
    props: {
      daysAdded,
      daysRemaining,
      timesPreviouslyExtended: quote.extensionCount,
    },
  });

  return {
    ok: true,
    expiresAt: updated.expiresAt ?? input.until,
    extensionCount: updated.extensionCount,
  };
}

/**
 * The date a preset lands on.
 *
 * From the window's current end, not from today: `+7 days` on a quote with three
 * days left means ten days from now, which is what a seller reading "extend by a
 * week" means by it. Measuring from today would silently shorten it.
 */
export function presetDate(currentExpiry: Date, days: number): Date {
  return new Date(currentExpiry.getTime() + days * 86_400_000);
}

/** The latest date this quote may be pushed to, for the picker's `max`. */
export function ceilingFor(sentAt: Date | null, now: Date = new Date()): Date {
  return new Date((sentAt ?? now).getTime() + MAX_DAYS_FROM_SEND * 86_400_000);
}
