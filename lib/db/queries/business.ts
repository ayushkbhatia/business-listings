import "server-only";
import { prisma } from "@/lib/db/client";
import { VERIFIED_TIER } from "@/lib/verification";

/**
 * Server-side reads for the public directory.
 *
 * Every one of these runs on the server. There is no client-side data fetching
 * on a public surface: the first paint has to be complete for Google, and a
 * buyer on a phone in a warehouse should not be waiting on a second round trip
 * to find out whether a supplier stocks DN100.
 *
 * A suspended business is excluded everywhere. An unpublished one too.
 */

/** Rows every public read shares. Suspended and unpublished never appear. */
const PUBLIC_BUSINESS = {
  suspendedAt: null,
  publishedAt: { not: null },
} as const;

export async function getBusinessBySlug(slug: string) {
  return prisma.business.findFirst({
    where: { slug, ...PUBLIC_BUSINESS },
    include: {
      primaryCategory: true,
      categories: { include: { category: true } },
      plan: true,
      locations: {
        where: { published: true },
        include: { area: true },
        orderBy: [{ type: "asc" }, { createdAt: "asc" }],
      },
      media: { orderBy: { sortOrder: "asc" } },
      _count: {
        select: {
          products: { where: { status: { not: "draft" } } },
          reviews: { where: { removedAt: null } },
        },
      },
    },
  });
}

export type PublicBusiness = NonNullable<Awaited<ReturnType<typeof getBusinessBySlug>>>;

export async function getBusinessProducts(
  businessId: string,
  options: { take?: number; skip?: number } = {},
) {
  const { take = 60, skip = 0 } = options;
  return prisma.product.findMany({
    where: { businessId, status: { not: "draft" } },
    include: { category: true, media: { orderBy: { sortOrder: "asc" }, take: 1 } },
    // In stock first: a buyer scanning a catalogue is looking for what they can
    // have now, and made-to-order below it is still a useful answer.
    orderBy: [{ availability: "asc" }, { name: "asc" }],
    take,
    skip,
  });
}

export type PublicProduct = Awaited<ReturnType<typeof getBusinessProducts>>[number];

export async function getProductBySlug(businessSlug: string, productSlug: string) {
  return prisma.product.findFirst({
    where: {
      slug: productSlug,
      status: { not: "draft" },
      business: { slug: businessSlug, ...PUBLIC_BUSINESS },
    },
    include: {
      category: true,
      media: { orderBy: { sortOrder: "asc" } },
      documents: true,
      business: {
        include: {
          primaryCategory: true,
          /*
             Every published location, not one.

             `take: 1` was enough while the product page showed a single
             address. Board 1g derives the delivery band from the seller's
             coverage — `deliversLocally` asks whether any branch states a
             service radius — and with one arbitrary row that answer was
             whichever branch sorted first. A supplier delivering from their
             warehouse read as not delivering at all, and the band quietly
             dropped from same-day to 48 hours.
          */
          locations: { where: { published: true }, include: { area: true } },
        },
      },
    },
  });
}

export type PublicProductDetail = NonNullable<Awaited<ReturnType<typeof getProductBySlug>>>;

/**
 * The live spec template for a category, with its fields in order.
 *
 * Drives both the spec table and the filter rail. A field marked `isFilterable`
 * appears in the rail with no code change, which is handoff 1 criterion 4.
 *
 * Falls back to the parent's template, because templates belong to the trade
 * and not to the niche: the seeded one is on "Valves & fittings" and there is
 * none on "Gate valves". Without this, filing a supplier under a subcategory
 * silently took the spec fields away from their whole catalogue — the editor
 * offered none, the spec table rendered none, and nothing said why.
 */
export async function getSpecTemplate(categoryId: string) {
  const own = await prisma.specTemplate.findFirst({
    where: { categoryId, status: "live" },
    orderBy: { version: "desc" },
    include: { fields: { orderBy: { sortOrder: "asc" } } },
  });
  if (own) return own;

  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { parentId: true },
  });
  if (!category?.parentId) return null;

  return prisma.specTemplate.findFirst({
    where: { categoryId: category.parentId, status: "live" },
    orderBy: { version: "desc" },
    include: { fields: { orderBy: { sortOrder: "asc" } } },
  });
}

