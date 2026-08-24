import "server-only";
import { prisma } from "@/lib/db/client";
import { quoteTotalAed } from "@/lib/quote/money";

/**
 * Server-side reads for the buyer's side of an enquiry.
 *
 * The mirror of lib/db/queries/seller.ts, and the asymmetry is the point: a
 * buyer sees every supplier's name and every price quoted to them, because
 * those were sent to them. A supplier sees one first name.
 */

export interface BuyerQuoteLine {
  id: string;
  description: string;
  qty: number;
  unitPrice: string;
  leadTimeDays: number | null;
}

export interface BuyerQuote {
  id: string;
  ref: string;
  revision: number;
  status: string;
  note: string | null;
  sentAt: Date | null;
  expiresAt: Date | null;
  acceptedAt: Date | null;
  totalAed: string;
  maxLeadTimeDays: number | null;
  lines: BuyerQuoteLine[];
  business: { id: string; slug: string; displayName: string; verificationTier: number };
}

export interface BuyerEnquiry {
  id: string;
  ref: string;
  requirement: string;
  deliverToArea: string | null;
  neededBy: Date | null;
  termsWanted: string | null;
  closesAt: Date;
  createdAt: Date;
  contactReleasedToBusinessId: string | null;
  contactReleasedAt: Date | null;
  lines: { id: string; description: string; qty: number; unit: string | null; size: string | null; targetUnitPriceAed: string | null }[];
  recipients: { businessId: string; slug: string; displayName: string; state: string; openedAt: Date | null }[];
  /** Current revision per supplier, newest first. Superseded ones are not shown. */
  quotes: BuyerQuote[];
}

/**
 * One enquiry, for the buyer who sent it.
 *
 * Returns null for anybody else. An unknown id and somebody else's enquiry are
 * the same answer, so the tracking page cannot be used to find out which
 * references exist.
 */
export async function getBuyerEnquiry(buyerId: string, enquiryId: string): Promise<BuyerEnquiry | null> {
  const enquiry = await prisma.enquiry.findFirst({
    where: { id: enquiryId, buyerId },
    select: {
      id: true,
      ref: true,
      requirement: true,
      deliverToArea: true,
      neededBy: true,
      termsWanted: true,
      closesAt: true,
      createdAt: true,
      contactReleasedToBusinessId: true,
      contactReleasedAt: true,
      lines: { orderBy: { sortOrder: "asc" } },
      recipients: {
        select: {
          businessId: true,
          state: true,
          openedAt: true,
          business: { select: { slug: true, displayName: true } },
        },
      },
      quotes: {
        // A draft is the seller's own working copy and was never sent.
        where: { status: { not: "draft" } },
        orderBy: [{ businessId: "asc" }, { revision: "desc" }],
        select: {
          id: true,
          ref: true,
          revision: true,
          status: true,
          note: true,
          sentAt: true,
          expiresAt: true,
          acceptedAt: true,
          businessId: true,
          business: { select: { id: true, slug: true, displayName: true, verificationTier: true } },
          lines: { orderBy: { sortOrder: "asc" } },
        },
      },
    },
  });
  if (!enquiry) return null;

  // One row per supplier: their current revision. The earlier ones are in the
  // thread, where the struck-through price belongs.
  const currentByBusiness = new Map<string, (typeof enquiry.quotes)[number]>();
  for (const quote of enquiry.quotes) {
    if (!currentByBusiness.has(quote.businessId)) currentByBusiness.set(quote.businessId, quote);
  }

  return {
    id: enquiry.id,
    ref: enquiry.ref,
    requirement: enquiry.requirement,
    deliverToArea: enquiry.deliverToArea,
    neededBy: enquiry.neededBy,
    termsWanted: enquiry.termsWanted,
    closesAt: enquiry.closesAt,
    createdAt: enquiry.createdAt,
    contactReleasedToBusinessId: enquiry.contactReleasedToBusinessId,
    contactReleasedAt: enquiry.contactReleasedAt,
    lines: enquiry.lines.map((l) => ({
      id: l.id,
      description: l.description,
      qty: l.qty,
      unit: l.unit,
      size: l.size,
      targetUnitPriceAed: l.targetUnitPriceAed?.toString() ?? null,
    })),
    recipients: enquiry.recipients.map((r) => ({
      businessId: r.businessId,
      slug: r.business.slug,
      displayName: r.business.displayName,
      state: r.state,
      openedAt: r.openedAt,
    })),
    quotes: [...currentByBusiness.values()].map((q) => ({
      id: q.id,
      ref: q.ref,
      revision: q.revision,
      status: q.status,
      note: q.note,
      sentAt: q.sentAt,
      expiresAt: q.expiresAt,
      acceptedAt: q.acceptedAt,
      totalAed: quoteTotalAed(q.lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice.toString() }))),
      maxLeadTimeDays: q.lines.reduce<number | null>(
        (max, l) => (l.leadTimeDays === null ? max : Math.max(max ?? 0, l.leadTimeDays)),
        null,
      ),
      lines: q.lines.map((l) => ({
        id: l.id,
        description: l.description,
        qty: l.qty,
        unitPrice: l.unitPrice.toString(),
        leadTimeDays: l.leadTimeDays,
      })),
      business: q.business,
    })),
  };
}

