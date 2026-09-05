import "server-only";
import { prisma } from "@/lib/db/client";
import { buyerForSeller, buyerSelectFor, type SellerVisibleBuyer } from "./seller-visibility";
import { matchLines, type LineMatch, type MatchableProduct } from "@/lib/quote/match";
import { quoteTotalAed } from "@/lib/quote/money";

/**
 * Server-side reads for the seller dashboard.
 *
 * Every read here is scoped to one `businessId`, taken from the actor and never
 * from a route parameter. A seller who edits the id in the URL gets a 404, not
 * somebody else's enquiry.
 *
 * Buyer contact details go through `buyerForSeller` without exception. See
 * `seller-visibility.ts` — the rule is enforced by not selecting the columns.
 */

/** Only these states are a live lead. `declined` and `no_response` are history. */
const OPEN_STATES = ["delivered", "opened", "quoted"] as const;

export interface LeadRow {
  enquiryId: string;
  ref: string;
  state: string;
  requirement: string;
  lineCount: number;
  totalQty: number;
  deliverToArea: string | null;
  neededBy: Date | null;
  closesAt: Date;
  createdAt: Date;
  openedAt: Date | null;
  firstReplyAt: Date | null;
  sellerNudgedAt: Date | null;
  buyer: SellerVisibleBuyer;
  /** The seller's latest quote on this enquiry, if any. */
  latestQuote: { ref: string; revision: number; status: string; totalAed: string } | null;
}

export async function getLeadsForBusiness(businessId: string): Promise<LeadRow[]> {
  const recipients = await prisma.enquiryRecipient.findMany({
    where: { businessId, state: { in: [...OPEN_STATES] } },
    orderBy: [{ createdAt: "desc" }],
    include: {
      enquiry: {
        select: {
          id: true,
          ref: true,
          requirement: true,
          deliverToArea: true,
          neededBy: true,
          closesAt: true,
          createdAt: true,
          contactReleasedToBusinessId: true,
          // Masked by construction: only the name column, for the first name.
          buyer: { select: { fullName: true } },
          lines: { select: { qty: true } },
          quotes: {
            where: { businessId },
            orderBy: { revision: "desc" },
            take: 1,
            select: {
              ref: true,
              revision: true,
              status: true,
              lines: { select: { qty: true, unitPrice: true } },
            },
          },
        },
      },
    },
  });

  return recipients.map((r) => {
    const e = r.enquiry;
    const quote = e.quotes[0];
    return {
      enquiryId: e.id,
      ref: e.ref,
      state: r.state,
      requirement: e.requirement,
      lineCount: e.lines.length,
      totalQty: e.lines.reduce((n, l) => n + l.qty, 0),
      deliverToArea: e.deliverToArea,
      neededBy: e.neededBy,
      closesAt: e.closesAt,
      createdAt: e.createdAt,
      openedAt: r.openedAt,
      firstReplyAt: r.firstReplyAt,
      sellerNudgedAt: r.sellerNudgedAt,
      buyer: buyerForSeller(e.buyer, e.contactReleasedToBusinessId, businessId),
      latestQuote: quote
        ? {
            ref: quote.ref,
            revision: quote.revision,
            status: quote.status,
            totalAed: quoteTotalAed(
              quote.lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice.toString() })),
            ),
          }
        : null,
    };
  });
}

export interface LeadLine {
  id: string;
  description: string;
  qty: number;
  unit: string | null;
  size: string | null;
  /** The buyer's own budget per unit. Optional, and never a supplier price. */
  targetUnitPriceAed: string | null;
  sortOrder: number;
  /** What the seller's own catalogue has, or nothing. */
  match: LineMatch;
}

