import "server-only";
import { cache } from "react";
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

/**
 * One storefront, with its rating measured rather than read off a column.
 *
 * `Business.ratingOverall` and `Business.reviewCount` are denormalised columns
 * a nightly job writes. They are correct most of the time, and "most of the
 * time" is not what a directory sells: the moment a review is removed or held,
 * the header on `/b/:slug/reviews` would print an average the list below it
 * disagrees with, in the same request. Criterion 6 of board 1m says the two
 * cannot differ, so the figure the header renders is computed here from the
 * published rows and the stored column is not read on a public surface at all.
 *
 * One aggregate on an indexed column, against a route that already runs five
 * queries. The alternative — a job, and a window in which the page lies — is
 * the thing CLAUDE.md means by "every number is a query, not a constant".
 */
/**
 * The counts each storefront tab calls `notFound()` on when they are zero.
 *
 * Exported because `app/sitemap.ts` has to ask the same question this route
 * answers, and asking it a second way is how the sitemap came to submit
 * `/b/:slug/reviews` for sellers whose only reviews were removed or held. A
 * held review is not a review the tab will render, and a sitemap entry for a
 * page that 404s is the file claiming something untrue about the site.
 *
 * `locations` is `published: true` because that is what `getBusinessBySlug`
 * selects below and what the branches tab counts; `products` matches
 * `PUBLIC_PRODUCT` in lib/db/queries/storefront-catalogue.ts, which is what
 * `catalogueTotal` is measured against.
 */
export const STOREFRONT_TAB_COUNTS = {
  products: { where: { status: { not: "draft" as const } } },
  locations: { where: { published: true } },
  reviews: { where: { removedAt: null, heldAt: null } },
} as const;

export async function getBusinessBySlug(slug: string) {
  const business = await prisma.business.findFirst({
    where: { slug, ...PUBLIC_BUSINESS },
    include: {
      primaryCategory: true,
      categories: { include: { category: true } },
      // Two columns, named. `id` decides the Pro chip and the Free-plan
      // storefront, `rankingMultiplier` nothing here — but see the note in
      // lib/db/queries/search.ts: a bare `plan: true` on a public route is how
      // an unapplied billing migration became a 500 on every category page.
      plan: { select: { id: true, rankingMultiplier: true } },
      locations: {
        where: { published: true },
        include: { area: true },
        orderBy: [{ type: "asc" }, { createdAt: "asc" }],
      },
      media: { orderBy: { sortOrder: "asc" } },
      _count: { select: STOREFRONT_TAB_COUNTS },
    },
  });
  if (!business) return null;

  const { _avg } = await prisma.review.aggregate({
    where: { businessId: business.id, removedAt: null, heldAt: null },
    _avg: { overall: true },
  });

  // The stored columns are shadowed, not deleted: the search index and the
  // seller's own dashboard still rank on them, and a public read should not be
  // the thing that decides when a job runs.
  return { ...business, ratingOverall: _avg.overall, reviewCount: business._count.reviews };
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
/**
 * Memoised per request — see the note on `getCategoryBySlug`.
 *
 * The results page reads the template twice: once in `Results` for the spec
 * column, once inside `getSpecFacets` for the rail. Each read is two queries
 * (the template, then its fields), so this was four round trips for one answer.
 */
export const getSpecTemplate = cache(async (categoryId: string) => {
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
});

export type SpecTemplateWithFields = NonNullable<Awaited<ReturnType<typeof getSpecTemplate>>>;

export async function getBusinessReviews(businessId: string) {
  return prisma.review.findMany({
    // A removed review is gone from every public surface. It is not shown
    // struck through and it is not counted.
    where: { businessId, removedAt: null, heldAt: null },
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
      where: { businessId, removedAt: null, heldAt: null },
      _avg: {
        overall: true,
        quotedAccurate: true,
        onTime: true,
        asDescribed: true,
        responsiveness: true,
      },
    }),
    prisma.review.count({ where: { businessId, removedAt: null, heldAt: null } }),
  ]);

  return { averages: aggregate._avg, count };
}
