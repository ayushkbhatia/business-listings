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
 */
function isFiltered(params: Record<string, string | string[] | undefined>): boolean {
  return Object.entries(params).some(([key, value]) => {
    if (key === "compare") return false; // The tray is UI state, not a filter.
    if (value === undefined || value === "") return false;
    return true;
  });
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

/** The reserved keys, exported so the route and the tests agree on the list. */
export const CANONICAL_FILTER_KEYS = FILTER_KEYS;