export interface LeadDetail {
  enquiryId: string;
  ref: string;
  state: string;
  requirement: string;
  deliverToArea: string | null;
  neededBy: Date | null;
  termsWanted: string | null;
  closesAt: Date;
  createdAt: Date;
  openedAt: Date | null;
  firstReplyAt: Date | null;
  /**
   * When the buyer accepted, where they did.
   *
   * `Quote.acceptedAt` first, falling back to `Enquiry.contactReleasedAt` — the
   * same pair the buyer's own side reads. The seller's screen used to render
   * "accepted your quote on {when}" with the *enquiry's* creation date, which on
   * a three-week enquiry was a fortnight out.
   */
  acceptedAt: Date | null;
  buyer: SellerVisibleBuyer;
  lines: LeadLine[];
  quotes: {
    id: string;
    ref: string;
    revision: number;
    status: string;
    note: string | null;
    validityDays: number;
    sentAt: Date | null;
    expiresAt: Date | null;
    totalAed: string;
    lines: {
      id: string;
      /**
       * The buyer's line this one answered. Null on every quote line written
       * before board 3j — the composer used to match on `description`, which is
       * ambiguous on an enquiry carrying two lines of the same wording in
       * different sizes.
       */
      enquiryLineId: string | null;
      productId: string | null;
      description: string;
      qty: number;
      unitPrice: string;
      leadTimeDays: number | null;
      sortOrder: number;
    }[];
  }[];
}

/**
 * One lead, with every enquiry line already matched against this seller's
 * catalogue. Returns null when the enquiry was never sent to this business —
 * an unknown id and someone else's enquiry are the same answer on purpose.
 */
export async function getLeadDetail(
  businessId: string,
  enquiryId: string,
): Promise<LeadDetail | null> {
  const recipient = await prisma.enquiryRecipient.findUnique({
    where: { enquiryId_businessId: { enquiryId, businessId } },
    select: { state: true, openedAt: true, firstReplyAt: true },
  });
  if (!recipient) return null;

  const released = await prisma.enquiry.findUnique({
    where: { id: enquiryId },
    select: { contactReleasedToBusinessId: true, contactReleasedAt: true },
  });
  if (!released) return null;

  const enquiry = await prisma.enquiry.findUnique({
    where: { id: enquiryId },
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
      buyer: { select: buyerSelectFor(released.contactReleasedToBusinessId, businessId) },
      lines: { orderBy: { sortOrder: "asc" } },
      quotes: {
        where: { businessId },
        orderBy: { revision: "desc" },
        include: { lines: { orderBy: { sortOrder: "asc" } } },
      },
      contactReleasedAt: true,
    },
  });
  if (!enquiry) return null;

  const catalogue = await getMatchableCatalogue(businessId);
  const matches = matchLines(
    enquiry.lines.map((l) => ({ description: l.description, size: l.size })),
    catalogue,
  );

  return {
    enquiryId: enquiry.id,
    ref: enquiry.ref,
    state: recipient.state,
    requirement: enquiry.requirement,
    deliverToArea: enquiry.deliverToArea,
    neededBy: enquiry.neededBy,
    termsWanted: enquiry.termsWanted,
    closesAt: enquiry.closesAt,
    createdAt: enquiry.createdAt,
    openedAt: recipient.openedAt,
    firstReplyAt: recipient.firstReplyAt,
    acceptedAt:
      enquiry.contactReleasedToBusinessId === businessId
        ? (enquiry.quotes.find((q) => q.acceptedAt !== null)?.acceptedAt ??
          enquiry.contactReleasedAt)
        : null,
    buyer: buyerForSeller(enquiry.buyer, enquiry.contactReleasedToBusinessId, businessId),
    lines: enquiry.lines.map((l, i) => ({
      id: l.id,
      description: l.description,
      qty: l.qty,
      unit: l.unit,
      size: l.size,
      targetUnitPriceAed: l.targetUnitPriceAed?.toString() ?? null,
      sortOrder: l.sortOrder,
      match: matches[i] ?? { best: null, alternatives: [] },
    })),
    quotes: enquiry.quotes.map((q) => ({
      id: q.id,
      ref: q.ref,
      revision: q.revision,
      status: q.status,
      note: q.note,
      validityDays: q.validityDays,
      sentAt: q.sentAt,
      expiresAt: q.expiresAt,
      totalAed: quoteTotalAed(q.lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice.toString() }))),
      lines: q.lines.map((l) => ({
        id: l.id,
        enquiryLineId: l.enquiryLineId,
        productId: l.productId,
        description: l.description,
        qty: l.qty,
        unitPrice: l.unitPrice.toString(),
        leadTimeDays: l.leadTimeDays,
        sortOrder: l.sortOrder,
      })),
    })),
  };
}

