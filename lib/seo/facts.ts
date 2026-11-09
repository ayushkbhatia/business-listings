import "server-only";
import { Prisma } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
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
  /**
   * The whole emirate rather than one area inside it, for `/:emirate/:category`.
   *
   * Mutually exclusive with `areaId` in practice — an area already belongs to
   * an emirate, so passing both would narrow to the area and say the emirate
   * out loud for no reason. The narrower one wins if both arrive.
   */
  emirate?: string;
}

/**
 * The set this page is about — decision N14, and T2.6.
 *
 * **Primary *or* additional**, which is the predicate the list underneath uses
 * (`businessWhere` in `lib/db/queries/search.ts`). This read `primaryCategoryId`
 * alone, so every borrowed listing — a supplier whose second trade is this
 * page's — was in the list and out of the header's count. "218 suppliers in Al
 * Quoz" over a list of 240 is the defect `CLAUDE.md` names first under
 * interface honesty, and it was in the one place a buyer cannot check it.
 *
 * N14 asked which way to resolve it: take the list's predicate, because a
 * listing a buyer can see and click is a listing the count has to admit to.
 */
function businessWhere(scope: FactsScope) {
  const place = scope.areaId
    ? { locations: { some: { areaId: scope.areaId, published: true } } }
    : scope.emirate
      ? { locations: { some: { emirate: scope.emirate as never, published: true } } }
      : {};

  return {
    ...PUBLIC_BUSINESS,
    OR: [
      { primaryCategoryId: { in: scope.categoryIds } },
      { categories: { some: { categoryId: { in: scope.categoryIds } } } },
    ],
    ...place,
  };
}

/**
 * The same three clauses as SQL, for the two figures that cannot be counted
 * without aggregating.
 *
 * A second predicate, and a small one: public, the category set, the place.
 * `landingFactsAgree` in the test asserts it matches the Prisma one by count,
 * so the pair cannot drift — the same control `predicate-sql-parity.test.ts`
 * puts on the search predicate.
 */
function scopeSql(scope: FactsScope): Prisma.Sql {
  const ids = Prisma.join(scope.categoryIds.map((id) => Prisma.sql`${id}`), ", ");
  const and: Prisma.Sql[] = [
    Prisma.sql`b.suspended_at IS NULL AND b.published_at IS NOT NULL`,
    Prisma.sql`(
      b.primary_category_id IN (${ids})
      OR EXISTS (
        SELECT 1 FROM business_category bc
        WHERE bc.business_id = b.id AND bc.category_id IN (${ids})
      )
    )`,
  ];
  if (scope.areaId) {
    and.push(Prisma.sql`EXISTS (
      SELECT 1 FROM location l2
      WHERE l2.business_id = b.id AND l2.published = true AND l2.area_id = ${scope.areaId}
    )`);
  } else if (scope.emirate) {
    and.push(Prisma.sql`EXISTS (
      SELECT 1 FROM location l2
      WHERE l2.business_id = b.id AND l2.published = true
        AND l2.emirate = ${scope.emirate}::"emirate"
    )`);
  }
  return Prisma.join(and, " AND ");
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
       One row per emirate, counted distinct on the business — T2.6.

       A supplier with a yard in Dubai and a counter in Sharjah is in both
       emirates, which is what a buyer filtering by emirate finds, so this is
       not a count of businesses. It used to ship **every published location in
       the scope** to the process and de-duplicate there, which is an unbounded
       read on a request path: 21,227 rows for Dubai on the 41,000-row harness,
       for seven numbers. `count(DISTINCT …)` says the same thing in one row.
    */
    prisma.$queryRaw<{ emirate: Emirate; listings: bigint }[]>(Prisma.sql`
      SELECT l.emirate, count(DISTINCT l.business_id) AS listings
      FROM location l
      JOIN business b ON b.id = l.business_id
      WHERE l.published = true AND ${scopeSql(scope)}
      GROUP BY l.emirate
      ORDER BY listings DESC, l.emirate ASC
    `),
    /*
       The median of the per-business medians, in one row.

       `percentile_cont(0.5)` interpolates between the two middles on an even
       count, which is what `median()` does — the mean of the two — so the
       rounding is the only difference and it is applied here. This also shipped
       every measurable median to the process to sort them.
    */
    prisma.$queryRaw<{ median: number | null; measurable: bigint }[]>(Prisma.sql`
      SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY b.response_time_median_ms))::double precision AS median,
             count(*) AS measurable
      FROM business b
      WHERE b.response_time_median_ms IS NOT NULL AND ${scopeSql(scope)}
    `),
    prisma.product.count({ where: { status: { not: "draft" }, business: where } }),
    prisma.product.groupBy({
      by: ["availability"],
      where: { status: { not: "draft" }, business: where },
      _count: { _all: true },
    }),
  ]);

  const reply = replies[0] ?? { median: null, measurable: 0n };

  return {
    listings,
    verified,
    emirates: locations.map((row) => ({ emirate: row.emirate, listings: Number(row.listings) })),
    replyMedianMs: reply.median === null ? null : Number(reply.median),
    replyMeasurable: Number(reply.measurable),
    products,
    availability: availability
      .map((row) => ({ availability: row.availability, products: row._count._all }))
      .sort((a, b) => b.products - a.products),
  };
}
