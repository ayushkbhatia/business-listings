import "server-only";
import { prisma } from "@/lib/db/client";
import { areaPageState } from "./area";

/**
 * Criterion 6 — "filtered category views canonicalise to their area page where
 * one exists; `/search` and `/compare` are `noindex`."
 *
 * The second half landed in handoff 1. This is the first, and the reason for it
 * is competition rather than tidiness: `/c/hvac-and-ventilation?emirate=dubai`
 * and `/dubai/al-quoz-industrial-1/hvac-and-ventilation` answer the same query
 * for the same buyer, and the second is the one with the intro, the map, the
 * FAQ and 250 words a person wrote. Left alone they split the signal and the
 * thinner one sometimes wins.
 *
 * Three rules, in order:
 *
 *   1. A filter that names one **area** and nothing else canonicalises to that
 *      area's page for this trade — but only if that page is actually live. A
 *      canonical pointing at a page we are asking not to index is worse than no
 *      canonical at all.
 *   2. Anything else filtered canonicalises to the **unfiltered** category page.
 *      `?tier=3&availability=in_stock` is a view of the trade, not a page in its
 *      own right, and there is nothing better to point it at.
 *   3. An unfiltered page canonicalises to itself.
 */

/** The facets that make a view a view rather than the page itself. */
const FILTER_KEYS = [
  "emirate",
  "area",
  "tier",
  "freeZone",
  "availability",
  "replyWithinHours",
  "yearsTrading",
  "q",
  "tab",
  "page",
] as const;

export interface CanonicalInput {
  /** The unfiltered address of the page being rendered. */
  basePath: string;
  categoryId: string;
  searchParams: Record<string, string | string[] | undefined>;
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Whether anything at all is filtering this view.
 *
 * Spec facets arrive as bare query keys named for a field id, so anything not
 * reserved counts too — the same open shape `parseSearchQuery` reads.
 *
 * Exported, and that is the point of the change rather than a convenience.
 * `/b/:slug/products` and `/b/:slug/reviews` take their filtered-ness from a
 * predicate their query layer exports, and both set `noindex` on the strength
 * of it. The category route had the same policy and no way to ask the question,
 * because this lived private in this file — so `/c/:category` was the one
 * faceted surface on the site that stayed indexable however deep the filtering
 * went. One crawler generated 797 of those URLs in 75 minutes.
 */
export function isFiltered(params: Record<string, string | string[] | undefined>): boolean {
  return Object.entries(params).some(([key, value]) => {
    if (key === "compare") return false; // The tray is UI state, not a filter.
    /*
       Nor is pagination. Page 2 is twenty different suppliers, not a narrowed
       view of page 1, and it is the only internal-link path to them — which is
       exactly why `page` is the one query key `CRAWLABLE_QUERY_KEYS` keeps in
       the crawl graph. The two lists have to agree, or the site nofollows a URL
       it asks to be indexed, or indexes one it nofollows.

       Caught by requesting `?page=2` against the running app and reading the
       `<meta name="robots">` it came back with, which said `noindex` — a
       regression this function introduced the moment it started being consulted
       for robots as well as for canonicals.
    */
    if (key === "page") return false;
    if (value === undefined || value === "") return false;
    return true;
  });
}

/**
 * The `robots` metadata a results route should emit for this query string.
 *
 * `noindex, follow` rather than `noindex, nofollow`: the page's own outbound
 * links to supplier storefronts and product pages are the reachable, indexable
 * things on it, and they should keep being followed. The links that must NOT be
 * followed are the facet anchors, and those carry `rel="nofollow"` of their own
 * — see lib/seo/crawl-policy.ts. Blanket `nofollow` here would take the
 * suppliers out with the facets.
 *
 * `undefined` for an unfiltered view, so the shelf itself indexes normally and
 * the caller can spread this without a conditional.
 */
export function robotsForFilteredView(
  params: Record<string, string | string[] | undefined>,
): { robots: { index: false; follow: true } } | Record<string, never> {
  return isFiltered(params) ? { robots: { index: false, follow: true } } : {};
}

export async function canonicalFor(input: CanonicalInput): Promise<string> {
  const { basePath, categoryId, searchParams } = input;

  if (!isFiltered(searchParams)) return basePath;

  /*
     One area and nothing else. `?area=al-quoz-industrial-1` on its own is the
     area page written another way; the same address with a tier filter on it
     is a view of that page and not a replacement for it.
  */
  const areaSlug = one(searchParams["area"]);
  const others = Object.entries(searchParams).filter(
    ([key, value]) =>
      key !== "area" && key !== "compare" && value !== undefined && value !== "",
  );

  if (areaSlug && others.length === 0) {
    const area = await prisma.area.findUnique({
      where: { slug: areaSlug },
      select: { id: true, slug: true, emirate: true },
    });
    if (area) {
      const state = await areaPageState(area.id, categoryId);
      // Only where the page is live. A canonical aimed at a page carrying
      // `noindex` tells a crawler to prefer something we have asked it to
      // ignore, which is worse than pointing at the filtered view.
      if (state?.live) {
        const category = await prisma.category.findUnique({
          where: { id: categoryId },
          select: { slug: true },
        });
        if (category) return `/${area.emirate}/${area.slug}/${category.slug}`;
      }
    }
  }

  // Everything else: the trade's own page, unfiltered.
  return basePath;
}

/**
 * The reserved keys, exported so the route and the tests agree on the list.
 *
 * Nothing imports it and nothing ever did, which is worth saying out loud
 * rather than deleting quietly: for as long as this constant sat here looking
 * like the policy, `isFiltered` a few lines above was the actual policy and it
 * reads EVERY key rather than these ten. Anyone auditing which query parameters
 * made a category view unindexable would have read the wrong list.
 *
 * Kept because the canonical rules in this file are written against these names
 * and a reader needs them enumerated somewhere. `robotsForFilteredView` is the
 * thing to call.
 */
export const CANONICAL_FILTER_KEYS = FILTER_KEYS;
