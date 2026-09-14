import "server-only";
import { prisma } from "@/lib/db/client";
import {
  countBuckets,
  dubaiYearStart,
  historyOf,
  inboxRow,
  INBOX_BUCKETS,
  needsYou,
  type EnquiryHistory,
  type InboxBucket,
  type InboxFacts,
  type InboxRow,
  type NeedsYou,
} from "./inbox-status";
import { canNudge } from "./tracking";

/**
 * Board 10e — a buyer's enquiries, as the inbox reads them.
 *
 * One read, and everything on the page comes out of it: the rows, the chip
 * counts, the two `NEEDS YOU` cards and the history card. That is `B1` as a
 * structure rather than a promise — a chip cannot count a different set from
 * the table beneath it when there is only one set.
 *
 * The buyer's own enquiries, whole. The derivation needs every row to count
 * the chips and pick the rail, and paging happens after it, over the chosen
 * bucket. A buyer's enquiries number in the tens a year; the select is the
 * narrow one the derivation needs and nothing else — no lines, no messages, no
 * quote amounts.
 *
 * `B9` / `B10`: everything here is the buyer's and is read only for the buyer.
 * Nothing in this module is imported by a seller surface, and `quoted` is a
 * count of suppliers, never which ones or for how much.
 */

export const INBOX_PAGE_SIZE = 20;

export type { InboxRow };

export interface BuyerInbox {
  rows: InboxRow[];
  /** The rows the chosen chip shows, one page of them. */
  page: { rows: InboxRow[]; number: number; pages: number; from: number; to: number; total: number };
  counts: Record<InboxBucket, number> & { all: number };
  needsYou: NeedsYou<InboxRow>[];
  history: EnquiryHistory;
  historySince: Date;
}

export async function getBuyerInbox(
  buyerId: string,
  options: { bucket?: InboxBucket | null; page?: number; now?: Date } = {},
): Promise<BuyerInbox> {
  const now = options.now ?? new Date();

  const enquiries = await prisma.enquiry.findMany({
    where: { buyerId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      ref: true,
      requirement: true,
      createdAt: true,
      closesAt: true,
      deliverToArea: true,
      area: { select: { name: true } },
      contactReleasedToBusinessId: true,
      serviceBrief: { select: { enquiryId: true } },
      _count: { select: { lines: true } },
      resentAs: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { ref: true },
      },
      recipients: {
        select: { state: true, buyerNudgedAt: true, createdAt: true, firstReplyAt: true, declinedAt: true },
      },
      quotes: {
        where: { status: { not: "draft" } },
        select: { businessId: true, sentAt: true, readAt: true },
      },
    },
  });

  const rows: InboxRow[] = enquiries.map((enquiry) => {
    const quotedBusinesses = new Set(enquiry.quotes.map((quote) => quote.businessId));
    const recipients = enquiry.recipients;
    const facts: InboxFacts = {
      createdAt: enquiry.createdAt,
      closesAt: enquiry.closesAt,
      sentTo: recipients.length,
      quoted: quotedBusinesses.size,
      anyQuoteRead: enquiry.quotes.some((quote) => quote.readAt !== null),
      accepted: enquiry.contactReleasedToBusinessId !== null,
      nudgeable: recipients.filter((r) =>
        canNudge({ state: r.state, buyerNudgedAt: r.buyerNudgedAt, deliveredAt: r.createdAt }, now),
      ).length,
      unanswered: recipients.filter((r) => r.firstReplyAt === null && r.state !== "declined").length,
      allDeclined:
        recipients.length > 0 && quotedBusinesses.size === 0 && recipients.every((r) => r.state === "declined"),
      resentAsRef: enquiry.resentAs[0]?.ref ?? null,
    };
    return inboxRow(
      {
        id: enquiry.id,
        ref: enquiry.ref,
        requirement: enquiry.requirement,
        lineCount: enquiry._count.lines,
        place: enquiry.area?.name ?? enquiry.deliverToArea ?? null,
        isBrief: enquiry.serviceBrief !== null,
      },
      facts,
      now,
    );
  });

  const chosen = options.bucket && INBOX_BUCKETS.includes(options.bucket)
    ? rows.filter((row) => row.bucket === options.bucket)
    : rows;
  const pages = Math.max(1, Math.ceil(chosen.length / INBOX_PAGE_SIZE));
  const number = Math.min(pages, Math.max(1, Math.floor(options.page ?? 1)));
  const start = (number - 1) * INBOX_PAGE_SIZE;
  const pageRows = chosen.slice(start, start + INBOX_PAGE_SIZE);

  const historySince = dubaiYearStart(now);
  const history = historyOf(
    enquiries.map((enquiry) => {
      const sentAts = enquiry.quotes.map((quote) => quote.sentAt).filter((at): at is Date => at !== null);
      return {
        createdAt: enquiry.createdAt,
        firstQuoteAt: sentAts.length ? new Date(Math.min(...sentAts.map((at) => at.getTime()))) : null,
        acceptedBusinessId: enquiry.contactReleasedToBusinessId,
      };
    }),
    historySince,
  );

  return {
    rows,
    page: {
      rows: pageRows,
      number,
      pages,
      from: chosen.length === 0 ? 0 : start + 1,
      to: start + pageRows.length,
      total: chosen.length,
    },
    counts: countBuckets(rows, now),
    needsYou: needsYou(rows, now),
    history,
    historySince,
  };
}

export function asBucket(value: string | undefined): InboxBucket | null {
  return value && (INBOX_BUCKETS as readonly string[]).includes(value) ? (value as InboxBucket) : null;
}
