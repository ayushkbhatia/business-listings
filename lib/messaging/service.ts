import "server-only";
import { prisma } from "@/lib/db/client";
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

  return { ok: true, ...result, flagged: verdict.flag };
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

export type NudgeResult =
  | { ok: true; nudgedAt: Date }
  | { ok: false; error: "not_a_participant" | "already_nudged" | "no_reply_needed" };

/**
 * The one follow-up a seller gets.
 *
 * Board 11b says a second nudge loses more deals than it wins, so there is no
 * second. `nudgedAt` is a timestamp rather than a counter for that reason: the
 * schema cannot express "three nudges", so no future screen can offer them.
 */
export async function nudge(enquiryId: string, businessId: string): Promise<NudgeResult> {
  const recipient = await prisma.enquiryRecipient.findUnique({
    where: { enquiryId_businessId: { enquiryId, businessId } },
    select: { nudgedAt: true, state: true },
  });
  if (!recipient) return { ok: false, error: "not_a_participant" };
  if (recipient.nudgedAt) return { ok: false, error: "already_nudged" };
  // Nothing to follow up on until a quote has been sent.
  if (recipient.state !== "quoted") return { ok: false, error: "no_reply_needed" };

  const nudgedAt = new Date();
  await prisma.enquiryRecipient.update({
    where: { enquiryId_businessId: { enquiryId, businessId } },
    data: { nudgedAt },
  });
  return { ok: true, nudgedAt };
}

export type { Verdict };
