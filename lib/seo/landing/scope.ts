import "server-only";
import { prisma } from "@/lib/db/client";
import { countWords, evaluatePublish, type PublishFailure } from "@/lib/publish-threshold";
import { thresholdsFor } from "@/lib/taxonomy/service";
import { VERIFIED_TIER } from "@/lib/verification";
import type { Emirate } from "@/lib/db/generated/enums";

/**
 * Board 6a — the scope object, and the four conditions that decide whether a
 * page for it is allowed to exist.
 *
 * ## One template, two page classes
 *
 * §1: *"One template, one controller, one scope object — `{emirate, area?,
 * category}`. The differences are the H1, the breadcrumb, the map extent, and
 * which sibling-link block is 'other areas in this emirate' versus 'this area
 * in other emirates'. Nothing else branches."*
 *
 *   category × emirate   `/dubai/industrial-mep`      84, board 6c's matrix
 *   category × area      `/dubai/al-quoz/hvac`        unbounded, this board
 *
 * The tracker's "84 of them" is the first class only. They are counted
 * separately everywhere else and they are one object here, which is the only
 * arrangement in which the publish gate cannot be applied to one and forgotten
 * on the other.
 *
 * ## The middle segment
 *
 * Open question 3 asked whether it carries sectors at all, and recommended
 * flattening the 84 to `/:emirate/:category`. **That is what the router
 * already does** — the emirate class is two segments and the area class is
 * three, and Next matches on segment count, so there is no ambiguous middle
 * position to resolve and no `type` column needed to resolve it. What survives
 * of criterion 7 is the collision itself: an area and a category sharing a slug
 * would put `/dubai/foo` and `/dubai/foo/bar` in two different classes reading
 * two different tables, which is a namespace nobody can reason about.
 * `lib/seo/landing/slug-namespace.ts` refuses to create one.
 *
 * ## Unresolvable is a 404
 *
 * Never a redirect to the emirate page and never a soft 404. §1 is explicit,
 * and the reason is arithmetic: on a template addressing a few hundred URLs, a
 * soft 404 is a crawler being taught that guesses render.
 */

/** Published, not suspended, not merged away. One definition, shared. */
export const PUBLIC_BUSINESS = {
  suspendedAt: null,
  publishedAt: { not: null },
  mergedIntoId: null,
} as const;

export interface LandingCategory {
  id: string;
  slug: string;
  /**
   * The plural human form the H1 uses, from the record.
   *
   * §3: *"Category name comes from the category record's plural human form, not
   * the slug and not the singular."* `Category.name` is that form — "HVAC &
   * ventilation", "Valves & fittings" — and the H1 pattern supplies the noun:
   * `{Category} companies in {Area}, {Emirate}`.
   */
  name: string;
  parentId: string | null;
  parentSlug: string | null;
  parentName: string | null;
  publishThreshold: number;
  verifiedShareMin: number;
}

export interface LandingArea {
  id: string;
  slug: string;
  name: string;
  lat: number | null;
  lng: number | null;
}

export interface LandingScope {
  kind: "area" | "emirate";
  emirate: Emirate;
  /** Absent on the emirate class. The only thing that branches. */
  area: LandingArea | null;
  category: LandingCategory;
  /**
   * The category and its children.
   *
   * A supplier filed under "Ducting" is an HVAC supplier, and a page that
   * counted otherwise would disagree with the chip that linked to it.
   */
  categoryIds: string[];
  /** The unfiltered address. Canonical, and the base for every link on the page. */
  path: string;
}

const CATEGORY_SELECT = {
  id: true,
  slug: true,
  name: true,
  parentId: true,
  publishThreshold: true,
  verifiedShareMin: true,
  parent: { select: { slug: true, name: true } },
} as const;

