import "server-only";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import type { Prisma } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { isCode, matchNeedle } from "@/lib/search/index-text";
import { nearestKm } from "@/lib/geo/distance";
import {
  resolveOrigin,
  shapeOf,
  weightsForShape,
  type QueryShape,
  type SortOrigin,
} from "@/lib/search/origin";
import { liveBoosts, liveWeights } from "@/lib/search/settings";
import {
  placeSponsored,
  rank,
  type RankingWeights,
} from "@/lib/search/ranking";
import {
  appliedKeys,
  countable,
  withoutFacet,
  type SearchQuery,
  type SearchSort,
} from "@/lib/search/query";
import { VERIFIED_TIER } from "@/lib/verification";

/**
 * The search. Two tabs over one query, both server-side.
 *
 * Matching is substring on a denormalised surface rather than full-text: a
 * buyer types `DN100` or `4"` and means an exact fragment of a machine string,
 * and a stemmer helps with neither. `product.search_text` carries the name, the
 * SKU, every spec value and every imperial synonym of the metric size, which is
 * what lets a DN100 query reach a product the seller typed as 4".
 */

const PUBLIC_BUSINESS = { suspendedAt: null, publishedAt: { not: null } } as const;

export const PAGE_SIZE = 20;

function tokens(q: string): string[] {
  return q
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .slice(0, 8);
}

// ─────────────────────────────────────────────────────────────────────────────
// Business filters
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The filter set, as one `where`.
 *
 * Exported so board 1b's header and chip counts are the same predicate the
 * results are, rather than a second one that drifts. Facet counts that do not
 * respect the other active filters are the classic mistake here, and the only
 * durable fix is that there is one function.
 */
export function businessWhere(query: SearchQuery, categoryIds?: string[]): Prisma.BusinessWhereInput {
  const and: Prisma.BusinessWhereInput[] = [PUBLIC_BUSINESS];

  if (categoryIds?.length) {
    and.push({
      OR: [
        { primaryCategoryId: { in: categoryIds } },
        { categories: { some: { categoryId: { in: categoryIds } } } },
      ],
    });
  }

  for (const token of tokens(query.q)) {
    /*
       The match surface first, then the columns it was built from.

       `searchText` is what makes a *specification* find a supplier — board 1c's
       first requirement, and the thing the four clauses below cannot do however
       they are arranged, because none of them can see a product's spec values.

       The originals stay as a second branch rather than being replaced. The
       column is null on every row until `pnpm reindex` has run, and a search
       that returned nothing at all on a freshly-migrated database would look
       exactly like a broken index.
    */
    const branches: Prisma.BusinessWhereInput[] = [
      { searchText: { contains: matchNeedle(token), mode: "insensitive" } },
    ];

    /*
       Only names get the loose branches. A code matched as a bare substring is
       criterion 2's failure — `DN10` reaching a supplier whose name or
       catalogue carries `DN100` — and `matchNeedle` has already padded it so
       the surface above matches it whole. Nothing else may widen that back out.
    */
    if (!isCode(token)) {
      branches.push(
        { displayName: { contains: token, mode: "insensitive" } },
        { tradeName: { contains: token, mode: "insensitive" } },
        // Category synonyms are how an Arabic query reaches an English listing:
        // صمامات is a synonym on the valves category, and every supplier in it
        // matches without a word of Arabic in their own record.
        { primaryCategory: { OR: [{ name: { contains: token, mode: "insensitive" } }, { synonyms: { has: token } }] } },
        { categories: { some: { category: { OR: [{ name: { contains: token, mode: "insensitive" } }, { synonyms: { has: token } }] } } } },
      );
    }

    and.push({ OR: branches });
  }

  if (query.tier) and.push({ verificationTier: { gte: query.tier } });
  if (query.yearsTrading) {
    and.push({ establishedYear: { lte: new Date().getFullYear() - query.yearsTrading } });
  }
  if (query.replyWithinHours) {
    and.push({ responseTimeMedianMs: { lte: query.replyWithinHours * 3_600_000 } });
  }

  const locationFilters: Prisma.LocationWhereInput = { published: true };
  /*
     The map viewport, when the buyer pressed "Search this area".

     It belongs here rather than only in the pin query: criterion 6 says the
     button *re-queries*, and a box that moved the pins while leaving the list
     showing suppliers in Fujairah would be the map and the list disagreeing
     about what was asked.

     Panning still changes nothing, because panning does not write `bounds` —
     only the button does. That is the whole of "panning alone does not re-rank".

     A supplier with no coordinates drops out of a bounded search, and that is
     correct rather than unfortunate: the buyer has asked "who is *here*", and
     we do not know whether an unpinned supplier is. The unbounded search still
     finds them, which is what the zoom-out state offers.
  */
  if (query.bounds) {
    locationFilters.lat = { gte: query.bounds.south, lte: query.bounds.north };
    locationFilters.lng = { gte: query.bounds.west, lte: query.bounds.east };
  }
  if (query.emirate) locationFilters.emirate = query.emirate as never;
  if (query.area) locationFilters.area = { slug: query.area };
  // A free zone is a cross-cutting toggle, not a place in the area hierarchy.
  // A free zone is a cross-cutting toggle, not a place in the area hierarchy —
  // it narrows whatever area filter is already set rather than replacing it.
  if (query.freeZone) {
    locationFilters.area = { ...(locationFilters.area as object | undefined), isFreeZone: true };
  }
  if (Object.keys(locationFilters).length > 1) and.push({ locations: { some: locationFilters } });

  if (query.availability?.length) {
    and.push({ products: { some: { availability: { in: query.availability as never[] }, status: { not: "draft" } } } });
  }

  return { AND: and };
}