export type SpecTemplateWithFields = NonNullable<Awaited<ReturnType<typeof getSpecTemplate>>>;

export async function getBusinessReviews(businessId: string) {
  return prisma.review.findMany({
    // A removed review is gone from every public surface. It is not shown
    // struck through and it is not counted.
    where: { businessId, removedAt: null },
    include: {
      buyer: { select: { fullName: true, buyerCompany: { select: { name: true } } } },
      media: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

export type PublicReview = Awaited<ReturnType<typeof getBusinessReviews>>[number];

/**
 * Claimed suppliers for an unclaimed listing to point at.
 *
 * Board 10g asks for two in the same trade. An unclaimed page that offers a
 * buyer nothing is a dead end for them and a wasted impression for us, so when
 * a category has no claimed suppliers yet — a real state in a young directory,
 * and the exact state that needs recruiting into — the search widens rather
 * than the section disappearing.
 *
 * The basis is returned so the heading can say which it is. "Verified
 * suppliers in the same trade" over a list from a different trade would be the
 * kind of small lie that costs more than the click it earns.
 */
export type SimilarBasis = "category" | "parent" | "emirate";

const SIMILAR_INCLUDE = {
  primaryCategory: true,
  locations: { where: { published: true }, include: { area: true }, take: 1 },
} as const;

const SIMILAR_ORDER = [
  { verificationTier: "desc" },
  { reviewCount: "desc" },
] as const;

export async function getSimilarClaimedBusinesses(
  category: { id: string; parentId: string | null },
  excludeId: string,
  emirate: string | null,
  take = 2,
) {
  const base = {
    ...PUBLIC_BUSINESS,
    claimStatus: "claimed",
    id: { not: excludeId },
  } as const;

  const sameTrade = await prisma.business.findMany({
    where: {
      ...base,
      OR: [
        { primaryCategoryId: category.id },
        { categories: { some: { categoryId: category.id } } },
      ],
    },
    include: SIMILAR_INCLUDE,
    orderBy: [...SIMILAR_ORDER],
    take,
  });
  if (sameTrade.length > 0) return { basis: "category" as SimilarBasis, businesses: sameTrade };

  if (category.parentId) {
    const siblings = await prisma.business.findMany({
      where: {
        ...base,
        primaryCategory: {
          OR: [{ id: category.parentId }, { parentId: category.parentId }],
        },
      },
      include: SIMILAR_INCLUDE,
      orderBy: [...SIMILAR_ORDER],
      take,
    });
    if (siblings.length > 0) return { basis: "parent" as SimilarBasis, businesses: siblings };
  }

  if (!emirate) return { basis: "category" as SimilarBasis, businesses: [] };

  const nearby = await prisma.business.findMany({
    where: {
      ...base,
      verificationTier: { gte: VERIFIED_TIER },
      locations: { some: { emirate: emirate as never, published: true } },
    },
    include: SIMILAR_INCLUDE,
    orderBy: [...SIMILAR_ORDER],
    take,
  });
  return { basis: "emirate" as SimilarBasis, businesses: nearby };
}

export type SimilarBusiness =
  Awaited<ReturnType<typeof getSimilarClaimedBusinesses>>["businesses"][number];

/** Rating breakdown across the four dimensions, for the reviews page. */
export async function getReviewSummary(businessId: string) {
  const [aggregate, count] = await Promise.all([
    prisma.review.aggregate({
      where: { businessId, removedAt: null },
      _avg: {
        overall: true,
        quotedAccurate: true,
        onTime: true,
        asDescribed: true,
        responsiveness: true,
      },
    }),
    prisma.review.count({ where: { businessId, removedAt: null } }),
  ]);

  return { averages: aggregate._avg, count };
}
