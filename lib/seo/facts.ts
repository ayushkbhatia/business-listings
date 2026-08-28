import "server-only";
import { prisma } from "@/lib/db/client";
import { median } from "@/lib/metrics/response-time";
import { VERIFIED_TIER } from "@/lib/verification";
import type { Availability, Emirate } from "@/lib/db/generated/enums";

/**
 * The numbers a landing page is built out of.
 *
 * Criterion 2: "Area and subcategory pages render entirely from data plus a
 * single authored intro — adding a new emirate or subcategory needs no code
 * change." Everything a template says beyond its intro paragraph comes from
 * here, so adding a subcategory adds a page and nothing else.
 *
 * Criterion 3 leans on the same shape: the FAQ answers are built from these
 * counts, so they move when the data moves rather than being written once and
 * quietly going stale. Area pages in step 3 call the same function with an
 * area filter.
 *
 * Nothing here is a claim. A number that cannot be measured comes back null and
 * the sentence that needed it is not written — the rule the response-time badge
 * has followed since handoff 1, applied to prose.
 */

/** Published, not suspended. The one definition of a listing the public sees. */
const PUBLIC_BUSINESS = { suspendedAt: null, publishedAt: { not: null } } as const;

export interface EmirateCount {
  emirate: Emirate;
  listings: number;
}

export interface AvailabilityCount {
  availability: Availability;
  products: number;
}

export interface LandingFacts {
  listings: number;
  verified: number;
  /** Emirates with at least one published location, biggest first. */
  emirates: EmirateCount[];
  /**
   * The median of the per-business medians, across those that have one.
   *
   * Not a mean, and not computed across every enquiry: a single supplier who
   * answers 400 enquiries would otherwise be the whole number. Null when
   * nobody in the set has a measurable reply time.
   */
  replyMedianMs: number | null;
  /** How many listings that median is drawn from. Shown, never hidden. */
  replyMeasurable: number;
  products: number;
  availability: AvailabilityCount[];
}

export interface FactsScope {
  categoryIds: string[];
  /** Step 3 passes this for an area landing page. */
  areaId?: string;
}

function businessWhere(scope: FactsScope) {
  return {
    ...PUBLIC_BUSINESS,
    primaryCategoryId: { in: scope.categoryIds },
    ...(scope.areaId
      ? { locations: { some: { areaId: scope.areaId, published: true } } }
      : {}),
  };
}

export async function landingFacts(scope: FactsScope): Promise<LandingFacts> {
  if (scope.categoryIds.length === 0) {
    return {
      listings: 0,
      verified: 0,
      emirates: [],
      replyMedianMs: null,
      replyMeasurable: 0,
      products: 0,
      availability: [],
    };
  }

  const where = businessWhere(scope);

  const [listings, verified, locations, replies, products, availability] = await Promise.all([
    prisma.business.count({ where }),
    prisma.business.count({ where: { ...where, verificationTier: { gte: VERIFIED_TIER } } }),
    /*
       Grouped over locations, then de-duplicated by business below: a supplier
       with a yard in Dubai and a counter in Sharjah is in both emirates, which
       is what a buyer filtering by emirate will find, and it is why this is not
       a count of businesses.
    */
    prisma.location.findMany({
      where: { published: true, business: where },
      select: { emirate: true, businessId: true },
    }),
    prisma.business.findMany({
      where: { ...where, responseTimeMedianMs: { not: null } },
      select: { responseTimeMedianMs: true },
    }),
    prisma.product.count({ where: { status: { not: "draft" }, business: where } }),
    prisma.product.groupBy({
      by: ["availability"],
      where: { status: { not: "draft" }, business: where },
      _count: { _all: true },
    }),
  ]);

  const byEmirate = new Map<Emirate, Set<string>>();
  for (const location of locations) {
    const set = byEmirate.get(location.emirate) ?? new Set<string>();
    set.add(location.businessId);
    byEmirate.set(location.emirate, set);
  }

  return {
    listings,
    verified,
    emirates: [...byEmirate.entries()]
      .map(([emirate, ids]) => ({ emirate, listings: ids.size }))
      .sort((a, b) => b.listings - a.listings || a.emirate.localeCompare(b.emirate)),
    replyMedianMs: median(replies.map((row) => row.responseTimeMedianMs as number)),
    replyMeasurable: replies.length,
    products,
    availability: availability
      .map((row) => ({ availability: row.availability, products: row._count._all }))
      .sort((a, b) => b.products - a.products),
  };
}
