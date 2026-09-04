import "server-only";
import { Prisma } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { CRITICAL_AT_OR_BELOW, DIMENSIONS } from "@/lib/reviews/eligibility";

/**
 * Board 1m — everything behind one seller's Reviews tab.
 *
 * The page's argument is provenance, not the star rating. "4.8" means nothing
 * on its own; "4.8 from 126 reviews, 94 of them from accepted quotes" means
 * something no competitor can fake — so the counts here are the product, and
 * every one of them is a query rather than a stored column somebody can edit.
 *
 * ## What "published" means, in one place
 *
 * A removed review is gone and a held one is paused, and both are out of every
 * figure on this page from the moment they are set — the average, the four
 * dimension averages, the distribution, the provenance counts, the filter chip
 * counts and `AggregateRating`. That is one condition, written once as
 * `PUBLISHED` and `publishedSql`, because six places agreeing by hand is six
 * places that eventually do not.
 */

/**
 * Ten. The "Load more" label is derived from it and is never written by hand.
 *
 * Board 1m: *"the label states what one click delivers, not what remains"* —
 * the board's own render read "Load 123 more reviews" over a page that fetches
 * ten. The page size and the label are one decision, so they are one constant.
 */
export const REVIEWS_PAGE_SIZE = 10;

/** The four chips, in the order the board draws them. */
export const REVIEW_FILTERS = ["all", "accepted", "photos", "critical"] as const;
export type ReviewFilter = (typeof REVIEW_FILTERS)[number];

/** The four sorts. There is no rating a seller can buy their way up. */
export const REVIEW_SORTS = ["recent", "highest", "lowest", "detailed"] as const;
export type ReviewSort = (typeof REVIEW_SORTS)[number];

