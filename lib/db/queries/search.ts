import "server-only";
import type { Prisma } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { liveBoosts, liveWeights } from "@/lib/search/settings";
import {
  placeSponsored,
  rank,
  type RankingWeights,
} from "@/lib/search/ranking";
import { appliedKeys, withoutFacet, type SearchQuery } from "@/lib/search/query";
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

function businessWhere(query: SearchQuery, categoryIds?: string[]): Prisma.BusinessWhereInput {
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
    and.push({
      OR: [
        { displayName: { contains: token, mode: "insensitive" } },
        { tradeName: { contains: token, mode: "insensitive" } },
        // Category synonyms are how an Arabic query reaches an English listing:
        // صمامات is a synonym on the valves category, and every supplier in it
        // matches without a word of Arabic in their own record.
        { primaryCategory: { OR: [{ name: { contains: token, mode: "insensitive" } }, { synonyms: { has: token } }] } },
        { categories: { some: { category: { OR: [{ name: { contains: token, mode: "insensitive" } }, { synonyms: { has: token } }] } } } },
      ],
    });
  }

  if (query.tier) and.push({ verificationTier: { gte: query.tier } });
  if (query.yearsTrading) {
    and.push({ establishedYear: { lte: new Date().getFullYear() - query.yearsTrading } });
  }
  if (query.replyWithinHours) {
    and.push({ responseTimeMedianMs: { lte: query.replyWithinHours * 3_600_000 } });
  }

  const locationFilters: Prisma.LocationWhereInput = { published: true };
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
  plan: true,
  locations: { where: { published: true }, include: { area: true }, take: 1 },
  _count: { select: { products: { where: { status: { not: "draft" } } } } },
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

export async function searchBusinesses(
  query: SearchQuery,
  options: {
    categoryIds?: string[];
    /** Omit to read the live ones. The default is only a fallback. */
    weights?: RankingWeights;
    sponsoredId?: string | null;
    /** Live boost points by business id. Omit to read them. */
    boosts?: Map<string, number>;
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
  const [weights, boosts] = await Promise.all([
    options.weights ? Promise.resolve(options.weights) : liveWeights(),
    options.boosts ? Promise.resolve(options.boosts) : liveBoosts(),
  ]);
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
      relevance: relevanceOf(business.displayName, query.q),
      verificationTier: business.verificationTier,
      responseTimeMedianMs: business.responseTimeMedianMs,
      specCompleteness: business.specCompleteness,
      distanceKm: null,
      planMultiplier: business.plan?.rankingMultiplier ?? 1,
      // Ops moving a listing for a reason of ours, with an expiry on it. Never
      // labelled sponsored: nobody paid for this one.
      boostPoints: boosts.get(business.id) ?? 0,
    }),
    weights,
  );

  const placed = placeSponsored(
    ranked,
    sponsoredId,
    (business) => business.id,
    Boolean(query.tier),
  );

  const from = (query.page - 1) * PAGE_SIZE;
  return {
    rows: placed.rows.slice(from, from + PAGE_SIZE),
    total,
    sponsoredId: placed.sponsoredId,
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
    and.push({
      OR: [
        { searchText: { contains: token, mode: "insensitive" } },
        { name: { contains: token, mode: "insensitive" } },
        { category: { OR: [{ name: { contains: token, mode: "insensitive" } }, { synonyms: { has: token } }] } },
      ],
    });
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
      plan: true,
      locations: { where: { published: true }, include: { area: true }, take: 1 },
    },
  },
} as const;

export async function searchProducts(
  query: SearchQuery,
  options: { categoryIds?: string[]; weights?: RankingWeights } = {},
) {
  const { categoryIds } = options;
  const weights = options.weights ?? (await liveWeights());
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
      distanceKm: null,
      planMultiplier: product.business.plan?.rankingMultiplier ?? 1,
    }),
    weights,
  );

  const from = (query.page - 1) * PAGE_SIZE;
  return { rows: ranked.slice(from, from + PAGE_SIZE), total };
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
  const TIERS = ["4", "3", "2", "1"];
  const EMIRATES = ["dubai", "abu_dhabi", "sharjah", "ajman"];
  const AVAILABILITY = ["in_stock", "made_to_order", "indent", "out_of_stock"];
  const REPLY = ["4", "24", "72"];
  const YEARS = ["5", "10", "20"];

  const [tiers, emirates, availability, freeZone, reply, years] = await Promise.all([
    optionCounts(query, "tier", TIERS, (base, v) => ({ ...base, tier: Number(v) }), categoryIds),
    optionCounts(query, "emirate", EMIRATES, (base, v) => ({ ...base, emirate: v }), categoryIds),
    optionCounts(query, "availability", AVAILABILITY, (base, v) => ({ ...base, availability: [v] }), categoryIds),
    optionCounts(query, "freeZone", ["1"], (base) => ({ ...base, freeZone: true }), categoryIds),
    optionCounts(query, "replyWithinHours", REPLY, (base, v) => ({ ...base, replyWithinHours: Number(v) }), categoryIds),
    optionCounts(query, "yearsTrading", YEARS, (base, v) => ({ ...base, yearsTrading: Number(v) }), categoryIds),
  ]);

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

export async function getCategoryBySlug(slug: string) {
  return prisma.category.findUnique({
    where: { slug },
    include: { parent: true, children: { orderBy: { sortOrder: "asc" } } },
  });
}

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
          reviews: { where: { removedAt: null } },
        },
      },
    },
  });

  // Preserve the buyer's order rather than the database's.
  const bySlug = new Map(found.map((business) => [business.slug, business]));
  return wanted.map((slug) => bySlug.get(slug)).filter((b): b is NonNullable<typeof b> => Boolean(b));
}

export type CompareBusiness = Awaited<ReturnType<typeof getBusinessesForCompare>>[number];
