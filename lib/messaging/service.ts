import "server-only";
import { prisma } from "@/lib/db/client";
import { assertCan } from "@/lib/auth/can";
import type { Actor } from "@/lib/auth/roles";
import { cancelFollowUp } from "./follow-up";
import { describeVerdict, detectOffPlatform, type Verdict } from "./off-platform";

/**
 * Posting a message on a thread, and what that sets off.
 *
 * A thread belongs to an enquiry and a business — never to an enquiry alone.
 * One enquiry has up to eight of them, none of which can see the others, and
 * scoping every read and write to the pair is what keeps that true.
 *
 * Takes a sender id rather than reading a session, so both sides go through
 * the same code and it can be tested without a request.
 */

export type Sender = "buyer" | "seller";

export interface PostMessageInput {
  enquiryId: string;
  businessId: string;
  senderId: string;
  sender: Sender;
  body: string;
  /** Set when a seller posts a revised quote inline. */
  quoteRevisionId?: string | null;
}

export type PostMessageResult =
  | { ok: true; messageId: string; flagged: boolean; reportId: string | null }
  | { ok: false; error: "not_a_participant" | "empty" | "closed" };

const MAX_BODY = 4000;

export async function postMessage(input: PostMessageInput): Promise<PostMessageResult> {
  const body = input.body.trim();
  if (!body) return { ok: false, error: "empty" };

  const recipient = await prisma.enquiryRecipient.findUnique({
    where: { enquiryId_businessId: { enquiryId: input.enquiryId, businessId: input.businessId } },
    select: {
      firstReplyAt: true,
      enquiry: {
        select: { id: true, buyerId: true, closesAt: true, contactReleasedToBusinessId: true },
      },
    },
  });
  // Not a thread that exists, and not one you are on, are the same answer.
  if (!recipient) return { ok: false, error: "not_a_participant" };

  const enquiry = recipient.enquiry;
  if (input.sender === "buyer" && enquiry.buyerId !== input.senderId) {
    return { ok: false, error: "not_a_participant" };
  }

  /*
   * A closed enquiry still accepts messages from the accepted supplier and its
   * buyer: that is the pair still arranging delivery, and cutting them off
   * would push exactly the conversation this platform wants on the record
   * onto WhatsApp. Everybody else is done talking.
   */
  const closed = enquiry.closesAt.getTime() < Date.now();
  const isAcceptedPair = enquiry.contactReleasedToBusinessId === input.businessId;
  if (closed && !isAcceptedPair) return { ok: false, error: "closed" };

  const verdict = detectOffPlatform(body, {
    contactReleased: enquiry.contactReleasedToBusinessId === input.businessId,
  });

  const result = await prisma.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: {
        enquiryId: input.enquiryId,
        businessId: input.businessId,
        senderId: input.senderId,
        body: body.slice(0, MAX_BODY),
        quoteRevisionId: input.quoteRevisionId ?? null,
        // On the record whether or not anybody is asked to look at it.
        flaggedAt: verdict.flag ? new Date() : null,
      },
      select: { id: true },
    });

    /*
     * Response time is measured from the seller's first reply, whatever form
     * it takes. A message is a reply; sending a quote is too, and whichever
     * comes first stamps it. See lib/quote/send-quote.ts for the other half.
     */
    if (input.sender === "seller" && recipient.firstReplyAt === null) {
      await tx.enquiryRecipient.update({
        where: { enquiryId_businessId: { enquiryId: input.enquiryId, businessId: input.businessId } },
        data: { firstReplyAt: new Date(), state: "opened" },
      });
    }

    const reportId = verdict.report
      ? (
          await tx.supplierReport.create({
            data: {
              subjectBusinessId: input.businessId,
              // The buyer did not file this; the platform did. Null reporter
              // is what distinguishes an automatic report from a person's.
              reporterId: null,
              kind: "off_platform_payment",
              subjectField: `message:${message.id}`,
              detail: describeVerdict(verdict, body),
            },
            select: { id: true },
          })
        ).id
      : null;

    return { messageId: message.id, reportId };
  });

  /*
     Board 11b §4: the follow-up is cancelled when the buyer replies. Outside
     the transaction and unconditional — a reminder that will not send and one
     that was never armed are the same thing, so there is nothing to check first
     and nothing to roll back if it finds none.
  */
  if (input.sender === "buyer") {
    await cancelFollowUp(input.enquiryId, input.businessId);
  }

  return { ok: true, ...result, flagged: verdict.flag };
}

/**
 * The seller's half of `postMessage`, with the capability check it never had.
 *
 * `sendQuoteForBusiness` has asserted `quote.send` since handoff 2; the message
 * path asserted nothing. It resolved a seat and wrote, so a `seller_finance`
 * seat — which board 7d gives no reply capability at all — could post into a
 * buyer thread. Board 7d's first row is "Reply to enquiries & send quotes", and
 * only one half of it was fenced.
 *
 * Written here rather than in the action for the same reason as the quote
 * service: an action resolves who is acting and revalidates, and every invariant
 * lives where a test can reach it without a request.
 */
export async function postSellerMessage(
  actor: Actor,
  businessId: string,
  input: { enquiryId: string; body: string; quoteRevisionId?: string | null },
): Promise<PostMessageResult> {
  assertCan(actor, "enquiry.respond");

  return postMessage({
    enquiryId: input.enquiryId,
    businessId,
    senderId: actor.id,
    sender: "seller",
    body: input.body,
    quoteRevisionId: input.quoteRevisionId ?? null,
  });
}

export interface ThreadMessage {
  id: string;
  body: string;
  senderId: string;
  /** True when the sender is the business on this thread. */
  fromSeller: boolean;
  flagged: boolean;
  quoteRevisionId: string | null;
  createdAt: Date;
}

/**
 * One thread, scoped to the pair.
 *
 * Returns null when the caller is not on it — which, from outside, is the same
 * answer as a thread that does not exist.
 */
export async function getThread(
  enquiryId: string,
  businessId: string,
): Promise<ThreadMessage[] | null> {
  const recipient = await prisma.enquiryRecipient.findUnique({
    where: { enquiryId_businessId: { enquiryId, businessId } },
    select: { businessId: true },
  });
  if (!recipient) return null;

  const messages = await prisma.message.findMany({
    where: { enquiryId, businessId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      body: true,
      senderId: true,
      flaggedAt: true,
      quoteRevisionId: true,
      createdAt: true,
      sender: { select: { businessId: true } },
    },
  });

  return messages.map((m) => ({
    id: m.id,
    body: m.body,
    senderId: m.senderId,
    fromSeller: m.sender.businessId === businessId,
    flagged: m.flaggedAt !== null,
    quoteRevisionId: m.quoteRevisionId,
    createdAt: m.createdAt,
  }));
}

export type { Verdict };
