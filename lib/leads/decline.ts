import "server-only";
import { prisma } from "@/lib/db/client";
import { assertCan, can } from "@/lib/auth/can";
import type { Actor } from "@/lib/auth/roles";
import { cancelFollowUp } from "@/lib/messaging/follow-up";
import { recordEvent } from "@/lib/telemetry/record";
import { workEnquiryOf } from "@/lib/quote/work-enquiry";

/**
 * Board `3j-s` — `Decline`, the supplier walking away before they reply.
 *
 * ## The state that already had a reader and no writer
 *
 * `EnquiryRecipient.state = declined` was written by one thing: the buyer
 * accepting somebody else. The buyer's tracking page had long carried the
 * sentence for the other case — *DECLINED · {the supplier's reason}* and *No
 * supplier took this one on* — reading the reason from a column that held a
 * stable code for a lost quote. So a supplier who could not take the work had
 * two options, both wrong: say nothing, which leaves the buyer waiting on a row
 * that will read *No response* when the window closes, or mark the lead lost,
 * which the buyer never sees at all. §States: *the buyer sees a decline, not
 * silence.*
 *
 * ## What it writes
 *
 * `state = declined` with `declinedAt`, `declinedById` and the reason in the
 * supplier's own words. `declinedAt` is what tells this apart from the buyer's
 * decision everywhere a declined row is read. The first reply is stamped where
 * it is not yet: the buyer has been answered, and the tracking page stops
 * counting a firm as silent the moment it says no.
 *
 * ## What it refuses
 *
 * - **After a reply that is a quote or a proposal.** The buyer is holding it and
 *   may accept it; declining would leave a live offer under a row reading
 *   *declined*. That supplier lets the window run out or messages the buyer.
 * - **Once the buyer has decided**, whoever they chose.
 * - **On a suspended listing or a closed enquiry**, where every write on the lead
 *   is already refused.
 *
 * It is final. The buyer has been shown it, and a decline that could be
 * withdrawn would be a row that changes under a buyer who already acted on it —
 * widened the area, sent to two more suppliers. The screen's confirmation says so.
 */

/** One line on the buyer's row. */
export const DECLINE_REASON_MAX = 200;

export type DeclineResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "not_your_lead"
        | "not_yours_to_decline"
        | "already_replied"
        | "already_declined"
        | "buyer_decided"
        | "suspended"
        | "closed"
        | "reason_too_long";
    };

/**
 * Who may decline: the assignee or anyone who manages routing — the same rule
 * `markOutcome` applies, because declining is closing a lead before it opens.
 */
function mayDecline(actor: Actor, assignedToId: string | null): boolean {
  if (!can(actor, "enquiry.respond")) return false;
  if (can(actor, "routing.manage")) return true;
  return assignedToId !== null && assignedToId === actor.id;
}

export async function declineLead(
  actor: Actor,
  businessId: string,
  input: { enquiryId: string; reason?: string | null; now?: Date },
): Promise<DeclineResult> {
  assertCan(actor, "enquiry.respond");
  const now = input.now ?? new Date();

  const recipient = await prisma.enquiryRecipient.findUnique({
    where: { enquiryId_businessId: { enquiryId: input.enquiryId, businessId } },
    select: {
      state: true,
      assignedToId: true,
      firstReplyAt: true,
      declinedAt: true,
      createdAt: true,
      business: { select: { suspendedAt: true } },
      enquiry: { select: { closesAt: true, contactReleasedToBusinessId: true } },
    },
  });
  if (!recipient) return { ok: false, error: "not_your_lead" };
  if (!mayDecline(actor, recipient.assignedToId)) return { ok: false, error: "not_yours_to_decline" };

  if (recipient.declinedAt) return { ok: false, error: "already_declined" };
  if (recipient.enquiry.contactReleasedToBusinessId !== null || recipient.state === "declined") {
    return { ok: false, error: "buyer_decided" };
  }
  if (recipient.business.suspendedAt) return { ok: false, error: "suspended" };
  if (recipient.enquiry.closesAt.getTime() <= now.getTime()) return { ok: false, error: "closed" };
  if (recipient.state === "quoted") return { ok: false, error: "already_replied" };

  const reason = (input.reason ?? "").replace(/\s+/g, " ").trim() || null;
  if (reason !== null && reason.length > DECLINE_REASON_MAX) return { ok: false, error: "reason_too_long" };

  const declined = await prisma.$transaction(async (tx) => {
    /*
       The enquiry row lock `acceptQuote` and every quote send take. Without it a
       decline and a send a second apart could both commit, and the buyer would
       hold a proposal from a supplier whose row reads *declined*.
    */
    await tx.$queryRaw`SELECT id FROM enquiry WHERE id = ${input.enquiryId} FOR UPDATE`;

    const { count } = await tx.enquiryRecipient.updateMany({
      where: {
        enquiryId: input.enquiryId,
        businessId,
        declinedAt: null,
        state: { in: ["delivered", "opened"] },
        enquiry: { contactReleasedToBusinessId: null },
      },
      data: {
        state: "declined",
        declinedAt: now,
        declinedById: actor.id,
        declineReason: reason,
        ...(recipient.firstReplyAt === null ? { firstReplyAt: now } : {}),
      },
    });
    if (count === 0) return false;

    // The seller's working copy is theirs to lose, and nothing can send it now.
    await tx.quote.deleteMany({ where: { enquiryId: input.enquiryId, businessId, status: "draft" } });
    return true;
  });
  if (!declined) {
    // Something moved between the read and the lock: a send, or an accept.
    const after = await prisma.enquiryRecipient.findUnique({
      where: { enquiryId_businessId: { enquiryId: input.enquiryId, businessId } },
      select: { state: true },
    });
    return { ok: false, error: after?.state === "quoted" ? "already_replied" : "buyer_decided" };
  }

  // A follow-up chasing a buyer the supplier just turned down is the most
  // avoidable message there is.
  await cancelFollowUp(input.enquiryId, businessId, "outcome_marked");

  await recordEvent({
    name: "lead_declined",
    businessId,
    actorId: actor.id,
    props: {
      hasReason: reason !== null,
      work: (await workEnquiryOf(prisma, input.enquiryId)) !== null,
      hoursSinceReceipt: Math.round((now.getTime() - recipient.createdAt.getTime()) / 3_600_000),
    },
  });

  return { ok: true };
}