function toCategory(row: {
  id: string;
  slug: string;
  name: string;
  parentId: string | null;
  publishThreshold: number;
  verifiedShareMin: number;
  parent: { slug: string; name: string } | null;
}): LandingCategory {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    parentId: row.parentId,
    parentSlug: row.parent?.slug ?? null,
    parentName: row.parent?.name ?? null,
    publishThreshold: row.publishThreshold,
    verifiedShareMin: row.verifiedShareMin,
  };
}

async function childIds(categoryId: string): Promise<string[]> {
  const children = await prisma.category.findMany({
    where: { parentId: categoryId },
    select: { id: true },
  });
  return children.map((child) => child.id);
}

/**
 * `/:emirate/:area/:category`, or nothing.
 *
 * The emirate must match the area's own. Two URLs addressing one page makes the
 * canonical a guess, which is the same rule the subcategory route applies to
 * its parent.
 */
export async function resolveAreaScope(params: {
  emirate: string;
  area: string;
  category: string;
}): Promise<LandingScope | null> {
  const [area, category] = await Promise.all([
    prisma.area.findUnique({
      where: { slug: params.area },
      select: { id: true, slug: true, name: true, emirate: true, lat: true, lng: true },
    }),
    prisma.category.findUnique({ where: { slug: params.category }, select: CATEGORY_SELECT }),
  ]);
  if (!area || !category) return null;
  if (area.emirate !== params.emirate) return null;

  return {
    kind: "area",
    emirate: area.emirate,
    area: { id: area.id, slug: area.slug, name: area.name, lat: area.lat, lng: area.lng },
    category: toCategory(category),
    categoryIds: [category.id, ...(await childIds(category.id))],
    path: `/${area.emirate}/${area.slug}/${category.slug}`,
  };
}

/** The seven, in the order board 6c's matrix lists them. */
export const EMIRATES = [
  "dubai",
  "abu_dhabi",
  "sharjah",
  "ajman",
  "ras_al_khaimah",
  "fujairah",
  "umm_al_quwain",
] as const;

export function isEmirate(value: string): value is Emirate {
  return (EMIRATES as readonly string[]).includes(value);
}

/**
 * `/:emirate/:category`, or nothing.
 *
 * Top-level sectors only. A subcategory across a whole emirate would be a
 * fourth page class nobody specified, competing with its sector's own page for
 * the same intent at two depths.
 */