export interface ReviewQuery {
  filter: ReviewFilter;
  sort: ReviewSort;
  /** 1-based. Every page up to and including this one is rendered. */
  page: number;
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseReviewQuery(
  params: Record<string, string | string[] | undefined>,
): ReviewQuery {
  const filter = one(params["show"]);
  const sort = one(params["sort"]);
  const page = Number(one(params["page"]));

  return {
    filter: REVIEW_FILTERS.includes(filter as ReviewFilter) ? (filter as ReviewFilter) : "all",
    sort: REVIEW_SORTS.includes(sort as ReviewSort) ? (sort as ReviewSort) : "recent",
    page: Number.isFinite(page) && page > 1 ? Math.floor(page) : 1,
  };
}

/** The same view with some part of it changed. Empty string means the bare path. */
export function toReviewParams(
  query: ReviewQuery,
  overrides: Partial<ReviewQuery> = {},
): string {
  const merged = { ...query, ...overrides };
  const params = new URLSearchParams();
  if (merged.filter !== "all") params.set("show", merged.filter);
  if (merged.sort !== "recent") params.set("sort", merged.sort);
  if (merged.page > 1) params.set("page", String(merged.page));
  return params.toString();
}

/** True when the visitor has narrowed the list. A narrowed view is not canonical. */
export function isReviewFiltered(query: ReviewQuery): boolean {
  return query.filter !== "all" || query.sort !== "recent" || query.page > 1;
}

/**
 * Published: not removed, not held.
 *
 * Criterion 6 — *"a removed or held review is excluded from every average and
 * from `AggregateRating` in the same request"* — is this object, used by every
 * query in this file and by the storefront's own summary.
 */
export const PUBLISHED = { removedAt: null, heldAt: null } as const;

/** The same condition in SQL, for the one query Prisma cannot express. */
const publishedSql = Prisma.sql`"removed_at" is null and "held_at" is null`;

/**
 * The filter, as a Prisma condition and as SQL.
 *
 * Two renderings of one rule is exactly the drift this file's header warns
 * about, so they sit next to each other and the test asserts the pair returns
 * the same set for each chip.
 */
/**
 * What each chip narrows to, independent of whether the row is published.
 *
 * Split from the publication state because the held line under the list has to
 * count held rows *in the current filter*: "one review is being reviewed by our
 * team" under the With-photos chip, when the held review has no photos, is the
 * page accounting for a row that is not in the list it sits under.
 */
function filterOnly(businessId: string, filter: ReviewFilter): Prisma.ReviewWhereInput {
  switch (filter) {
    case "accepted":
      // The strongest rung, read off the enquiry rather than off a column on
      // the review — the fact is already stored once, and a second copy of a
      // fact is a copy that can disagree with it.
      return { enquiry: { contactReleasedToBusinessId: businessId } };
    case "photos":
      return { media: { some: {} } };
    case "critical":
      return { overall: { lte: CRITICAL_AT_OR_BELOW } };
    case "all":
      return {};
  }
}

function filterWhere(businessId: string, filter: ReviewFilter): Prisma.ReviewWhereInput {
  return { businessId, ...PUBLISHED, ...filterOnly(businessId, filter) };
}

/** The same narrowing over the rows a moderator has paused. */
function heldWhere(businessId: string, filter: ReviewFilter): Prisma.ReviewWhereInput {
  return {
    businessId,
    removedAt: null,
    heldAt: { not: null },
    ...filterOnly(businessId, filter),
  };
}

function filterSql(businessId: string, filter: ReviewFilter): Prisma.Sql {
  switch (filter) {
    case "accepted":
      return Prisma.sql`and exists (
        select 1 from "enquiry" e
        where e."id" = r."enquiry_id"
          and e."contact_released_to_business_id" = ${businessId}
      )`;
    case "photos":
      return Prisma.sql`and exists (select 1 from "media" m where m."review_id" = r."id")`;
    case "critical":
      return Prisma.sql`and r."overall" <= ${CRITICAL_AT_OR_BELOW}`;
    case "all":
      return Prisma.empty;
  }
}

/**
 * The ordering.
 *
 * Three of the four are plain columns and Prisma could order them. "Most
 * detailed" is `length(body)`, which it cannot — and running one sort down a
 * different code path from the other three is how two orderings of the same
 * list end up disagreeing about which rows are on page two. So all four are
 * ordered here, by the database, in one place.
 *
 * `created_at desc` is the tie-break on every one of them: a page whose order
 * is undefined between equal rows is a page that can show the same review
 * twice across two clicks of "Load more".
 */
function orderSql(sort: ReviewSort): Prisma.Sql {
  switch (sort) {
    case "highest":
      return Prisma.sql`order by r."overall" desc, r."created_at" desc`;
    case "lowest":
      return Prisma.sql`order by r."overall" asc, r."created_at" desc`;
    case "detailed":
      return Prisma.sql`order by length(r."body") desc, r."created_at" desc`;
    case "recent":
      return Prisma.sql`order by r."created_at" desc`;
  }
}

const REVIEW_INCLUDE = {
  buyer: {
    select: {
      fullName: true,
      /*
         The buyer's own registered company name, rendered exactly as they
         entered it at /account/company — suffix included.

         Board 1m is explicit that this is not the display-name rule's business:
         that rule governs *seller* identity, where a legal name and a trading
         name genuinely differ and a buyer who reads one lands on the other.
         Buyers have no display-name field, so stripping "LLC" off theirs would
         be inventing data about a company that did not ask us to.
      */
      buyerCompany: { select: { name: true } },
    },
  },
  media: { select: { id: true, storagePath: true, alt: true }, orderBy: { sortOrder: "asc" } },
  enquiry: { select: { contactReleasedToBusinessId: true } },
} as const satisfies Prisma.ReviewInclude;

export type ReviewRow = Prisma.ReviewGetPayload<{ include: typeof REVIEW_INCLUDE }>;

export interface ReviewSummary {
  /** Published only. Zero means the tab does not exist. */
  count: number;
  /** Null at zero reviews — never a zero rendered as a rating. */
  average: number | null;
  /** Averages per dimension, in the board's order. Null where nothing to average. */
  dimensions: { key: (typeof DIMENSIONS)[number]; average: number | null }[];
  /** 5 → 1. Index 0 is five stars. */
  distribution: { rating: number; count: number }[];
}

export interface ReviewCounts {
  all: number;
  accepted: number;
  photos: number;
  critical: number;
}

export interface ReviewBoard {
  summary: ReviewSummary;
  counts: ReviewCounts;
  /**
   * Held rows inside the current filter. Rendered as a line, never as a row.
   *
   * Filter-aware on purpose: the line explains a gap between the count above
   * the list and the rows in it, so it has to be counting rows that would
   * otherwise be in *this* list.
   */
  heldCount: number;
  /** The rows for pages 1..query.page of the current filter and sort. */
  reviews: ReviewRow[];
  /** Rows matching the current filter, published only. */
  total: number;
}

/**
 * Board 1m's data requirements, in one round trip's worth of queries.
 *
 * The provenance of each row is derived from `enquiry.contactReleasedToBusinessId`
 * rather than stored, so the badge on a row and the count in the chip above it
 * cannot disagree: they are the same predicate, asked once per row and once in
 * aggregate.
 */
export async function getReviewBoard(
  businessId: string,
  query: ReviewQuery,
): Promise<ReviewBoard> {
  const take = query.page * REVIEWS_PAGE_SIZE;

  const [aggregate, distributionRows, counts, heldCount, total, ids] = await Promise.all([
    prisma.review.aggregate({
      where: { businessId, ...PUBLISHED },
      _avg: {
        overall: true,
        quotedAccurate: true,
        onTime: true,
        asDescribed: true,
        responsiveness: true,
      },
      _count: { _all: true },
    }),
    prisma.review.groupBy({
      by: ["overall"],
      where: { businessId, ...PUBLISHED },
      _count: { _all: true },
    }),
    reviewCounts(businessId),
    prisma.review.count({ where: heldWhere(businessId, query.filter) }),
    prisma.review.count({ where: filterWhere(businessId, query.filter) }),
    /*
       Ids first, then the rows.

       The page is ordered by the database — including by `length(body)`, which
       Prisma has no expression for — and hydrating through Prisma afterwards
       keeps one definition of what a review row carries. Ordering is reapplied
       below because `IN (...)` does not preserve it.
    */
    prisma.$queryRaw<{ id: string }[]>`
      select r."id"
      from "review" r
      where r."business_id" = ${businessId}
        and ${publishedSql}
        ${filterSql(businessId, query.filter)}
      ${orderSql(query.sort)}
      limit ${take}
    `,
  ]);

  const order = new Map(ids.map((row, index) => [row.id, index]));
  const rows = order.size === 0
    ? []
    : await prisma.review.findMany({
        where: { id: { in: ids.map((row) => row.id) } },
        include: REVIEW_INCLUDE,
      });
  rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  const byRating = new Map(distributionRows.map((row) => [row.overall, row._count._all]));

  return {
    summary: {
      count: aggregate._count._all,
      average: aggregate._avg.overall,
      dimensions: DIMENSIONS.map((key) => ({ key, average: aggregate._avg[key] })),
      distribution: [5, 4, 3, 2, 1].map((rating) => ({
        rating,
        count: byRating.get(rating) ?? 0,
      })),
    },
    counts,
    heldCount,
    reviews: rows,
    total,
  };
}

/**
 * The four chip counts.
 *
 * "Critical" is counted and shown even at zero. Board 1m: *"never hide the
 * filter to avoid drawing attention to a perfect record; a visible zero is more
 * credible than a missing control"* — and a reviews page with no way to find
 * the complaints reads as curated, which is worse than a complaint.
 */
export async function reviewCounts(businessId: string): Promise<ReviewCounts> {
  const [all, accepted, photos, critical] = await Promise.all(
    REVIEW_FILTERS.map((filter) =>
      prisma.review.count({ where: filterWhere(businessId, filter) }),
    ),
  );
  return { all: all!, accepted: accepted!, photos: photos!, critical: critical! };
}