/**
 * The seller's own catalogue, in the shape the matcher wants.
 *
 * Draft products are included: a seller quoting from stock they have not
 * published yet is normal, and hiding it would send them to the manual path
 * for something sitting on their own shelf.
 */
export async function getMatchableCatalogue(businessId: string): Promise<MatchableProduct[]> {
  const products = await prisma.product.findMany({
    where: { businessId },
    select: {
      id: true,
      name: true,
      sku: true,
      searchText: true,
      specValues: true,
      availability: true,
      stockQty: true,
      leadTimeDays: true,
      minOrderQty: true,
    },
    orderBy: { name: "asc" },
  });

  return products.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    searchText: p.searchText ?? "",
    size: nominalSizeOf(p.specValues),
    availability: p.availability,
    stockQty: p.stockQty,
    leadTimeDays: p.leadTimeDays,
    minOrderQty: p.minOrderQty,
  }));
}

/**
 * Pull the nominal diameter out of the spec JSON.
 *
 * Spec values are keyed by SpecField id, not by name, so there is nothing to
 * match on but the value. Any value that reads as a bore is the bore — a
 * product has one, and the alternative is a join per product per lead.
 */
function nominalSizeOf(specValues: unknown): string | null {
  if (!specValues || typeof specValues !== "object") return null;
  for (const value of Object.values(specValues as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    if (/^(dn\s?\d+|\d+(?:[.-]\d+(?:\/\d+)?)?\s*(?:"|″|in|inch|inches))$/i.test(value.trim())) {
      return value.trim();
    }
  }
  return null;
}

export interface QuoteRow {
  id: string;
  ref: string;
  enquiryId: string;
  enquiryRef: string;
  revision: number;
  /** True when a later revision of the same enquiry exists. */
  superseded: boolean;
  status: string;
  validityDays: number;
  sentAt: Date | null;
  readAt: Date | null;
  acceptedAt: Date | null;
  expiresAt: Date | null;
  lineCount: number;
  /** How many lines were priced by hand rather than from the catalogue. */
  manualLineCount: number;
  totalAed: string;
  buyer: SellerVisibleBuyer;
  lostReason: string | null;
}

export async function getQuotesForBusiness(businessId: string): Promise<QuoteRow[]> {
  const quotes = await prisma.quote.findMany({
    where: { businessId },
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      ref: true,
      revision: true,
      status: true,
      validityDays: true,
      sentAt: true,
      readAt: true,
      acceptedAt: true,
      expiresAt: true,
      lostReason: true,
      enquiryId: true,
      enquiry: {
        select: {
          ref: true,
          contactReleasedToBusinessId: true,
          buyer: { select: { fullName: true } },
        },
      },
      lines: { select: { qty: true, unitPrice: true, productId: true } },
    },
  });

  const highestRevision = new Map<string, number>();
  for (const q of quotes) {
    highestRevision.set(q.enquiryId, Math.max(highestRevision.get(q.enquiryId) ?? 0, q.revision));
  }

  return quotes.map((q) => ({
    id: q.id,
    ref: q.ref,
    enquiryId: q.enquiryId,
    enquiryRef: q.enquiry.ref,
    revision: q.revision,
    superseded: (highestRevision.get(q.enquiryId) ?? q.revision) > q.revision,
    status: q.status,
    validityDays: q.validityDays,
    sentAt: q.sentAt,
    readAt: q.readAt,
    acceptedAt: q.acceptedAt,
    expiresAt: q.expiresAt,
    lineCount: q.lines.length,
    manualLineCount: q.lines.filter((l) => l.productId === null).length,
    totalAed: quoteTotalAed(q.lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice.toString() }))),
    buyer: buyerForSeller(q.enquiry.buyer, q.enquiry.contactReleasedToBusinessId, businessId),
    lostReason: q.lostReason,
  }));
}
