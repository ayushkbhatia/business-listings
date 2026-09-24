import "server-only";
import { prisma } from "@/lib/db/client";
import type { ComparedRecipient, ComparisonInput, RequestedLine } from "@/lib/quote/comparison";
import { PUBLISHED } from "./reviews";

/**
 * Board `1n` — everything the buyer's comparison of quotes reads, for the buyer
 * who sent the enquiry and nobody else.
 *
 * Reads only, and decides nothing: `lib/quote/comparison.ts` turns this into
 * cells, winners and the cheapest-per-line card. An unknown reference and
 * somebody else's enquiry are the same null, and so is an enquiry for work —
 * `1n-s` compares proposals and has its own read.
 *
 * ## What is private here
 *
 * Every price on the page was sent to this buyer, so the buyer sees every one.
 * The asymmetry is the rule: no seller surface reads this module, and nothing
 * it returns is ever handed to one (`permissions.md`, *sellers never see other
 * sellers' prices*).
 */

export interface QuoteComparisonData {
  enquiry: {
    id: string;
    ref: string;
    requirement: string;
    createdAt: Date;
    closesAt: Date;
    neededBy: Date | null;
    revision: number;
    acceptedBusinessId: string | null;
    acceptedAt: Date | null;
    /** Board `7b`: the company the enquiry was raised for, and its name for the release sentence. */
    buyerCompanyId: string | null;
    companyName: string | null;
    /** A saved delivery address travels with the release — its line and its attn. contact (`7b` B6). */
    hasDeliveryAddress: boolean;
  };
  input: ComparisonInput;
}

function byRefOrId(buyerId: string, refOrId: string) {
  return { OR: [{ ref: refOrId }, { id: refOrId }], buyerId };
}

export async function getQuoteComparison(buyerId: string, refOrId: string): Promise<QuoteComparisonData | null> {
  const enquiry = await prisma.enquiry.findFirst({
    where: byRefOrId(buyerId, refOrId),
    select: {
      id: true,
      ref: true,
      requirement: true,
      createdAt: true,
      closesAt: true,
      neededBy: true,
      revision: true,
      contactReleasedToBusinessId: true,
      contactReleasedAt: true,
      buyerCompanyId: true,
      buyerCompany: { select: { name: true } },
      deliverySnapshot: true,
      serviceBrief: { select: { enquiryId: true } },
      lines: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: { id: true, description: true, qty: true, unit: true, size: true },
      },
      recipients: {
        orderBy: [{ createdAt: "asc" }, { businessId: "asc" }],
        select: {
          businessId: true,
          state: true,
          createdAt: true,
          openedAt: true,
          buyerNudgedAt: true,
          firstReplyAt: true,
          declinedAt: true,
          declineReason: true,
          business: {
            select: {
              slug: true,
              displayName: true,
              verificationTier: true,
              verifiedAt: true,
              closureRequestedAt: true,
            },
          },
        },
      },
      quotes: {
        // A draft is the seller's working copy and was never sent.
        where: { status: { not: "draft" } },
        orderBy: [{ businessId: "asc" }, { revision: "desc" }],
        select: {
          id: true,
          ref: true,
          businessId: true,
          revision: true,
          status: true,
          sentAt: true,
          createdAt: true,
          expiresAt: true,
          againstRevision: true,
          paymentTerms: true,
          delivery: true,
          lines: {
            orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
            select: { enquiryLineId: true, qty: true, unitPrice: true, leadTimeDays: true },
          },
        },
      },
    },
  });
  if (!enquiry || enquiry.serviceBrief) return null;

  const ratings = await prisma.review.groupBy({
    by: ["businessId"],
    where: { businessId: { in: enquiry.recipients.map((r) => r.businessId) }, ...PUBLISHED },
    _avg: { overall: true },
    _count: { _all: true },
    orderBy: { businessId: "asc" },
  });
  const ratingOf = new Map(
    ratings
      .filter((row) => row._avg.overall !== null && row._count._all > 0)
      .map((row) => [row.businessId, { average: row._avg.overall!, count: row._count._all }]),
  );

  /*
     One row per supplier: their current revision, which is the one a buyer can
     accept. The earlier revisions live in the thread with their prices struck
     through (`10h`); what this keeps from them is when the supplier first
     answered, which is what "quoted in" measures.
  */
  const current = new Map<string, (typeof enquiry.quotes)[number]>();
  const firstSent = new Map<string, Date>();
  for (const quote of enquiry.quotes) {
    if (!current.has(quote.businessId)) current.set(quote.businessId, quote);
    const at = quote.sentAt ?? quote.createdAt;
    const earliest = firstSent.get(quote.businessId);
    if (!earliest || at.getTime() < earliest.getTime()) firstSent.set(quote.businessId, at);
  }

  const lines: RequestedLine[] = enquiry.lines.map((line) => ({
    id: line.id,
    description: line.description,
    qty: line.qty,
    unit: line.unit,
    size: line.size,
  }));

  const recipients: ComparedRecipient[] = enquiry.recipients.map((recipient) => {
    const quote = current.get(recipient.businessId) ?? null;
    return {
      supplier: {
        businessId: recipient.businessId,
        slug: recipient.business.slug,
        displayName: recipient.business.displayName,
        /*
           The stored tier, as the storefront badge, the fan-out and the `7b`
           gate all read it. The licence-expiry sweep is what moves it; a second
           expiry rule here would give one supplier two badges on one day.
        */
        verificationTier: recipient.business.verificationTier,
        verifiedAt: recipient.business.verifiedAt,
        rating: ratingOf.get(recipient.businessId) ?? null,
        closed: recipient.business.closureRequestedAt !== null,
      },
      state: recipient.state,
      deliveredAt: recipient.createdAt,
      openedAt: recipient.openedAt,
      buyerNudgedAt: recipient.buyerNudgedAt,
      repliedAt: recipient.firstReplyAt,
      declinedAt: recipient.declinedAt,
      declineReason: recipient.declineReason,
      quote: quote
        ? {
            id: quote.id,
            ref: quote.ref,
            revision: quote.revision,
            status: quote.status,
            sentAt: quote.sentAt ?? quote.createdAt,
            firstSentAt: firstSent.get(recipient.businessId) ?? quote.sentAt ?? quote.createdAt,
            expiresAt: quote.expiresAt,
            againstRevision: quote.againstRevision,
            paymentTerms: quote.paymentTerms,
            delivery: quote.delivery,
            lines: quote.lines.map((line) => ({
              enquiryLineId: line.enquiryLineId,
              qty: line.qty,
              unitPrice: line.unitPrice.toString(),
              leadTimeDays: line.leadTimeDays,
            })),
          }
        : null,
    };
  });

  return {
    enquiry: {
      id: enquiry.id,
      ref: enquiry.ref,
      requirement: enquiry.requirement,
      createdAt: enquiry.createdAt,
      closesAt: enquiry.closesAt,
      neededBy: enquiry.neededBy,
      revision: enquiry.revision,
      acceptedBusinessId: enquiry.contactReleasedToBusinessId,
      acceptedAt: enquiry.contactReleasedAt,
      buyerCompanyId: enquiry.buyerCompanyId,
      companyName: enquiry.buyerCompany?.name ?? null,
      hasDeliveryAddress: enquiry.deliverySnapshot !== null,
    },
    input: {
      lines,
      recipients,
      revision: enquiry.revision,
      closesAt: enquiry.closesAt,
      neededBy: enquiry.neededBy,
      acceptedBusinessId: enquiry.contactReleasedToBusinessId,
      acceptedAt: enquiry.contactReleasedAt,
    },
  };
}
