import "server-only";
import { prisma } from "@/lib/db/client";
import { onEnquiryClosing } from "@/lib/notify/events";

/**
 * Board `1n` — telling a buyer their quotes are about to stop being acceptable.
 *
 * `10e` B3 makes a closed enquiry terminal: `acceptQuote` refuses it, the
 * comparison stops offering accept, and the only way on is to re-send — to a
 * fresh match, not to the suppliers who already answered. A buyer holding four
 * quotes who lets the close pass has lost all four. The comparison's eyebrow
 * says *closes in 3 days*; this is the one time the platform says it anywhere
 * the buyer is not already looking.
 *
 * ## Which enquiries
 *
 * Open, closing inside the next day, nothing accepted, and at least one quote
 * that could still be accepted — sent, inside its own window, from a supplier
 * who has not closed their account. An enquiry with nothing to accept has
 * nothing to lose at the close, and a reminder about it would be noise.
 *
 * ## Once
 *
 * The guard is the delivery log, as `sweepExpiringQuotes` does it: a
 * `NotificationDelivery` row for this event on this enquiry means it went, or
 * was held for quiet hours and will go. `notify` deduplicates nothing, and the
 * sweep runs hourly.
 *
 * Bounded, oldest close first, so a backlog clears in order and a run costs the
 * same at any size.
 */

export const CLOSING_NOTICE_MS = 24 * 3_600_000;
const BATCH = 200;

export interface ClosingSweepResult {
  considered: number;
  notified: number;
  alreadySent: number;
}

export async function sweepClosingEnquiries(now: Date = new Date()): Promise<ClosingSweepResult> {
  const until = new Date(now.getTime() + CLOSING_NOTICE_MS);

  const enquiries = await prisma.enquiry.findMany({
    where: {
      closesAt: { gt: now, lte: until },
      contactReleasedToBusinessId: null,
      quotes: {
        some: {
          status: { in: ["sent", "read"] },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          business: { closureRequestedAt: null },
        },
      },
    },
    orderBy: [{ closesAt: "asc" }, { id: "asc" }],
    take: BATCH,
    select: {
      id: true,
      quotes: {
        where: {
          status: { in: ["sent", "read"] },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          business: { closureRequestedAt: null },
        },
        select: { businessId: true },
      },
    },
  });
  if (enquiries.length === 0) return { considered: 0, notified: 0, alreadySent: 0 };

  const sent = await prisma.notificationDelivery.findMany({
    where: { event: "enquiry_closing", enquiryId: { in: enquiries.map((e) => e.id) } },
    select: { enquiryId: true },
    distinct: ["enquiryId"],
    orderBy: { enquiryId: "asc" },
  });
  const done = new Set(sent.map((row) => row.enquiryId));

  let notified = 0;
  for (const enquiry of enquiries) {
    if (done.has(enquiry.id)) continue;
    // Suppliers, not rows: a revision is the same supplier's quote again.
    const quotes = new Set(enquiry.quotes.map((quote) => quote.businessId)).size;
    if (await onEnquiryClosing({ enquiryId: enquiry.id, quotes })) notified += 1;
  }

  return { considered: enquiries.length, notified, alreadySent: done.size };
}
