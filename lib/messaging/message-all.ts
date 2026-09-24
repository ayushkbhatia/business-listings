import "server-only";
import { prisma } from "@/lib/db/client";
import { checkRate, recordHit, requesterKey } from "@/lib/rate-limit";
import { recordEvent } from "@/lib/telemetry/record";
import { MESSAGE_ALL_MAX } from "./limits";
import { postMessage, type PostMessageError } from "./service";

/**
 * Board `1n` — *Message all*: one message, written once, posted into every
 * supplier's own thread on the enquiry.
 *
 * **Never a group thread.** Each supplier reads it in the thread they share with
 * this buyer alone (`10h`), beside their own quote, and replies there. A shared
 * thread would show every supplier who else was asked and what they answered —
 * the one thing a fan-out must never do (`permissions.md`: sellers never see
 * other sellers' prices), and the reason `EnquiryRecipient` is one row per pair.
 *
 * Each copy goes through `postMessage`, the one writer every message on the
 * platform passes, so the off-platform scanner reads each and a supplier's
 * follow-up is cancelled by it exactly as by a message typed in their thread.
 * A supplier who declined the enquiry, or who closed their account, is not
 * written to; the result says who was skipped and why.
 */

export type MessageAllRefusal = "not_found" | "empty" | "too_long" | "decided" | "closed" | "nobody" | "rate_limited";

export type MessageAllResult =
  | { ok: true; sent: number; skipped: { businessId: string; displayName: string; error: PostMessageError }[] }
  | { ok: false; error: MessageAllRefusal; retryAfterMs?: number };

export async function messageAllSuppliers(input: {
  buyerId: string;
  ref: string;
  body: string;
  now?: Date;
}): Promise<MessageAllResult> {
  const now = input.now ?? new Date();
  const body = input.body.trim();
  if (!body) return { ok: false, error: "empty" };
  if (body.length > MESSAGE_ALL_MAX) return { ok: false, error: "too_long" };

  const enquiry = await prisma.enquiry.findFirst({
    // The buyer is in the query: somebody else's reference is not found.
    where: { OR: [{ ref: input.ref }, { id: input.ref }], buyerId: input.buyerId },
    select: {
      id: true,
      closesAt: true,
      contactReleasedToBusinessId: true,
      recipients: {
        where: { declinedAt: null, business: { closureRequestedAt: null } },
        orderBy: [{ createdAt: "asc" }, { businessId: "asc" }],
        select: { businessId: true, business: { select: { displayName: true } } },
      },
    },
  });
  if (!enquiry) return { ok: false, error: "not_found" };
  // Once one supplier is chosen the others' threads refuse new messages (`10h`).
  if (enquiry.contactReleasedToBusinessId) return { ok: false, error: "decided" };
  if (enquiry.closesAt.getTime() <= now.getTime()) return { ok: false, error: "closed" };
  if (enquiry.recipients.length === 0) return { ok: false, error: "nobody" };

  const key = await requesterKey(`${input.buyerId}:${enquiry.id}`);
  const rate = await checkRate("message_all", key, now);
  if (!rate.allowed) return { ok: false, error: "rate_limited", retryAfterMs: rate.retryAfterMs };
  // Counted before the sends, so a second press while the first is still
  // writing is refused by the cooldown rather than racing it.
  await recordHit("message_all", key);

  let sent = 0;
  const skipped: { businessId: string; displayName: string; error: PostMessageError }[] = [];
  for (const recipient of enquiry.recipients) {
    const result = await postMessage({
      enquiryId: enquiry.id,
      businessId: recipient.businessId,
      senderId: input.buyerId,
      sender: "buyer",
      body,
    });
    if (result.ok) sent += 1;
    else skipped.push({ businessId: recipient.businessId, displayName: recipient.business.displayName, error: result.error });
  }

  await recordEvent({ name: "suppliers_messaged", actorId: input.buyerId, props: { recipients: sent } });
  return { ok: true, sent, skipped };
}