export interface BuyerEnquiryRow {
  id: string;
  ref: string;
  requirement: string;
  createdAt: Date;
  closesAt: Date;
  quoteCount: number;
  accepted: boolean;
}

export async function getBuyerEnquiries(buyerId: string): Promise<BuyerEnquiryRow[]> {
  const rows = await prisma.enquiry.findMany({
    where: { buyerId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      ref: true,
      requirement: true,
      createdAt: true,
      closesAt: true,
      contactReleasedToBusinessId: true,
      quotes: { where: { status: { not: "draft" } }, select: { businessId: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    ref: r.ref,
    requirement: r.requirement,
    createdAt: r.createdAt,
    closesAt: r.closesAt,
    // Suppliers who quoted, not quote rows: three revisions is one supplier.
    quoteCount: new Set(r.quotes.map((q) => q.businessId)).size,
    accepted: r.contactReleasedToBusinessId !== null,
  }));
}

/** The accepted supplier's own contact details, for the buyer who accepted. */
export async function getAcceptedRecord(buyerId: string, enquiryId: string) {
  const enquiry = await prisma.enquiry.findFirst({
    where: { id: enquiryId, buyerId, contactReleasedToBusinessId: { not: null } },
    select: {
      id: true,
      ref: true,
      contactReleasedAt: true,
      contactReleasedToBusinessId: true,
      quotes: {
        where: { status: "accepted" },
        take: 1,
        select: {
          id: true,
          ref: true,
          revision: true,
          acceptedAt: true,
          note: true,
          lines: { orderBy: { sortOrder: "asc" } },
          business: {
            select: {
              id: true,
              slug: true,
              displayName: true,
              verificationTier: true,
              locations: {
                where: { published: true },
                take: 1,
                select: {
                  phone: true,
                  whatsapp: true,
                  addressLine: true,
                  area: { select: { name: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  const quote = enquiry?.quotes[0];
  if (!enquiry || !quote) return null;

  return {
    enquiryId: enquiry.id,
    ref: enquiry.ref,
    acceptedAt: quote.acceptedAt ?? enquiry.contactReleasedAt,
    quoteRef: quote.ref,
    revision: quote.revision,
    note: quote.note,
    totalAed: quoteTotalAed(quote.lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice.toString() }))),
    lines: quote.lines.map((l) => ({
      id: l.id,
      description: l.description,
      qty: l.qty,
      unitPrice: l.unitPrice.toString(),
      leadTimeDays: l.leadTimeDays,
    })),
    business: quote.business,
  };
}