const BUSINESS_INCLUDE = {
  primaryCategory: true,
  /*
     One column, named.

     `plan: true` pulled every column on Plan onto a public browse path that
     reads exactly one of them — `rankingMultiplier`, in `searchBusinesses`
     below. On 2026-09-04 that turned a billing migration nobody had applied to
     production into a 500 on the busiest public route on the site: the code
     asked for `plan.annual_months_charged`, the database did not have it, and
     `prisma.business.findMany()` threw for every visitor and every crawler.

     Naming the column is the fix and also the guard. A billing column added
     tomorrow cannot reach this query, so a schema that lags the code can no
     longer take the directory down over a field the directory never reads.
  */
  plan: { select: { rankingMultiplier: true } },
  /*
     Up to five branches, not one.

     The card still shows the first, but distance is measured to the *nearest*
     of them: a Jebel Ali supplier with a Deira trade counter is close to a
     Deira buyer, and ranking them by whichever branch the database happened to
     return first would be a coin toss dressed as a distance.
  */
  locations: { where: { published: true }, include: { area: true }, take: 5 },
  /*
     Board 1b's row carries a photo, the trades they carry and a branch count.

     `media` takes one gallery image: the card reserves a 214px slot whether or
     not there is anything in it, and a second image would be bytes nobody
     renders. `categories` is the "Valves & actuators · Pumps & motors" line,
     which is what tells a buyer scanning twenty rows that this supplier is the
     right kind of supplier.
  */
  media: { where: { kind: "gallery" }, orderBy: { sortOrder: "asc" }, take: 1 },
  categories: { include: { category: { select: { name: true } } }, take: 5 },
  _count: {
    select: {
      products: { where: { status: { not: "draft" } } },
      locations: { where: { published: true } },
    },
  },
} as const;

/** How well a row matches the words the buyer typed. 0..1. */
function relevanceOf(name: string, q: string): number {
  if (!q) return 0.5;
  const haystack = name.toLowerCase();
  const words = tokens(q);
  if (words.length === 0) return 0.5;
  if (haystack === q.trim().toLowerCase()) return 1;
  const hits = words.filter((w) => haystack.includes(w)).length;
  // A category-synonym match contributes nothing here and everything to the
  // fact the row is in the set at all, so the floor is deliberately not zero.
  return 0.35 + 0.65 * (hits / words.length);
}

/**
 * The buyer's chosen order, applied over the ranked candidates.
 *
 * `best` is the ranking itself and is left alone. The other three are single
 * signals, because that is what a buyer picking them is asking for — "Fastest
 * reply" that still weighted relevance at 34 would return a list whose top row
 * is not the fastest, which is the sort quietly not working.
 *
 * Unclaimed listings sink in every order. They have no rating, no measured
 * reply and nobody behind them, so a "newest" sort that floated a licence
 * import above a claimed supplier would be worse than useless. Criterion 7.
 *
 * Only the three single-signal sorts re-order; everything else is the ranking,
 * `best` and an absent value alike. That test is deliberately the whole
 * condition rather than `sort === "best"`, because the earlier version fell
 * through to the switch's `default` when `sort` was undefined and quietly
 * returned the newest-first order — which is not a worse ranking, it is no
 * ranking at all. A caller that omits the field must get the ranking, since
 * that is what every caller that omits it means.
 */
