import "server-only";
import { prisma } from "@/lib/db/client";

/**
 * Board 11b §6 — read receipts, both directions or neither.
 *
 * ## The column that had no writer
 *
 * `Quote.readAt` has existed since the init migration. The seed sets it in five
 * places, `lib/db/queries/seller.ts` selects it and returns it on every
 * `QuoteRow`, and **nothing in the application has ever written it**. So the
 * seller's dashboard has been reading a field that is populated on a seeded
 * database and permanently null in production — the exact "works on my machine"
 * shape that a screen built against seed data cannot see.
 *
 * Board 11b renders *"Buyer opened your revision 12 minutes ago"* from it. This
 * is the writer that makes the sentence true.
 *
 * ## Why it is symmetric, and why it stops at the quote
 *
 * §6: a one-way receipt is surveillance, and the buyer finds out the first time
 * a seller mentions it. The buyer has seen `EnquiryRecipient.openedAt` since
 * board 1i — *"opened {when}"* on their own tracking page — so the seller seeing
 * when a quote was opened restores a balance rather than tipping one.
 *
 * It deliberately does not extend to messages. A per-message read flag would be
 * a receipt on the buyer's own words with no equivalent going the other way, and
 * §6's rule is both ways or not at all.
 *
 * ## Once
 *
 * `readAt` is the *first* opening, not the latest. A buyer who reopens a quote
 * four times while deciding is not four events, and a timestamp that moved every
 * time would tell the seller when the buyer last looked — which is a different,
 * more intrusive fact than the one the board asked for.
 */

export interface ReceiptResult {
  /** How many quotes this call stamped. Zero on every visit after the first. */
  marked: number;
}

/**
 * Mark every quote on this enquiry as read, for one buyer.
 *
 * Scoped by `enquiry.buyerId` rather than by a caller's assurance: the argument
 * is the buyer the request resolved, and a quote is only read when the person it
 * was addressed to opened it. A seller previewing their own quote must not stamp
 * their own receipt.
 *
 * Drafts are excluded — a draft has not been sent, so it cannot have been read —
 * and so is anything already stamped, which is what makes this idempotent and
 * what keeps `readAt` meaning *first* opened.
 */
export async function markQuotesRead(
  enquiryId: string,
  buyerId: string,
  now: Date = new Date(),
): Promise<ReceiptResult> {
  const { count } = await prisma.quote.updateMany({
    where: {
      enquiryId,
      readAt: null,
      status: { in: ["sent", "read"] },
      // The buyer is proven by the enquiry, not asserted by the caller.
      enquiry: { buyerId },
    },
    data: { readAt: now, status: "read" },
  });

  return { marked: count };
}

/**
 * The same, for one supplier's quotes only.
 *
 * The buyer's thread with one seller shows that seller's revisions inline, and
 * opening it is evidence about those and no others. Opening one conversation is
 * not evidence that the buyer read the three competing quotes they have not
 * looked at.
 */
export async function markSellerQuotesRead(
  enquiryId: string,
  businessId: string,
  buyerId: string,
  now: Date = new Date(),
): Promise<ReceiptResult> {
  const { count } = await prisma.quote.updateMany({
    where: {
      enquiryId,
      businessId,
      readAt: null,
      status: { in: ["sent", "read"] },
      enquiry: { buyerId },
    },
    data: { readAt: now, status: "read" },
  });

  return { marked: count };
}
