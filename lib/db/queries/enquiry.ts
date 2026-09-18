import "server-only";
import { prisma } from "@/lib/db/client";
import { quoteTotalAed } from "@/lib/quote/money";
import { ENQUIRY_BRIEF_SELECT, toEnquiryBrief, type EnquiryBrief } from "./enquiry-brief";
import { PROPOSAL_RECORD_SELECT, toProposalRecord, type ProposalRecord } from "@/lib/quote/proposal";

/**
 * Server-side reads for the buyer's side of an enquiry.
 *
 * The mirror of lib/db/queries/seller.ts, and the asymmetry is the point: a
 * buyer sees every supplier's name and every price quoted to them, because
 * those were sent to them. A supplier sees one first name.
 */

/**
 * The segment in `/enquiry/:id/...` is a reference or an id, and both resolve.
 *
 * `getTrackingByRef` established this for the parent route and wrote down why:
 * the reference is what the SMS and the email print and what a buyer reads back
 * to somebody, and the id is what every link already sent out carries. The two
 * child routes did not inherit it, so the tracking page's own Compare and
 * "View accepted" buttons — built from `tracking.ref` — resolved against an
 * id-only `where` and 404'd. No test caught it because every e2e navigates by
 * the seed's raw id.
 *
 * The buyer id stays inside the `where` rather than being checked afterwards.
 * A reference is four digits and guessable; an unknown one and somebody else's
 * enquiry have to return the same null, or the 404 becomes a confirmation.
 */
function byRefOrId(buyerId: string, refOrId: string) {
  return { OR: [{ ref: refOrId }, { id: refOrId }], buyerId };
}

export interface BuyerQuoteLine {
  id: string;
  description: string;
  /** Null on a service line — priced as a whole, not per unit. */
  qty: number | null;
  unitPrice: string;
  leadTimeDays: number | null;
}

export interface BuyerQuote {
  id: string;
  ref: string;
  revision: number;
  status: string;
  note: string | null;
  /** Board `7c`: the terms quoted. The buyer reads them here before accepting. */
  paymentTerms: string | null;
  delivery: string | null;
  sentAt: Date | null;
  expiresAt: Date | null;
  acceptedAt: Date | null;
  totalAed: string;
  maxLeadTimeDays: number | null;
  lines: BuyerQuoteLine[];
  /**
   * Board `3j-s`: the proposal, when this reply is one. It has no lines, so
   * `totalAed` is `0.00` and nothing may render it — every reader branches here.
   */
  proposal: ProposalRecord | null;
  business: { id: string; slug: string; displayName: string; verificationTier: number };
}

export interface BuyerEnquiry {
  id: string;
  ref: string;
  requirement: string;
  deliverToArea: string | null;
  neededBy: Date | null;
  termsWanted: string | null;
  /** How big the job is, in the buyer's words — decision D7. Null on goods. */
  scale: string | null;
  /** The buyer's own file's name. Theirs to see; the path never leaves the server. */
  attachments: { id: string; filename: string }[];
  /**
   * Board `1h-s`: the brief, when this enquiry is one. Null on every enquiry
   * for things — its absence is what makes the page render the goods card.
   */
  brief: EnquiryBrief | null;
  closesAt: Date;
  createdAt: Date;
  contactReleasedToBusinessId: string | null;
  /**
   * Board `7b`: the buying company the enquiry was raised for, or null. Its
   * rule governs acceptance, so the accept controls send a company enquiry to
   * `/enquiry/:id/accept/:quote` rather than posting straight to the action.
   */
  buyerCompanyId: string | null;
  contactReleasedAt: Date | null;
  lines: {
    id: string;
    description: string;
    /** Null is unquantified — work sold as a job — not zero. */
    qty: number | null;
    unit: string | null;
    size: string | null;
    targetUnitPriceAed: string | null;
    /** Board `1d-s`: set when the line asked about a service rather than a thing. */
    serviceId: string | null;
  }[];
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
    where: byRefOrId(buyerId, enquiryId),
    select: {
      id: true,
      ref: true,
      requirement: true,
      deliverToArea: true,
      neededBy: true,
      termsWanted: true,
      scale: true,
      attachments: {
        where: { kind: "enquiry_attachment" },
        orderBy: { createdAt: "asc" },
        select: { id: true, filename: true },
      },
      emirate: true,
      area: { select: { name: true } },
      serviceBrief: { select: ENQUIRY_BRIEF_SELECT },
      closesAt: true,
      createdAt: true,
      contactReleasedToBusinessId: true,
      buyerCompanyId: true,
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
          paymentTerms: true,
          delivery: true,
          sentAt: true,
          expiresAt: true,
          acceptedAt: true,
          businessId: true,
          business: { select: { id: true, slug: true, displayName: true, verificationTier: true } },
          lines: { orderBy: { sortOrder: "asc" } },
          proposal: { select: PROPOSAL_RECORD_SELECT },
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
    scale: enquiry.scale,
    attachments: enquiry.attachments,
    brief: toEnquiryBrief(enquiry.serviceBrief, enquiry),
    closesAt: enquiry.closesAt,
    createdAt: enquiry.createdAt,
    contactReleasedToBusinessId: enquiry.contactReleasedToBusinessId,
    buyerCompanyId: enquiry.buyerCompanyId,
    contactReleasedAt: enquiry.contactReleasedAt,
    lines: enquiry.lines.map((l) => ({
      id: l.id,
      description: l.description,
      qty: l.qty,
      unit: l.unit,
      size: l.size,
      targetUnitPriceAed: l.targetUnitPriceAed?.toString() ?? null,
      serviceId: l.serviceId,
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
      paymentTerms: q.paymentTerms,
      delivery: q.delivery,
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
      proposal: toProposalRecord(q.proposal),
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

/**
 * Board `7c`'s record. Moved to its own module when it grew from four fields to
 * the whole page; re-exported so the enquiry reads stay importable from one place.
 */
export { getAcceptedRecord } from "./accepted-record";