function orderFor<T extends {
  claimStatus: string;
  ratingOverall: number | null;
  responseTimeMedianMs: number | null;
  publishedAt: Date | null;
}>(rows: readonly T[], sort: SearchSort): T[] {
  if (sort !== "rating" && sort !== "reply" && sort !== "newest") return [...rows];

  const claimed = (row: T) => (row.claimStatus === "claimed" ? 0 : 1);
  /* Nulls last within each group, whichever way the signal points. */
  const by = (value: number | null | undefined, worst: number) => value ?? worst;

  return [...rows].sort((a, b) => {
    const claim = claimed(a) - claimed(b);
    if (claim !== 0) return claim;

    switch (sort) {
      case "rating":
        return by(b.ratingOverall, -1) - by(a.ratingOverall, -1);
      case "reply":
        return (
          by(a.responseTimeMedianMs, Number.MAX_SAFE_INTEGER) -
          by(b.responseTimeMedianMs, Number.MAX_SAFE_INTEGER)
        );
      default:
        return (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0);
    }
  });
}

export async function searchBusinesses(
  query: SearchQuery,
  options: {
    categoryIds?: string[];
    /** Omit to read the live ones. The default is only a fallback. */
    weights?: RankingWeights;
    sponsoredId?: string | null;
    /** Live boost points by business id. Omit to read them. */
    boosts?: Map<string, number>;
    /** Omit to resolve from the query's own filters. `null` means no origin. */
    origin?: SortOrigin | null;
    /** Omit to read it from the catalogue. */
    shape?: QueryShape;
  } = {},
) {
  const { categoryIds, sponsoredId = null } = options;
  /*
   * The stored weights, not the constant.
   *
   * `DEFAULT_WEIGHTS` was the whole configuration until board 12c: this
   * function has always taken a `weights` option and no caller ever passed one,
   * so criterion 5's "weights reorder live results" reordered nothing. Read
   * here rather than at every call site, because a caller that forgot would
   * silently get the old ranking.
   */
  const [storedWeights, boosts, origin, shape] = await Promise.all([
    options.weights ? Promise.resolve(options.weights) : liveWeights(),
    options.boosts ? Promise.resolve(options.boosts) : liveBoosts(),
    options.origin !== undefined ? Promise.resolve(options.origin) : resolveOrigin(query),
    options.shape ? Promise.resolve(options.shape) : shapeOf(query),
  ]);

  /*
     Distance is the only weight the query itself moves, and the board says why:
     somebody who typed an exact part number wants that part and will drive for
     it, while somebody searching `AMC contractor` is looking for a person who
     will come to their site. The other five stay exactly as staff set them —
     a search that quietly rewrote those would make the admin editor a
     suggestion rather than a setting.
  */
  const weights = weightsForShape(storedWeights, shape);
  const where = businessWhere(query, categoryIds);

  const [candidates, total] = await Promise.all([
    prisma.business.findMany({
      where,
      include: BUSINESS_INCLUDE,
      // Ranking runs in the process over a bounded candidate set. At 41,000
      // listings this becomes a Postgres-side score; the weights object is the
      // part that has to be right now, and it moves unchanged.
      take: 200,
    }),
    prisma.business.count({ where }),
  ]);

  const ranked = rank(
    candidates,
    (business) => ({
      /*
         Scored against the whole match surface, not just the name.

         A supplier found *because* their catalogue carries `Application:
         chilled water` scored 0.35 on a name that says nothing about chilled
         water — the floor, indistinguishable from a bare category-synonym
         match. The row that matched best was ranked as though it had barely
         matched at all.
      */
      relevance: relevanceOf(`${business.displayName} ${business.searchText ?? ""}`, query.q),
      verificationTier: business.verificationTier,
      responseTimeMedianMs: business.responseTimeMedianMs,
      specCompleteness: business.specCompleteness,
      /*
         Kilometres from the buyer's own filters, never from their device.

         Hardcoded null until now, which meant the distance weight had never
         once moved a result — the admin editor has always shown a slider that
         did nothing. Null still happens, and legitimately: no area and no
         emirate filter is no origin, and a supplier whose every branch is
         unpinned has no position. Both score as unknown rather than as far,
         because not knowing where somebody is must not read as evidence that
         they are inconvenient.
      */
      distanceKm: nearestKm(origin, business.locations),
      planMultiplier: business.plan?.rankingMultiplier ?? 1,
      // Ops moving a listing for a reason of ours, with an expiry on it. Never
      // labelled sponsored: nobody paid for this one.
      boostPoints: boosts.get(business.id) ?? 0,
    }),
    weights,
  );

  const ordered = orderFor(ranked, query.sort);

  const placed = placeSponsored(
    ordered,
    sponsoredId,
    (business) => business.id,
    Boolean(query.tier),
  );

  const from = (query.page - 1) * PAGE_SIZE;
  return {
    rows: placed.rows.slice(from, from + PAGE_SIZE),
    total,
    sponsoredId: placed.sponsoredId,
    /*
       Returned rather than recomputed by the page. Board 1c's sort strip names
       the origin it sorted by, and a strip that worked it out separately could
       name a place the ranking did not actually use.
    */
    origin,
    shape,
  };
}

