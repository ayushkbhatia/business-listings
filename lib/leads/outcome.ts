import "server-only";
import { prisma } from "@/lib/db/client";
import { assertCan, can } from "@/lib/auth/can";
import type { Actor } from "@/lib/auth/roles";
import { cancelFollowUp } from "@/lib/messaging/follow-up";
import { recordEvent } from "@/lib/telemetry/record";

/**
 * Board 3j — `Mark won` and `Mark lost`.
 *
 * The board counted `Won 14` over a screen with nothing that could produce the
 * number: `Quote.status` accepted/lost and `EnquiryRecipient.state = declined`
 * are all written by the BUYER accepting somebody, and `lostReason` has one
 * writer with one value. So the seller's outcome is its own column.
 *
 * ## It carries no amount
 *
 * The handoff asks for a prompted, seller-reported figure so that board 3a's
 * quoted-value card has something to add up. CLAUDE.md lists quoted value among
 * the derived metrics that have **no writable path**, next to response time and
 * profile strength, and the reason is the one this whole directory rests on:
 * *measured beats claimed, and a seller-editable field is neither.*
 *
 * `Business.quotedValueAed` already exists and is written by nothing but the
 * seed. A second writable column would not make the first true; it would give
 * the card a number a seller typed. Quoted value stays the sum of accepted quote
 * lines, which is a fact.
 *
 * ## What the seller may overrule, and what they may not
 *
 * A seller may mark a lead they quoted as won or lost — that is their own
 * commercial record, and often the platform never learns the outcome because
 * the buyer simply stopped replying.
 *
 * They may not contradict the buyer. Once the buyer has accepted this supplier's
 * quote, `contactReleasedToBusinessId` says so and the contact details have been
 * released on the strength of it; marking that lead lost would put a different
 * word on the same event. The refusal is explicit rather than silent.
 */

export type Outcome = "won" | "lost";

export type OutcomeResult =
  | { ok: true; outcome: Outcome | null }
  | { ok: false; error: "not_your_lead" | "not_yours_to_mark" | "buyer_decided" | "not_quoted" };

/**
 * Who may mark one.
 *
 * 3j question 5: the assignee and any manager, not every seat. A sales seat
 * closing their own lead is the normal case; a sales seat closing a colleague's
 * is not, and neither is a seat that cannot reply to enquiries at all.
 */
function mayMark(actor: Actor, assignedToId: string | null): boolean {
  if (!can(actor, "enquiry.respond")) return false;
  if (can(actor, "routing.manage")) return true;
  return assignedToId !== null && assignedToId === actor.id;
}

export async function markOutcome(
  actor: Actor,
  businessId: string,
  input: { enquiryId: string; outcome: Outcome; reason?: string; now?: Date },
): Promise<OutcomeResult> {
  assertCan(actor, "enquiry.respond");
  const now = input.now ?? new Date();

  const recipient = await prisma.enquiryRecipient.findUnique({
    where: { enquiryId_businessId: { enquiryId: input.enquiryId, businessId } },
    select: {
      state: true,
      assignedToId: true,
      enquiry: { select: { contactReleasedToBusinessId: true } },
    },
  });
  if (!recipient) return { ok: false, error: "not_your_lead" };
  if (!mayMark(actor, recipient.assignedToId)) return { ok: false, error: "not_yours_to_mark" };

  /*
     The buyer has already decided this one, and the decision released contact
     details on the strength of it. A seller marking it lost would leave two
     words on one event and a released phone number explained by neither.
  */
  if (recipient.enquiry.contactReleasedToBusinessId === businessId && input.outcome === "lost") {
    return { ok: false, error: "buyer_decided" };
  }

  /*
     Nothing to win or lose before a quote. A lead marked won without one is a
     deal done off the record, which the product cannot see and should not
     pretend to — and `Won` is the tab board 3a's quoted-value card reads.
  */
  if (recipient.state !== "quoted" && recipient.enquiry.contactReleasedToBusinessId !== businessId) {
    return { ok: false, error: "not_quoted" };
  }

  const reason = input.reason?.trim() || null;

  await prisma.enquiryRecipient.update({
    where: { enquiryId_businessId: { enquiryId: input.enquiryId, businessId } },
    data: {
      outcome: input.outcome,
      outcomeAt: now,
      outcomeById: actor.id,
      // Only meaningful on a loss. A reason kept against a win would read as an
      // explanation for something nobody asked about.
      outcomeReason: input.outcome === "lost" ? reason : null,
    },
  });

  // Board 11b §4: an outcome cancels the follow-up. Chasing a buyer about a
  // deal the seller has already closed is the most avoidable message we send.
  await cancelFollowUp(input.enquiryId, businessId, "outcome_marked");

  await recordEvent({
    name: "outcome_marked",
    businessId,
    actorId: actor.id,
    props: {
      outcome: input.outcome,
      hadQuote: recipient.state === "quoted",
      hasReason: reason !== null,
    },
  });

  return { ok: true, outcome: input.outcome };
}

/**
 * Put a lead back in the working list.
 *
 * 3j §7: "Reopening requires clearing the outcome." A separate act rather than
 * an implicit one — a composer that quietly came back to life when somebody
 * clicked into a closed lead is how a seller sends a quote on a deal they had
 * already written off.
 *
 * It does not re-arm the follow-up. That was spent or cancelled, and board 11b
 * gives one per lead rather than one per attempt at the lead.
 */
export async function clearOutcome(
  actor: Actor,
  businessId: string,
  input: { enquiryId: string },
): Promise<OutcomeResult> {
  assertCan(actor, "enquiry.respond");

  const recipient = await prisma.enquiryRecipient.findUnique({
    where: { enquiryId_businessId: { enquiryId: input.enquiryId, businessId } },
    select: { assignedToId: true, outcome: true },
  });
  if (!recipient) return { ok: false, error: "not_your_lead" };
  if (!mayMark(actor, recipient.assignedToId)) return { ok: false, error: "not_yours_to_mark" };

  await prisma.enquiryRecipient.update({
    where: { enquiryId_businessId: { enquiryId: input.enquiryId, businessId } },
    data: { outcome: null, outcomeAt: null, outcomeById: null, outcomeReason: null },
  });

  return { ok: true, outcome: null };
}
