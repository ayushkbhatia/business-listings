import "server-only";
import { prisma } from "@/lib/db/client";
import type { Prisma } from "@/lib/db/generated/client";
import { getThread } from "./service";
import type { NegotiationMessage, NegotiationQuote, QuoteState, RequirementLine } from "./negotiation";

/**
 * Board `10h` — the rows a negotiation thread is drawn from.
 *
 * Two readers. `loadThreadRecord` is one thread, for either side: its messages,
 * every non-draft revision in full, and the requirement those revisions price —
 * the buyer's page and the seller's lead thread both read it, so the two
 * renderings are built from one read. `loadNegotiation` is the buyer's whole
 * enquiry: that, plus the rail of every supplier it went to.
 *
 * No totals are selected, because none are stored. The revision's lines are.
 */

const QUOTE_SELECT = {
  id: true,
  ref: true,
  revision: true,
  status: true,
  sentAt: true,
  expiresAt: true,
  validityDays: true,
  note: true,
  businessId: true,
  lines: {
    orderBy: [{ sortOrder: "asc" as const }, { id: "asc" as const }],
    select: { id: true, enquiryLineId: true, description: true, qty: true, unitPrice: true, sortOrder: true },
  },
  proposal: { select: { feeAed: true, feeBasis: true, feeBasisLabel: true } },
} satisfies Prisma.QuoteSelect;

type QuoteRow = {
  id: string;
  ref: string;
  revision: number;
  status: string;
  sentAt: Date | null;
  expiresAt: Date | null;
  validityDays: number;
  note: string | null;
  businessId: string;
  lines: { id: string; enquiryLineId: string | null; description: string; qty: number | null; unitPrice: { toString(): string }; sortOrder: number }[];
  proposal: { feeAed: { toString(): string } | null; feeBasis: string | null; feeBasisLabel: string | null } | null;
};

function toQuote(row: QuoteRow): NegotiationQuote {
  const proposal =
    row.proposal?.feeAed && row.proposal.feeBasis && row.proposal.feeBasisLabel
      ? { feeAed: row.proposal.feeAed.toString(), feeBasis: row.proposal.feeBasis, feeBasisLabel: row.proposal.feeBasisLabel }
      : null;
  return {
    id: row.id,
    ref: row.ref,
    revision: row.revision,
    status: row.status as QuoteState,
    sentAt: row.sentAt,
    expiresAt: row.expiresAt,
    validityDays: row.validityDays,
    note: row.note,
    lines: row.lines.map((line) => ({
      id: line.id,
      enquiryLineId: line.enquiryLineId,
      description: line.description,
      qty: line.qty,
      unitPrice: line.unitPrice.toString(),
      sortOrder: line.sortOrder,
    })),
    proposal,
  };
}

export interface ThreadRecord {
  messages: NegotiationMessage[];
  /** Every non-draft revision, oldest first. */
  quotes: NegotiationQuote[];
  requirement: RequirementLine[];
}

/**
 * One thread's record. Null when the business is not a recipient of the enquiry
 * — the same answer as a thread that does not exist.
 *
 * The caller proves who is reading. This proves only that the thread exists.
 */
export async function loadThreadRecord(enquiryId: string, businessId: string): Promise<ThreadRecord | null> {
  const [messages, quotes, requirement] = await Promise.all([
    getThread(enquiryId, businessId),
    prisma.quote.findMany({
      where: { enquiryId, businessId, status: { not: "draft" } },
      orderBy: [{ revision: "asc" }, { id: "asc" }],
      select: QUOTE_SELECT,
    }),
    prisma.enquiryLine.findMany({
      where: { enquiryId },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: { id: true, description: true, qty: true, sortOrder: true },
    }),
  ]);
  if (!messages) return null;

  return {
    messages: messages.map((message) => ({
      id: message.id,
      body: message.body,
      fromSeller: message.fromSeller,
      senderId: message.senderId,
      createdAt: message.createdAt,
      readAt: message.readAt,
      flagged: message.flagged,
      automatic: message.automatic,
      quoteRevisionId: message.quoteRevisionId,
      attachments: message.attachments,
    })),
    quotes: quotes.map(toQuote),
    requirement: requirement.map((line) => ({
      id: line.id,
      description: line.description,
      qty: line.qty === null ? null : Number(line.qty),
      sortOrder: line.sortOrder,
    })),
  };
}