export type BusinessResult = Awaited<ReturnType<typeof searchBusinesses>>["rows"][number];

// ─────────────────────────────────────────────────────────────────────────────
// Product filters
// ─────────────────────────────────────────────────────────────────────────────

function productWhere(query: SearchQuery, categoryIds?: string[]): Prisma.ProductWhereInput {
  const and: Prisma.ProductWhereInput[] = [
    { status: { not: "draft" }, business: PUBLIC_BUSINESS },
  ];

  if (categoryIds?.length) and.push({ categoryId: { in: categoryIds } });

  for (const token of tokens(query.q)) {
    // Same split as `businessWhere`, and it matters more here: a product search
    // is where an exact part number is typed, and `6205-2RS` reaching
    // `6205-2RSH` is a bearing that does not fit.
    const branches: Prisma.ProductWhereInput[] = [
      { searchText: { contains: matchNeedle(token), mode: "insensitive" } },
    ];
    if (!isCode(token)) {
      branches.push(
        { name: { contains: token, mode: "insensitive" } },
        { category: { OR: [{ name: { contains: token, mode: "insensitive" } }, { synonyms: { has: token } }] } },
      );
    } else {
      // A code still reaches the SKU column directly, whole. That is the one
      // place a part number is stored verbatim rather than as an index token,
      // and a seller whose catalogue predates the reindex still has it.
      branches.push({ sku: { equals: token, mode: "insensitive" } });
    }
    and.push({ OR: branches });
  }

  if (query.availability?.length) and.push({ availability: { in: query.availability as never[] } });

  // Spec facets are keyed by SpecField id, and the values live in a JSON
  // column. A multiselect field holds an array, so both shapes are matched.
  for (const [fieldId, values] of Object.entries(query.spec)) {
    if (values.length === 0) continue;
    and.push({
      OR: values.flatMap((value) => [
        { specValues: { path: [fieldId], equals: value } },
        { specValues: { path: [fieldId], array_contains: [value] } },
      ]),
    });
  }

  const businessFilters: Prisma.BusinessWhereInput = { ...PUBLIC_BUSINESS };
  if (query.tier) businessFilters.verificationTier = { gte: query.tier };
  if (query.replyWithinHours) {
    businessFilters.responseTimeMedianMs = { lte: query.replyWithinHours * 3_600_000 };
  }
  if (query.emirate || query.area || query.freeZone) {
    const location: Prisma.LocationWhereInput = { published: true };
    if (query.emirate) location.emirate = query.emirate as never;
    if (query.area) location.area = { slug: query.area };
    if (query.freeZone) location.area = { ...(location.area as object | undefined), isFreeZone: true };
    businessFilters.locations = { some: location };
  }
  and.push({ business: businessFilters });

  return { AND: and };
}

const PRODUCT_INCLUDE = {
  category: true,
  business: {
    include: {
      primaryCategory: true,
      // Same reasoning as BUSINESS_INCLUDE above: the products tab ranks with
      // `rankingMultiplier` and reads nothing else off the plan.
      plan: { select: { rankingMultiplier: true } },
      // Five, for the same reason as the business include: distance is to the
      // nearest branch, not to whichever one came back first.
      locations: { where: { published: true }, include: { area: true }, take: 5 },
    },
  },
} as const;

export async function searchProducts(
  query: SearchQuery,
  options: {
    categoryIds?: string[];
    weights?: RankingWeights;
    origin?: SortOrigin | null;
    shape?: QueryShape;
  } = {},
) {
  const { categoryIds } = options;
  const [storedWeights, origin, shape] = await Promise.all([
    options.weights ? Promise.resolve(options.weights) : liveWeights(),
    options.origin !== undefined ? Promise.resolve(options.origin) : resolveOrigin(query),
    options.shape ? Promise.resolve(options.shape) : shapeOf(query),
  ]);
  // Same rule as the suppliers tab. A buyer who typed a part number is willing
  // to travel for it whichever tab they are looking at.
  const weights = weightsForShape(storedWeights, shape);
  const where = productWhere(query, categoryIds);

  const [candidates, total] = await Promise.all([
    prisma.product.findMany({ where, include: PRODUCT_INCLUDE, take: 200 }),
    prisma.product.count({ where }),
  ]);

  const ranked = rank(
    candidates,
    (product) => ({
      relevance: relevanceOf(`${product.name} ${product.sku ?? ""} ${product.searchText ?? ""}`, query.q),
      verificationTier: product.business.verificationTier,
      responseTimeMedianMs: product.business.responseTimeMedianMs,
      specCompleteness: product.business.specCompleteness,
      distanceKm: nearestKm(origin, product.business.locations),
      planMultiplier: product.business.plan?.rankingMultiplier ?? 1,
    }),
    weights,
  );

  const from = (query.page - 1) * PAGE_SIZE;
  return { rows: ranked.slice(from, from + PAGE_SIZE), total, origin, shape };
}

