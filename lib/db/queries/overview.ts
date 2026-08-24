import "server-only";
import { prisma } from "@/lib/db/client";
import { allowance, monthStart, type Metered, type PlanCaps } from "@/lib/plan/entitlements";

/**
 * The two overview boards, 3a and 11a, read from one place.
 *
 * They are the same query. The Free board is not a degraded Pro board — it is
 * the same figures with a different argument laid over them, and computing
 * them twice is how the two screens start disagreeing about how many enquiries
 * a seller had this month.
 *
 * Nothing here selects a buyer column. The missed-enquiry list has no buyer
 * relation to select from; the reply queue goes through the leads query, which
 * masks. See seller-visibility.ts.
 */

export interface MissedEnquiryRow {
  enquiryId: string;
  ref: string;
  requirement: string;
  /** The line items, so "what did I miss" is answerable without a buyer. */
  lines: { description: string; qty: number; unit: string | null }[];
  deliverToArea: string | null;
  neededBy: Date | null;
  missedAt: Date;
  reason: string;
  /** True while the enquiry is still open, so the seller knows it is not lost yet. */
  stillOpen: boolean;
}

export interface OverviewUsage {
  enquiriesThisMonth: number;
  products: number;
  locations: number;
  photos: number;
  seats: number;
}

export interface Overview {
  plan: PlanCaps;
  allPlans: PlanCaps[];
  usage: OverviewUsage;
  /** Waiting on the seller: delivered or opened, not yet quoted. */
  awaitingReply: number;
  /** Quotes sent and not yet accepted or declined. */
  quotesOut: number;
  /** Threads whose most recent message is the buyer's. */
  threadsAwaitingReply: number;
  reviewsAwaitingReply: number;
  missed: MissedEnquiryRow[];
  missedThisMonth: number;
  profileStrength: number | null;
  responseTimeMedianMs: number | null;
  verificationTier: number;
}

const PLAN_SELECT = {
  id: true,
  name: true,
  monthlyPriceAed: true,
  enquiriesPerMonth: true,
  productLimit: true,
  locationLimit: true,
  photoLimit: true,
  teamSeats: true,
  rankingMultiplier: true,
  customDomain: true,
  siteVisitIncluded: true,
  sortOrder: true,
} as const;

/**
 * Everything both overviews need, in one round trip's worth of parallel reads.
 *
 * `now` is a parameter rather than `new Date()` so a test can sit on a month
 * boundary, which is exactly where a monthly cap is worth testing.
 */
export async function getOverview(businessId: string, now = new Date()): Promise<Overview | null> {
  const since = monthStart(now);

  const [business, allPlans] = await Promise.all([
    prisma.business.findUnique({
      where: { id: businessId },
      select: {
        profileStrength: true,
        responseTimeMedianMs: true,
        verificationTier: true,
        plan: { select: PLAN_SELECT },
      },
    }),
    prisma.plan.findMany({ orderBy: { sortOrder: "asc" }, select: PLAN_SELECT }),
  ]);

  if (!business) return null;

  // A business with no plan row is on Free. The column is nullable because the
  // 41,000 imported records have never chosen anything.
  const plan = business.plan ?? allPlans.find((p) => p.monthlyPriceAed === 0) ?? allPlans[0];
  if (!plan) return null;

  const [
    enquiriesThisMonth,
    products,
    locations,
    photos,
    seats,
    awaitingReply,
    quotesOut,
    threadsAwaitingReply,
    reviewsAwaitingReply,
    missedRows,
    missedThisMonth,
  ] = await Promise.all([
    prisma.enquiryRecipient.count({ where: { businessId, createdAt: { gte: since } } }),
    prisma.product.count({ where: { businessId } }),
    prisma.location.count({ where: { businessId } }),
    // A photo on a product is still one of the seller's photos, and the plan's
    // photoLimit governs both. Review media is the buyer's and is not counted.
    prisma.media.count({
      where: { OR: [{ businessId }, { product: { businessId } }], reviewId: null },
    }),
    prisma.user.count({ where: { businessId } }),
    prisma.enquiryRecipient.count({ where: { businessId, state: { in: ["delivered", "opened"] } } }),
    prisma.quote.count({ where: { businessId, status: { in: ["sent", "read"] } } }),
    threadsAwaitingReplyFor(businessId),
    prisma.review.count({ where: { businessId, removedAt: null, sellerReply: null } }),
    prisma.missedEnquiry.findMany({
      where: { businessId, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        reason: true,
        createdAt: true,
        enquiry: {
          select: {
            id: true,
            ref: true,
            requirement: true,
            deliverToArea: true,
            neededBy: true,
            closesAt: true,
            lines: {
              orderBy: { sortOrder: "asc" },
              select: { description: true, qty: true, unit: true },
            },
          },
        },
      },
    }),
    prisma.missedEnquiry.count({ where: { businessId, createdAt: { gte: since } } }),
  ]);

  return {
    plan,
    allPlans,
    usage: { enquiriesThisMonth, products, locations, photos, seats },
    awaitingReply,
    quotesOut,
    threadsAwaitingReply,
    reviewsAwaitingReply,
    missedThisMonth,
    missed: missedRows.map((row) => ({
      enquiryId: row.enquiry.id,
      ref: row.enquiry.ref,
      requirement: row.enquiry.requirement,
      lines: row.enquiry.lines,
      deliverToArea: row.enquiry.deliverToArea,
      neededBy: row.enquiry.neededBy,
      missedAt: row.createdAt,
      reason: row.reason,
      stillOpen: row.enquiry.closesAt.getTime() > now.getTime(),
    })),
    profileStrength: business.profileStrength,
    responseTimeMedianMs: business.responseTimeMedianMs,
    verificationTier: business.verificationTier,
  };
}

/**
 * Threads where the last word was the buyer's.
 *
 * There is no read receipt on Message and this does not invent one — "unread"
 * is not a fact this schema holds. Whose message is most recent is, and it is
 * the better question anyway: the board asks what needs a reply, and a message
 * a seller opened and did not answer still needs one.
 *
 * A message is the seller's when its sender belongs to this business, the same
 * derivation lib/messaging/service.ts uses for `fromSeller`. DISTINCT ON takes
 * the latest row per thread in one pass rather than one query per enquiry.
 */
async function threadsAwaitingReplyFor(businessId: string): Promise<number> {
  const [row] = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM (
      SELECT DISTINCT ON (m.enquiry_id)
             m.enquiry_id,
             u.business_id AS sender_business
        FROM message m
        JOIN "user" u ON u.id = m.sender_id
       WHERE m.business_id = ${businessId}
       ORDER BY m.enquiry_id, m.created_at DESC
    ) latest
    WHERE latest.sender_business IS DISTINCT FROM ${businessId}
  `;
  return Number(row?.n ?? 0);
}

/** The allowance for one metered resource, from an overview already loaded. */
export function usageOf(overview: Overview, what: Metered) {
  const used: Record<Metered, number> = {
    enquiries: overview.usage.enquiriesThisMonth,
    products: overview.usage.products,
    locations: overview.usage.locations,
    photos: overview.usage.photos,
    seats: overview.usage.seats,
  };
  return allowance(overview.plan, what, used[what]);
}