export async function resolveEmirateScope(params: {
  emirate: string;
  category: string;
}): Promise<LandingScope | null> {
  if (!isEmirate(params.emirate)) return null;

  const category = await prisma.category.findUnique({
    where: { slug: params.category },
    select: CATEGORY_SELECT,
  });
  if (!category || category.parentId !== null) return null;

  return {
    kind: "emirate",
    emirate: params.emirate,
    area: null,
    category: toCategory(category),
    categoryIds: [category.id, ...(await childIds(category.id))],
    path: `/${params.emirate}/${category.slug}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The publish gate
// ─────────────────────────────────────────────────────────────────────────────

export interface LandingFaqRow {
  id: string;
  position: number;
  question: string;
  answer: string;
  scopeSpecific: boolean;
  liveToken: string | null;
}

export interface LandingRelatedRow {
  id: string;
  position: number;
  label: string;
  href: string;
}

export interface LandingState {
  scope: LandingScope;
  /** The page row's own id, for the content editors. Null before one exists. */
  pageId: string | null;
  listings: number;
  verified: number;
  intro: string | null;
  introWords: number;
  metaDescription: string | null;
  faq: LandingFaqRow[];
  relatedSearches: LandingRelatedRow[];
  /** What `UPDATED` prints. Never the build time — see §Freshness. */
  contentUpdatedAt: Date | null;
  supplyDigest: string | null;
  /** Staff intent. Not the live state on its own. */
  publishedAt: Date | null;
  /** All four conditions hold right now, whatever staff have decided. */
  clearsFloors: boolean;
  /**
   * Intent AND conditions. The only thing that has a URL.
   *
   * §the-publish-gate consequence 1: an unpublished scope is not a thin page
   * and not a `noindex` page. It 404s, it is absent from the sitemap, and it is
   * absent from every link block on every sibling page.
   */
  live: boolean;
  failing: readonly PublishFailure[];
}

/** The listings in one trade in one place, counted the way every surface counts. */
export function supplyWhere(scope: LandingScope) {
  return {
    ...PUBLIC_BUSINESS,
    primaryCategoryId: { in: scope.categoryIds },
    locations: scope.area
      ? { some: { areaId: scope.area.id, published: true } }
      : { some: { emirate: scope.emirate, published: true } },
  };
}

async function supply(scope: LandingScope): Promise<{ listings: number; verified: number }> {
  const where = supplyWhere(scope);
  const [listings, verified] = await Promise.all([
    prisma.business.count({ where }),
    prisma.business.count({ where: { ...where, verificationTier: { gte: VERIFIED_TIER } } }),
  ]);
  return { listings, verified };
}

const FAQ_SELECT = {
  id: true,
  position: true,
  question: true,
  answer: true,
  scopeSpecific: true,
  liveToken: true,
} as const;

const RELATED_SELECT = { id: true, position: true, label: true, href: true } as const;

const PAGE_SELECT = {
  id: true,
  intro: true,
  metaDescription: true,
  contentUpdatedAt: true,
  supplyDigest: true,
  publishedAt: true,
  faq: { select: FAQ_SELECT, orderBy: { position: "asc" } },
  relatedSearches: { select: RELATED_SELECT, orderBy: { position: "asc" } },
} as const;

/** The stored row for either class, or null before anybody has written one. */
export async function landingPageRow(scope: LandingScope) {
  return scope.area
    ? prisma.areaPage.findUnique({
        where: { areaId_categoryId: { areaId: scope.area.id, categoryId: scope.category.id } },
        select: PAGE_SELECT,
      })
    : prisma.emiratePage.findUnique({
        where: { emirate_categoryId: { emirate: scope.emirate, categoryId: scope.category.id } },
        select: PAGE_SELECT,
      });
}

/**
 * The four conditions, evaluated now.
 *
 * ```
 * listings        ≥ Category.publishThreshold      (60 at time of writing)
 * verified share  ≥ Category.verifiedShareMin      (30%)
 * intro copy      ≥ 250 words, human-written, unique to this scope
 * FAQ rows        ≥ 4, at least 2 specific to this scope
 * ```
 *
 * Read rather than stored, and that is the load-bearing choice. A stored flag
 * would mean that between supply dropping and a job running, a thin page is
 * live and indexable — and the cost of a thin page in the index is not its own
 * standing, it is the domain's. `sweepLandingPages` clears the column
 * afterwards so the matrix agrees with what the site serves, but nothing on the
 * read path waits for it.
 */
export async function landingState(scope: LandingScope): Promise<LandingState> {
  const [row, counts] = await Promise.all([landingPageRow(scope), supply(scope)]);

  const introWords = countWords(row?.intro);
  const faq = row?.faq ?? [];
  const decision = evaluatePublish(
    {
      listings: counts.listings,
      verified: counts.verified,
      introWords,
      faqRows: faq.length,
      scopeSpecificFaqRows: faq.filter((item) => item.scopeSpecific).length,
    },
    thresholdsFor(scope.category),
  );

  return {
    scope,
    pageId: row?.id ?? null,
    listings: counts.listings,
    verified: counts.verified,
    intro: row?.intro ?? null,
    introWords,
    metaDescription: row?.metaDescription ?? null,
    faq,
    relatedSearches: row?.relatedSearches ?? [],
    contentUpdatedAt: row?.contentUpdatedAt ?? null,
    supplyDigest: row?.supplyDigest ?? null,
    publishedAt: row?.publishedAt ?? null,
    clearsFloors: decision.publishable,
    live: row?.publishedAt != null && decision.publishable,
    failing: decision.failures,
  };
}