export type ProductResult = Awaited<ReturnType<typeof searchProducts>>["rows"][number];

export async function countResults(
  query: SearchQuery,
  categoryIds?: string[],
): Promise<number> {
  return query.tab === "products"
    ? prisma.product.count({ where: productWhere(query, categoryIds) })
    : prisma.business.count({ where: businessWhere(query, categoryIds) });
}

// ─────────────────────────────────────────────────────────────────────────────
// Facets
// ─────────────────────────────────────────────────────────────────────────────

export interface FacetOption {
  value: string;
  /** Localised by the caller for fixed facets; verbatim for spec options. */
  label: string;
  count: number;
  selected: boolean;
}

export interface FacetGroup {
  /** Query-string key. A spec facet's key is its SpecField id. */
  key: string;
  label: string;
  options: FacetOption[];
  /** Spec facets come from the template; fixed ones are hardcoded. */
  source: "fixed" | "spec";
}

/**
 * Counts for one facet's options, each measured with that facet cleared.
 *
 * Measuring with the facet still applied would show 0 against every option the
 * buyer has not picked, which is the most common way a filter rail becomes
 * useless — it tells you nothing about what else is available.
 */
async function optionCounts(
  query: SearchQuery,
  key: string,
  values: readonly string[],
  build: (base: SearchQuery, value: string) => SearchQuery,
  categoryIds: string[] | undefined,
): Promise<number[]> {
  const cleared = withoutFacet(query, key);
  return Promise.all(values.map((value) => countResults(build(cleared, value), categoryIds)));
}

/**
 * The options each fixed facet offers, in the order the rail draws them.
 *
 * Module level rather than inside `getFixedFacets`, because the cacheable
 * counting function below needs the same lists and the two must not drift.
 */
const TIERS = ["4", "3", "2", "1"] as const;
const EMIRATES = ["dubai", "abu_dhabi", "sharjah", "ajman"] as const;
const AVAILABILITY = ["in_stock", "made_to_order", "indent", "out_of_stock"] as const;
const FREE_ZONE = ["1"] as const;
const REPLY = ["4", "24", "72"] as const;
const YEARS = ["5", "10", "20"] as const;

/**
 * The nineteen numbers behind the fixed facet rail, with no words in them.
 *
 * ## Why the counts are split from the labels
 *
 * Two reasons, and the second is the one that made this a separate function.
 *
 * `getFixedFacets` takes a `labels` object holding FUNCTIONS — `tierOption`,
 * `emirateOption` and friends, each closing over `t()`. A function cannot be
 * serialised into a cache key and must not cross a cache boundary at all; this
 * repo's most repeated defect is a function passed where an element or a string
 * belonged. So the cacheable half takes a query and returns numbers, and the
 * labelling stays outside it.
 *
 * And it is worth caching. Nineteen of the forty-five database round trips on
 * one unfiltered category render are these counts, each a `SELECT COUNT(*)`
 * differing from its neighbour in a single predicate. Every visitor to the same
 * shelf gets the same nineteen answers.
 *
 * ## Why not one query with FILTER clauses
 *
 * That was the first plan and it is the wrong one here. `businessWhere` exists
 * so the header, the chip counts and the results are the same predicate rather
 * than two that drift — its own comment says so — and hand-writing that
 * predicate again in SQL is exactly the second one. Measured alternatives that
 * do not duplicate it: `$transaction([...])` batching does not help, it adds a
 * round trip for BEGIN and COMMIT; and bucketing in JavaScript trades nineteen
 * O(1) counts for one unbounded fetch of every matching business with its
 * locations and products, which is cheaper today at 203 listings and worse at
 * the 30,000 the sitemap is sized for.
 *
 * Caching leaves the predicate alone and removes the round trips outright.
 */
const FACET_CACHE_REVALIDATE_S = 60;

/** The nineteen counts, in the order `getFixedFacets` lays them out. */
export interface FixedFacetCounts {
  tiers: number[];
  emirates: number[];
  availability: number[];
  freeZone: number[];
  reply: number[];
  years: number[];
}