export interface RailThread {
  businessId: string;
  slug: string;
  displayName: string;
  declinedAt: Date | null;
  declineReason: string | null;
  /** The supplier's latest non-draft revision. */
  latestQuote: NegotiationQuote | null;
  lastMessage: { body: string; fromSeller: boolean; createdAt: Date; attachments: number } | null;
  sellerHasWritten: boolean;
  /** Supplier messages and revisions the buyer has not opened. */
  unread: number;
  deliveredAt: Date;
}

export interface Negotiation {
  enquiry: {
    id: string;
    ref: string;
    requirement: string;
    closesAt: Date;
    releasedTo: string | null;
    releasedAt: Date | null;
    /** Who was accepted, when it was somebody else. The name the buyer chose. */
    winnerName: string | null;
  };
  rail: RailThread[];
  supplier: {
    id: string;
    slug: string;
    displayName: string;
    categoryCode: string | null;
    /** A listing can come down after an enquiry reached it; the thread stays, the storefront does not. */
    published: boolean;
    verificationTier: number;
    verifiedAt: Date | null;
    responseTimeMedianMs: number | null;
    closed: boolean;
    declinedAt: Date | null;
    declineReason: string | null;
    /** The person answering: the last seat that typed a reply, else the seat the lead is routed to. */
    person: { name: string; role: string | null } | null;
  };
  record: ThreadRecord;
}

const SELLER_ROLES = ["seller_owner", "seller_manager", "seller_sales", "seller_finance"] as const;

/**
 * The buyer's view of one enquiry's negotiation, opened on one supplier.
 *
 * Scoped to the buyer in the first query, so somebody else's enquiry, a missing
 * one and a supplier it never went to are all the same null. `enquiryRef` is a
 * reference or an id: the reference is what the board's URL carries and what a
 * buyer reads back; the id is what links already sent out carry.
 */
