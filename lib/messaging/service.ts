import "server-only";
import { prisma } from "@/lib/db/client";
import { assertCan } from "@/lib/auth/can";
import type { Actor } from "@/lib/auth/roles";
import { recordEvent } from "@/lib/telemetry/record";
import {
  DOCUMENT_BUCKET,
  removeObject,
  signUpload,
  statDocument,
  type SignedUpload,
} from "@/lib/storage";
import { displayFilename } from "@/lib/enquiry/service-enquiry";
import {
  MAX_THREAD_ATTACHMENTS,
  checkThreadAttachment,
  isThreadAttachmentPath,
  threadAttachmentPath,
  type ThreadAttachmentRefusal,
} from "./attachments";
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
  /**
   * Written by a schedule rather than typed.
   *
   * Tagged `AUTOMATIC` in the thread, and — the part that matters — it does not
   * stamp `firstReplyAt`. See the guard below.
   */
  automatic?: boolean;
  /** Set when a seller posts a revised quote inline. */
  quoteRevisionId?: string | null;
  /**
   * Files this side uploaded through `signThreadAttachment`, in the order the
   * composer listed them. Board `10h` Q5: they belong to this message and to
   * this thread only.
   */
  attachments?: readonly ThreadUpload[];
}

/** A file already in storage, named by the path its signed upload wrote. */
export interface ThreadUpload {
  path: string;
  /** The sender's own filename, shown to the other side. */
  filename: string;
}

export type PostMessageError =
  | "not_a_participant"
  | "empty"
  | "closed"
  | "supplier_closed"
  /** The buyer accepted another supplier on this enquiry. */
  | "not_chosen"
  /** A path this side of this thread was never signed for, or already sent. */
  | "attachment_missing"
  | ThreadAttachmentRefusal;

export type PostMessageResult =
  | { ok: true; messageId: string; flagged: boolean; reportId: string | null }
  | { ok: false; error: PostMessageError };

const MAX_BODY = 4000;

/** Storage, behind the three calls the thread makes — so a test can stand one in. */
export interface ThreadStorage {
  sign: (bucket: string, path: string) => Promise<SignedUpload>;
  stat: typeof statDocument;
  remove: (bucket: string, path: string) => Promise<void>;
}

export const threadStorage: ThreadStorage = { sign: signUpload, stat: statDocument, remove: removeObject };

/**
 * May this side write on this thread at all.
 *
 * One answer for a message and for the upload before it, so a file is never
 * signed onto a thread its message would then be refused on.
 */
async function writeAccess(
  input: Pick<PostMessageInput, "enquiryId" | "businessId" | "senderId" | "sender">,
  now: Date,
) {
  const recipient = await prisma.enquiryRecipient.findUnique({
    where: { enquiryId_businessId: { enquiryId: input.enquiryId, businessId: input.businessId } },
    select: {
      firstReplyAt: true,
      business: { select: { closureRequestedAt: true } },
      state: true,
      enquiry: {
        select: { id: true, buyerId: true, closesAt: true, contactReleasedToBusinessId: true },
      },
    },
  });
  // Not a thread that exists, and not one you are on, are the same answer.
  if (!recipient) return { ok: false as const, error: "not_a_participant" as const };

  /*
     Board 11i build note B4. The thread stays readable to the buyer — it is
     their record — but a message into it would reach nobody: every seat on a
     closing business is revoked. Saying so beats accepting a message that
     waits for a reply that cannot come.
  */
  if (recipient.business.closureRequestedAt) return { ok: false as const, error: "supplier_closed" as const };

  const enquiry = recipient.enquiry;
  if (input.sender === "buyer" && enquiry.buyerId !== input.senderId) {
    return { ok: false as const, error: "not_a_participant" as const };
  }

  /*
   * A closed enquiry still accepts messages from the accepted supplier and its
   * buyer: that is the pair still arranging delivery, and cutting them off
   * would push exactly the conversation this platform wants on the record
   * onto WhatsApp. Everybody else is done talking.
   */
  const closed = enquiry.closesAt.getTime() < now.getTime();
  const isAcceptedPair = enquiry.contactReleasedToBusinessId === input.businessId;
  /*
     Board `10h`'s states: *enquiry accepted elsewhere — this thread becomes
     read-only*, and `7c` is that nothing more is sent on an accepted enquiry.
     The window being open does not reopen a thread the buyer has decided: a
     losing supplier writing on after `7c`'s auto-decline, or the buyer writing
     to them, is a conversation about a deal that went to somebody else.
  */
  if (enquiry.contactReleasedToBusinessId !== null && !isAcceptedPair) {
    return { ok: false as const, error: "not_chosen" as const };
  }
  if (closed && !isAcceptedPair) return { ok: false as const, error: "closed" as const };

  return { ok: true as const, recipient, enquiry };
}