/**
 * Exported uncached, the way `readHomePlans` and `readPricingPlans` are.
 *
 * `unstable_cache` needs Next's incremental cache context and throws outside a
 * request, so the integration test that proves these nineteen numbers did not
 * change when they were cached calls this rather than the wrapper.
 */
export async function readFixedFacetCounts(
  query: SearchQuery,
  categoryIds: string[] | undefined,
): Promise<FixedFacetCounts> {
  const [tiers, emirates, availability, freeZone, reply, years] = await Promise.all([
    optionCounts(query, "tier", TIERS, (base, v) => ({ ...base, tier: Number(v) }), categoryIds),
    optionCounts(query, "emirate", EMIRATES, (base, v) => ({ ...base, emirate: v }), categoryIds),
    optionCounts(query, "availability", AVAILABILITY, (base, v) => ({ ...base, availability: [v] }), categoryIds),
    optionCounts(query, "freeZone", FREE_ZONE, (base) => ({ ...base, freeZone: true }), categoryIds),
    optionCounts(query, "replyWithinHours", REPLY, (base, v) => ({ ...base, replyWithinHours: Number(v) }), categoryIds),
    optionCounts(query, "yearsTrading", YEARS, (base, v) => ({ ...base, yearsTrading: Number(v) }), categoryIds),
  ]);
  return { tiers, emirates, availability, freeZone, reply, years };
}

/**
 * Sixty seconds, which is tighter than anything else cached in this repo — the
 * home page's product band is five minutes and its plan band is an hour.
 *
 * CLAUDE.md says every number is a query rather than a constant, and a cached
 * count is a constant for the length of its lifetime. The rule is aimed at a
 * number nobody ever recomputes; this one is recomputed every minute, and a
 * newly published supplier appears in the rail within that minute. The trade is
 * named here rather than left for a reader to infer.
 */
const getFixedFacetCounts = unstable_cache(readFixedFacetCounts, ["browse-fixed-facets"], {
  revalidate: FACET_CACHE_REVALIDATE_S,
});

export async function getFixedFacets(
  query: SearchQuery,
  categoryIds: string[] | undefined,
  labels: {
    tier: string;
    tierOption: (tier: number) => string;
    emirate: string;
    emirateOption: (value: string) => string;
    availability: string;
    availabilityOption: (value: string) => string;
    freeZone: string;
    freeZoneOption: string;
    reply: string;
    replyOption: (hours: number) => string;
    years: string;
    yearsOption: (years: number) => string;
  },
): Promise<FacetGroup[]> {
  const { tiers, emirates, availability, freeZone, reply, years } = await getFixedFacetCounts(
    countable(query),
    categoryIds,
  );

  const groups: FacetGroup[] = [
    {
      key: "tier",
      label: labels.tier,
      source: "fixed",
      options: TIERS.map((value, i) => ({
        value,
        label: labels.tierOption(Number(value)),
        count: tiers[i]!,
        selected: query.tier === Number(value),
      })),
    },
    {
      key: "emirate",
      label: labels.emirate,
      source: "fixed",
      options: EMIRATES.map((value, i) => ({
        value,
        label: labels.emirateOption(value),
        count: emirates[i]!,
        selected: query.emirate === value,
      })),
    },
    {
      key: "freeZone",
      label: labels.freeZone,
      source: "fixed",
      options: [
        { value: "1", label: labels.freeZoneOption, count: freeZone[0]!, selected: Boolean(query.freeZone) },
      ],
    },
    {
      key: "availability",
      label: labels.availability,
      source: "fixed",
      options: AVAILABILITY.map((value, i) => ({
        value,
        label: labels.availabilityOption(value),
        count: availability[i]!,
        selected: query.availability?.includes(value) ?? false,
      })),
    },
    {
      key: "replyWithinHours",
      label: labels.reply,
      source: "fixed",
      options: REPLY.map((value, i) => ({
        value,
        label: labels.replyOption(Number(value)),
        count: reply[i]!,
        selected: query.replyWithinHours === Number(value),
      })),
    },
    {
      key: "yearsTrading",
      label: labels.years,
      source: "fixed",
      options: YEARS.map((value, i) => ({
        value,
        label: labels.yearsOption(Number(value)),
        count: years[i]!,
        selected: query.yearsTrading === Number(value),
      })),
    },
  ];

  // A facet with nothing behind it is noise. It stays only if the buyer has
  // already picked from it, so their own choice never vanishes mid-search.
  return groups.filter((group) =>
    group.options.some((option) => option.count > 0 || option.selected),
  );
}

/**
 * The spec facets, generated from the category's live template.
 *
 * Nothing here knows about valves. Marking a SpecField `isFilterable` puts it
 * in the rail; unmarking it takes it out. That is handoff 1 criterion 4, and it
 * is why the query string treats any unreserved key as a SpecField id.
 */
