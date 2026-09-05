import "server-only";
import { prisma } from "@/lib/db/client";
import { onQuoteExpiring } from "@/lib/notify/events";

/**
 * Board 7e §2 — telling a seller that a quote is about to lapse.
 *
 * The row the board adds, and the reason it gives: board 3k ships the expiry
 * window, the `Expiring soon` tab and the extend action, and nothing notified
 * any of it. A seller met the deadline only by opening the screen, which means
 * the quotes that lapsed were the ones belonging to sellers who were busy.
 *
 * ## Two days, not seven
 *
 * Board 3k's `Expiring soon` tab is a seven-day filter, because that is a useful
 * length of list to work down. This is two, because a notification is an
 * interruption: at seven days it arrives while there is nothing to decide, and a
 * seller who is interrupted about a deadline five days out stops reading the
 * ones that are tomorrow.
 *
 * ## Once per quote
 *
 * `notify()` deduplicates nothing, and a daily sweep would otherwise send this
 * on every day of the window. The guard is a `NotificationDelivery` row for this
 * event on this enquiry — the same shape `sweepSetupNudges` uses, and for the
 * same reason: the delivery log is the record of what was sent, so asking it is
 * asking the thing that knows.
 */

/** How close to the deadline is worth interrupting somebody about. */
export const EXPIRY_NOTICE_DAYS = 2;

export interface ExpirySweepResult {
  considered: number;
  notified: number;
  alreadySent: number;
}

export async function sweepExpiringQuotes(now = new Date()): Promise<ExpirySweepResult> {
  const until = new Date(now.getTime() + EXPIRY_NOTICE_DAYS * 86_400_000);

  const quotes = await prisma.quote.findMany({
    where: {
      // Sent and not yet decided. A draft has no deadline a buyer can see, and
      // an accepted or declined quote has nothing left to extend.
      status: { in: ["sent", "read"] },
      expiresAt: { gt: now, lte: until },
      enquiry: { recipients: { some: { outcome: null } } },
    },
    select: {
      id: true,
      ref: true,
      enquiryId: true,
      businessId: true,
      expiresAt: true,
    },
  });
  if (quotes.length === 0) return { considered: 0, notified: 0, alreadySent: 0 };

  /*
     One query for what has already gone out, not one per quote. A supplier with
     forty quotes in a window is forty round trips on a job that runs daily
     against every supplier at once.
  */
  const sent = new Set(
    (
      await prisma.notificationDelivery.findMany({
        where: {
          event: "quote_expiring",
          enquiryId: { in: quotes.map((quote) => quote.enquiryId) },
        },
        select: { enquiryId: true, businessId: true },
      })
    ).map((row) => `${row.enquiryId}:${row.businessId}`),
  );

  let notified = 0;
  let alreadySent = 0;

  for (const quote of quotes) {
    if (sent.has(`${quote.enquiryId}:${quote.businessId}`)) {
      alreadySent += 1;
      continue;
    }
    if (!quote.expiresAt) continue;
    await onQuoteExpiring({
      enquiryId: quote.enquiryId,
      businessId: quote.businessId,
      quoteRef: quote.ref,
      expiresAt: quote.expiresAt,
    });
    notified += 1;
  }

  return { considered: quotes.length, notified, alreadySent };
}