export async function postMessage(
  input: PostMessageInput,
  storage: ThreadStorage = threadStorage,
): Promise<PostMessageResult> {
  const body = input.body.trim();
  const uploads = input.attachments ?? [];
  // A file on its own is a message: "drawing attached" adds nothing the file does not say.
  if (!body && uploads.length === 0) return { ok: false, error: "empty" };
  if (uploads.length > MAX_THREAD_ATTACHMENTS) return { ok: false, error: "count" };

  const access = await writeAccess(input, new Date());
  if (!access.ok) return { ok: false, error: access.error };
  const { recipient, enquiry } = access;

  /*
     Board `10h` Q5. Every file is read back from storage under a path only this
     side of this thread could have been signed for, and is what the bucket
     allows — never what the browser said about it. One refused file refuses the
     message: a message that arrives without the drawing it says is attached is
     worse than one that does not arrive.
  */
  const side = input.sender;
  const files: { path: string; filename: string; bytes: number; mimeType: string | null }[] = [];
  for (const upload of uploads) {
    if (!isThreadAttachmentPath(input.enquiryId, input.businessId, side, upload.path)) {
      return { ok: false, error: "attachment_missing" };
    }
    if (files.some((file) => file.path === upload.path)) return { ok: false, error: "attachment_missing" };
    const stored = await storage.stat(upload.path);
    if (!stored) return { ok: false, error: "attachment_missing" };
    const refusal = checkThreadAttachment(stored.mimeType ?? "", stored.bytes);
    if (refusal) {
      await storage.remove(DOCUMENT_BUCKET, upload.path);
      return { ok: false, error: refusal };
    }
    files.push({ path: upload.path, filename: upload.filename, bytes: stored.bytes, mimeType: stored.mimeType });
  }
  if (files.length > 0) {
    // A path already sent is on the record with its first message; it does not go twice.
    const sent = await prisma.document.count({
      where: { kind: "thread_attachment", storagePath: { in: files.map((file) => file.path) } },
    });
    if (sent > 0) return { ok: false, error: "attachment_missing" };
  }

  const verdict = detectOffPlatform(body, {
    contactReleased: enquiry.contactReleasedToBusinessId === input.businessId,
  });

  const result = await prisma.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: {
        enquiryId: input.enquiryId,
        businessId: input.businessId,
        senderId: input.senderId,
        // Board `10h` B5: whose words these are, stated now rather than
        // worked out later from who the sender happens to work for.
        authorSide: input.sender,
        body: body.slice(0, MAX_BODY),
        quoteRevisionId: input.quoteRevisionId ?? null,
        automatic: input.automatic ?? false,
        // On the record whether or not anybody is asked to look at it.
        flaggedAt: verdict.flag ? new Date() : null,
      },
      select: { id: true },
    });

    for (const [index, file] of files.entries()) {
      const document = await tx.document.create({
        data: {
          kind: "thread_attachment",
          storagePath: file.path,
          filename: displayFilename(file.filename),
          bytes: file.bytes,
          mimeType: file.mimeType,
          // Said out loud: a buyer's drawing is never a public document.
          isPublic: false,
        },
        select: { id: true },
      });
      await tx.messageAttachment.create({
        data: { messageId: message.id, documentId: document.id, sortOrder: index },
      });
    }

    /*
     * Response time is measured from the seller's first reply, whatever form
     * it takes. A message is a reply; sending a quote is too, and whichever
     * comes first stamps it. See lib/quote/send-quote.ts for the other half.
     *
     * ## Automatic messages are not replies
     *
     * Board 7e §4 calls this the most consequential correction in the pair, and
     * the check belongs here rather than in the caller. An auto-reply fires
     * *precisely* when `firstReplyAt` is null — that is its trigger — so without
     * this line the acknowledgement would stamp the clock it exists to apologise
     * for. Then:
     *
     *   - the median first reply buyers see as a band on 1b/1c measures a robot;
     *   - the ranking points for reply time, whatever board 12c has them set
     *     to, are won by installing a template;
     *   - board 3a's median card, 3k's speed card and 7d's per-seat medians all
     *     report a number no human produced.
     *
     * Every seller would switch it on for that reason alone and the metric would
     * be worthless inside a month. Board 11b's follow-up escapes today only by
     * bypassing this function entirely, and only because it fires after a human
     * has already answered — it has never exercised the null case.
     */
    if (input.sender === "seller" && !input.automatic && recipient.firstReplyAt === null) {
      await tx.enquiryRecipient.update({
        where: { enquiryId_businessId: { enquiryId: input.enquiryId, businessId: input.businessId } },
        /*
           `opened` only from `delivered`. This wrote the state unconditionally,
           so a supplier who wrote after the buyer had accepted someone else
           turned a `declined` row back into `opened` on the buyer's tracking
           page — and since board `3j-s` a supplier's own decline carries a
           CHECK that refuses exactly that write.
        */
        data: {
          firstReplyAt: new Date(),
          ...(recipient.state === "delivered" ? { state: "opened" as const } : {}),
        },
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
    await cancelFollowUp(input.enquiryId, input.businessId, "buyer_replied");
  }

  /*
     Only the seller's. A buyer's message is not this business's telemetry, and
     `product_event` is keyed by business — a row counting what a buyer wrote
     would sit in a supplier's own numbers describing somebody else.

     Length rather than the words. Nothing here is a place to store a message.
  */
  if (input.sender === "seller") {
    await recordEvent({
      name: "message_sent",
      businessId: input.businessId,
      actorId: input.senderId,
      props: { length: body.length, flagged: verdict.flag },
    });
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
  input: {
    enquiryId: string;
    body: string;
    quoteRevisionId?: string | null;
    attachments?: readonly ThreadUpload[];
  },
): Promise<PostMessageResult> {
  assertCan(actor, "enquiry.respond");

  return postMessage({
    enquiryId: input.enquiryId,
    businessId,
    senderId: actor.id,
    sender: "seller",
    body: input.body,
    quoteRevisionId: input.quoteRevisionId ?? null,
    attachments: input.attachments ?? [],
  });
}

export type SignThreadAttachmentResult =
  | { ok: true; url: string; path: string }
  | { ok: false; error: Exclude<PostMessageError, "empty" | "attachment_missing"> | "unavailable" };

/**
 * A signed upload for one file, on one side of one thread.
 *
 * Board `10h` Q5. The same four refusals as the message it will ride on — not
 * on the thread, supplier closed, enquiry closed to this pair — plus the
 * bucket's own type and size, checked here against what the browser declares
 * and again against what storage holds when the message is sent. The signature
 * is per object and short-lived; there is no bucket-wide write to get wrong.
 *
 * The seller's capability is the caller's to assert, as `postSellerMessage`
 * does: this takes a resolved sender.
 */
export async function signThreadAttachment(
  input: {
    enquiryId: string;
    businessId: string;
    senderId: string;
    sender: Sender;
    filename: string;
    type: string;
    bytes: number;
  },
  storage: ThreadStorage = threadStorage,
  now: Date = new Date(),
): Promise<SignThreadAttachmentResult> {
  const access = await writeAccess(input, now);
  if (!access.ok) return { ok: false, error: access.error };

  const refusal = checkThreadAttachment(input.type, input.bytes);
  if (refusal) return { ok: false, error: refusal };

  try {
    const signed = await storage.sign(
      DOCUMENT_BUCKET,
      threadAttachmentPath(input.enquiryId, input.businessId, input.sender, input.filename),
    );
    return { ok: true, url: signed.url, path: signed.path };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

/** The seller's half of `signThreadAttachment`, with the reply capability. */
export async function signSellerThreadAttachment(
  actor: Actor,
  businessId: string,
  input: { enquiryId: string; filename: string; type: string; bytes: number },
): Promise<SignThreadAttachmentResult> {
  assertCan(actor, "enquiry.respond");
  return signThreadAttachment({ ...input, businessId, senderId: actor.id, sender: "seller" });
}

/**
 * The other side's messages on this thread, stamped read by the side opening it.
 *
 * Board `10h`: `17:41 · READ` under the buyer's own message. Symmetric, which is
 * board 11b §6's condition — the buyer opening the thread stamps the seller's
 * messages and the seller opening it stamps the buyer's — and first opening only,
 * which the `message_is_the_record` trigger holds as well as the `readAt: null`
 * below.
 *
 * The reader must already be proven: a buyer by the enquiry they resolved to, a
 * seller by a seat on `businessId`. A buyer is re-proven here through the
 * enquiry's `buyerId`, so a caller that passed the wrong id stamps nothing.
 */
export async function markThreadRead(
  enquiryId: string,
  businessId: string,
  reader: { side: "buyer"; buyerId: string } | { side: "seller" },
  now: Date = new Date(),
): Promise<{ marked: number }> {
  const { count } = await prisma.message.updateMany({
    where: {
      enquiryId,
      businessId,
      readAt: null,
      authorSide: reader.side === "buyer" ? "seller" : "buyer",
      ...(reader.side === "buyer" ? { enquiry: { buyerId: reader.buyerId } } : {}),
    },
    data: { readAt: now },
  });
  return { marked: count };
}

export interface ThreadAttachmentRow {
  documentId: string;
  filename: string;
  bytes: number | null;
  mimeType: string | null;
}

export interface ThreadMessage {
  id: string;
  body: string;
  senderId: string;
  /** Written by the business on this thread. From `authorSide`, never from the sender's seat today. */
  fromSeller: boolean;
  /** When the other side first opened the thread with this in it. */
  readAt: Date | null;
  attachments: ThreadAttachmentRow[];
  flagged: boolean;
  /** Written by the follow-up schedule rather than typed. Tagged on screen. */
  automatic: boolean;
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
    // `createMany` gives a batch one timestamp; the id breaks the tie the same way every time.
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      body: true,
      senderId: true,
      flaggedAt: true,
      automatic: true,
      quoteRevisionId: true,
      createdAt: true,
      authorSide: true,
      readAt: true,
      attachments: {
        orderBy: { sortOrder: "asc" },
        select: { document: { select: { id: true, filename: true, bytes: true, mimeType: true } } },
      },
    },
  });

  return messages.map((m) => ({
    id: m.id,
    body: m.body,
    senderId: m.senderId,
    fromSeller: m.authorSide === "seller",
    readAt: m.readAt,
    attachments: m.attachments.map((a) => ({
      documentId: a.document.id,
      filename: a.document.filename,
      bytes: a.document.bytes,
      mimeType: a.document.mimeType,
    })),
    flagged: m.flaggedAt !== null,
    automatic: m.automatic,
    quoteRevisionId: m.quoteRevisionId,
    createdAt: m.createdAt,
  }));
}

export type { Verdict };

/**
 * Where a thread attachment lives, for the buyer on that thread — or null.
 *
 * Board `10h` Q5: the document hangs off a message on this enquiry *and this
 * supplier*, and is a thread attachment. A file sent to another supplier on the
 * same enquiry, a trade licence under a guessed id, and somebody else's enquiry
 * are all null, which the route turns into one 404.
 */
export async function buyerThreadAttachment(
  buyerId: string,
  enquiryRefOrId: string,
  supplierSlug: string,
  documentId: string,
): Promise<string | null> {
  const row = await prisma.messageAttachment.findFirst({
    where: {
      documentId,
      document: { kind: "thread_attachment" },
      message: {
        enquiry: { OR: [{ ref: enquiryRefOrId }, { id: enquiryRefOrId }], buyerId },
        business: { slug: supplierSlug },
      },
    },
    select: { document: { select: { storagePath: true } } },
  });
  return row?.document.storagePath ?? null;
}

/** The same, for a seat on the supplier: this business's thread on this enquiry only. */
export async function sellerThreadAttachment(
  businessId: string,
  enquiryId: string,
  documentId: string,
): Promise<string | null> {
  const row = await prisma.messageAttachment.findFirst({
    where: {
      documentId,
      document: { kind: "thread_attachment" },
      message: { enquiryId, businessId },
    },
    select: { document: { select: { storagePath: true } } },
  });
  return row?.document.storagePath ?? null;
}