export async function loadNegotiation(
  buyerId: string,
  enquiryRef: string,
  supplierSlug: string,
): Promise<Negotiation | null> {
  const enquiry = await prisma.enquiry.findFirst({
    where: { OR: [{ ref: enquiryRef }, { id: enquiryRef }], buyerId },
    select: {
      id: true,
      ref: true,
      requirement: true,
      closesAt: true,
      contactReleasedToBusinessId: true,
      contactReleasedAt: true,
      recipients: {
        orderBy: [{ createdAt: "asc" }, { businessId: "asc" }],
        select: {
          businessId: true,
          createdAt: true,
          declinedAt: true,
          declineReason: true,
          assignedTo: { select: { fullName: true, roles: true } },
          business: {
            select: {
              id: true,
              slug: true,
              displayName: true,
              verificationTier: true,
              verifiedAt: true,
              responseTimeMedianMs: true,
              closureRequestedAt: true,
              publishedAt: true,
              primaryCategory: { select: { code: true } },
            },
          },
        },
      },
    },
  });
  if (!enquiry) return null;

  const current = enquiry.recipients.find((recipient) => recipient.business.slug === supplierSlug);
  if (!current) return null;

  const [quotes, lastMessages, sellerCounts, unreadMessages, record, lastHuman] = await Promise.all([
    prisma.quote.findMany({
      where: { enquiryId: enquiry.id, status: { not: "draft" } },
      orderBy: [{ businessId: "asc" }, { revision: "desc" }, { id: "asc" }],
      select: { ...QUOTE_SELECT, readAt: true },
    }),
    /*
       The last message on each thread, in one pass. The id settles two messages
       written in the same instant, so the preview cannot flip between reloads.
    */
    prisma.$queryRaw<{ business_id: string; body: string; author_side: string; created_at: Date; attachments: bigint }[]>`
      SELECT DISTINCT ON (m.business_id)
             m.business_id, m.body, m.author_side::text AS author_side, m.created_at,
             (SELECT count(*) FROM message_attachment a WHERE a.message_id = m.id) AS attachments
        FROM message m
       WHERE m.enquiry_id = ${enquiry.id}
       ORDER BY m.business_id, m.created_at DESC, m.id DESC
    `,
    /*
       Typed replies only. An out-of-hours acknowledgement is not a reply (board
       7e §4 — it never stamps `firstReplyAt`), and counting it would turn a
       supplier's *No reply yet* into *Replied* on the rail: `B9`'s signal
       erased by a template.
    */
    prisma.message.groupBy({
      by: ["businessId"],
      where: { enquiryId: enquiry.id, authorSide: "seller", automatic: false },
      _count: { _all: true },
      orderBy: { businessId: "asc" },
    }),
    prisma.message.groupBy({
      by: ["businessId"],
      where: { enquiryId: enquiry.id, authorSide: "seller", readAt: null },
      _count: { _all: true },
      orderBy: { businessId: "asc" },
    }),
    loadThreadRecord(enquiry.id, current.businessId),
    prisma.message.findFirst({
      where: { enquiryId: enquiry.id, businessId: current.businessId, authorSide: "seller", automatic: false },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { sender: { select: { fullName: true, roles: true } } },
    }),
  ]);
  if (!record) return null;

  const latestByBusiness = new Map<string, (typeof quotes)[number]>();
  const unreadQuotes = new Map<string, number>();
  for (const quote of quotes) {
    if (!latestByBusiness.has(quote.businessId)) latestByBusiness.set(quote.businessId, quote);
    if (quote.readAt === null && (quote.status === "sent" || quote.status === "read")) {
      unreadQuotes.set(quote.businessId, (unreadQuotes.get(quote.businessId) ?? 0) + 1);
    }
  }
  const lastByBusiness = new Map(lastMessages.map((row) => [row.business_id, row]));
  const written = new Map(sellerCounts.map((row) => [row.businessId, row._count._all]));
  const unread = new Map(unreadMessages.map((row) => [row.businessId, row._count._all]));

  const rail: RailThread[] = enquiry.recipients.map((recipient) => {
    const latest = latestByBusiness.get(recipient.businessId);
    const last = lastByBusiness.get(recipient.businessId);
    return {
      businessId: recipient.businessId,
      slug: recipient.business.slug,
      displayName: recipient.business.displayName,
      declinedAt: recipient.declinedAt,
      declineReason: recipient.declineReason,
      latestQuote: latest ? toQuote(latest) : null,
      lastMessage: last
        ? {
            body: last.body,
            fromSeller: last.author_side === "seller",
            createdAt: last.created_at,
            attachments: Number(last.attachments),
          }
        : null,
      sellerHasWritten: (written.get(recipient.businessId) ?? 0) > 0 || latest !== undefined,
      unread: (unread.get(recipient.businessId) ?? 0) + (unreadQuotes.get(recipient.businessId) ?? 0),
      deliveredAt: recipient.createdAt,
    };
  });

  const personRow = lastHuman?.sender ?? current.assignedTo ?? null;
  const person =
    personRow?.fullName && personRow.fullName.trim() !== ""
      ? { name: personRow.fullName.trim(), role: SELLER_ROLES.find((role) => personRow.roles.includes(role)) ?? null }
      : null;

  const winner = enquiry.contactReleasedToBusinessId
    ? enquiry.recipients.find((recipient) => recipient.businessId === enquiry.contactReleasedToBusinessId)
    : undefined;

  return {
    enquiry: {
      id: enquiry.id,
      ref: enquiry.ref,
      requirement: enquiry.requirement,
      closesAt: enquiry.closesAt,
      releasedTo: enquiry.contactReleasedToBusinessId,
      releasedAt: enquiry.contactReleasedAt,
      winnerName: winner && winner.businessId !== current.businessId ? winner.business.displayName : null,
    },
    rail,
    supplier: {
      id: current.business.id,
      slug: current.business.slug,
      displayName: current.business.displayName,
      categoryCode: current.business.primaryCategory?.code ?? null,
      published: current.business.publishedAt !== null,
      verificationTier: current.business.verificationTier,
      verifiedAt: current.business.verifiedAt,
      responseTimeMedianMs: current.business.responseTimeMedianMs,
      closed: current.business.closureRequestedAt !== null,
      declinedAt: current.declinedAt,
      declineReason: current.declineReason,
      person,
    },
    record,
  };
}