export async function getSpecFacets(
  categoryIds: string[],
  query: SearchQuery,
  /**
   * Where to look for the template, when that is wider than what is counted.
   *
   * A subcategory usually has no template of its own — the seeded one is on
   * "Valves & fittings", not on "Gate valves" — so a subcategory page asked for
   * its own id, found nothing, and rendered no filter chips and an empty rail.
   * It passes its parent here and its own id above: inherit the template,
   * count only your own products.
   */
  templateCategoryIds: string[] = categoryIds,
): Promise<FacetGroup[]> {
  const template = await prisma.specTemplate.findFirst({
    where: { categoryId: { in: templateCategoryIds }, status: "live" },
    orderBy: { version: "desc" },
    include: { fields: { where: { isFilterable: true }, orderBy: { sortOrder: "asc" } } },
  });
  if (!template) return [];

  // Values are grouped in the process rather than in SQL: a JSON column with a
  // dynamic key does not group cleanly through the query builder, and the
  // candidate set here is bounded by the same filters as the results.
  const matching = await prisma.product.findMany({
    where: productWhere({ ...query, spec: {} }, categoryIds),
    select: { specValues: true },
    take: 1000,
  });

  return template.fields
    .map((field) => {
      const counts = new Map<string, number>();
      for (const row of matching) {
        const raw = (row.specValues as Record<string, unknown>)[field.id];
        const values = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
        for (const value of values) {
          const key = String(value);
          if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }

      const selected = query.spec[field.id] ?? [];
      const options: FacetOption[] = field.options
        .map((option) => ({
          value: option,
          label: field.unit && !option.startsWith(field.unit) ? `${option} ${field.unit}` : option,
          count: counts.get(option) ?? 0,
          selected: selected.includes(option),
        }))
        .filter((option) => option.count > 0 || option.selected);

      return { key: field.id, label: field.label, source: "spec" as const, options };
    })
    .filter((group) => group.options.length > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Zero results — a designed state, not a fallback
// ─────────────────────────────────────────────────────────────────────────────

export interface DropSuggestion {
  /** Query-string key of the facet worth dropping. */
  key: string;
  /** How many results dropping it yields. */
  yields: number;
}

/**
 * Which single filter to drop, and what dropping it gets you.
 *
 * Board 10c asks the zero-result page to name one. Each applied facet is
 * removed in turn and counted; the one that opens the most results wins. If
 * nothing helps, the query itself is the problem and the page says so instead.
 */
export async function suggestFilterToDrop(
  query: SearchQuery,
  categoryIds?: string[],
): Promise<DropSuggestion | null> {
  const keys = appliedKeys(query);
  if (keys.length === 0) return null;

  const counts = await Promise.all(
    keys.map((key) => countResults(withoutFacet(query, key), categoryIds)),
  );

  let best: DropSuggestion | null = null;
  for (const [i, key] of keys.entries()) {
    const yields = counts[i]!;
    if (yields > 0 && (!best || yields > best.yields)) best = { key, yields };
  }
  return best;
}

/**
 * Write the miss.
 *
 * Nothing reads this yet — the admin gap report and the recruitment call list
 * arrive in handoff 4. Writing it now means the report has history the day it
 * ships instead of starting empty, and a gap report with no history cannot tell
 * anyone which trade to go recruit.
 *
 * Never throws. A logging failure must not turn an empty results page into an
 * error page.
 */
export async function recordZeroResult(
  query: SearchQuery,
  categoryId: string | null,
): Promise<void> {
  if (!query.q && appliedKeys(query).length === 0) return;
  try {
    await prisma.zeroResultQuery.create({
      data: {
        query: query.q.slice(0, 200),
        categoryId,
        emirate: (query.emirate as never) ?? null,
        filters: {
          tier: query.tier ?? null,
          area: query.area ?? null,
          freeZone: query.freeZone ?? false,
          availability: query.availability ?? [],
          replyWithinHours: query.replyWithinHours ?? null,
          yearsTrading: query.yearsTrading ?? null,
          spec: query.spec,
        },
        tab: query.tab,
      },
    });
  } catch (error) {
    console.error("[zero_result_query] write failed", error);
  }
}

/** The sponsored slot for this results page, if one is sold and running. */
export async function getSponsoredBusinessId(
  categoryIds: string[] | undefined,
  emirate: string | undefined,
): Promise<string | null> {
  if (!categoryIds?.length) return null;
  const now = new Date();
  const slot = await prisma.placementSlot.findFirst({
    where: {
      categoryId: { in: categoryIds },
      startsOn: { lte: now },
      OR: [{ endsOn: null }, { endsOn: { gte: now } }],
      ...(emirate ? { OR: [{ emirate: emirate as never }, { emirate: null }] } : {}),
      business: PUBLIC_BUSINESS,
    },
    orderBy: { monthlyPriceAed: "desc" },
    select: { businessId: true },
  });
  return slot?.businessId ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Category
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Memoised per request.
 *
 * `generateMetadata` and the page component each resolve the category
 * independently, and on `/c/[category]` the same row was fetched four times in
 * one render. React's `cache` deduplicates within a request and nothing else —
 * no cross-request staleness, so none of the "every number is a query" tension
 * that a real cache would carry.
 *
 * It keys on argument identity, which is why this wraps a function taking a
 * slug and not one taking a query object: two structurally equal objects are
 * two keys.
 */
export const getCategoryBySlug = cache(async (slug: string) => {
  return prisma.category.findUnique({
    where: { slug },
    include: { parent: true, children: { orderBy: { sortOrder: "asc" } } },
  });
});

export type PublicCategory = NonNullable<Awaited<ReturnType<typeof getCategoryBySlug>>>;

/** A category plus its children — a parent search covers its subcategories. */
export function categoryIdsFor(category: PublicCategory): string[] {
  return [category.id, ...category.children.map((child) => child.id)];
}

export async function getHomeCategories() {
  return prisma.category.findMany({
    where: { showOnHome: true, parentId: null },
    orderBy: { sortOrder: "asc" },
    include: { _count: { select: { primaryFor: { where: PUBLIC_BUSINESS } } } },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Home and compare
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The numbers on the home page. Say the number, never "many suppliers" — a
 * directory that will not tell you how big it is has told you something.
 */
export async function getDirectoryStats() {
  const [listings, verified, categories, areas, products] = await Promise.all([
    prisma.business.count({ where: PUBLIC_BUSINESS }),
    prisma.business.count({ where: { ...PUBLIC_BUSINESS, verificationTier: { gte: VERIFIED_TIER } } }),
    prisma.category.count({ where: { parentId: null } }),
    prisma.area.count(),
    prisma.product.count({ where: { status: { not: "draft" }, business: PUBLIC_BUSINESS } }),
  ]);
  return { listings, verified, categories, areas, products };
}

/**
 * Suppliers to show on the home page.
 *
 * Ordered by verification then reviews, and never by plan: the home page is
 * the one surface where a paid slot would read as an editorial endorsement.
 * Sponsored placement is sold per category and emirate, not here.
 */
export async function getFeaturedBusinesses(take = 6) {
  return prisma.business.findMany({
    where: { ...PUBLIC_BUSINESS, claimStatus: "claimed", verificationTier: { gte: VERIFIED_TIER } },
    include: {
      primaryCategory: true,
      locations: { where: { published: true }, include: { area: true }, take: 1 },
      _count: { select: { products: { where: { status: { not: "draft" } } } } },
    },
    orderBy: [{ verificationTier: "desc" }, { reviewCount: "desc" }, { displayName: "asc" }],
    take,
  });
}

/** Emirates with a supplier count, for the home page's geography row. */
export async function getEmirateCounts() {
  const rows = await prisma.location.groupBy({
    by: ["emirate"],
    where: { published: true, business: PUBLIC_BUSINESS },
    _count: { businessId: true },
  });
  return rows
    .map((row) => ({ emirate: row.emirate, count: row._count.businessId }))
    .sort((a, b) => b.count - a.count);
}

/**
 * The businesses in a comparison tray, in the order the buyer picked them.
 *
 * Capped at four. Past that the table stops fitting on any screen a buyer
 * actually has, and a comparison nobody can read side by side is a list.
 */
export const COMPARE_LIMIT = 4;

export async function getBusinessesForCompare(slugs: readonly string[]) {
  const wanted = slugs.slice(0, COMPARE_LIMIT);
  if (wanted.length === 0) return [];

  const found = await prisma.business.findMany({
    where: { slug: { in: [...wanted] }, ...PUBLIC_BUSINESS },
    include: {
      primaryCategory: true,
      locations: { where: { published: true }, include: { area: true } },
      _count: {
        select: {
          products: { where: { status: { not: "draft" } } },
          reviews: { where: { removedAt: null, heldAt: null } },
        },
      },
    },
  });

  // Preserve the buyer's order rather than the database's.
  const bySlug = new Map(found.map((business) => [business.slug, business]));
  return wanted.map((slug) => bySlug.get(slug)).filter((b): b is NonNullable<typeof b> => Boolean(b));
}

export type CompareBusiness = Awaited<ReturnType<typeof getBusinessesForCompare>>[number];
