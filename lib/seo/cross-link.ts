import "server-only";
import { prisma } from "@/lib/db/client";
import type { SearchQuery } from "@/lib/search/query";
import { areaPageState } from "./area";

/**
 * The one line above the results that points at a page Google can rank.
 *
 * Criterion 10, and the reason `/search` being `noindex, follow` is not a
 * dead end. Every filter permutation here is a URL, and indexing them would
 * spend on near-identical pages the crawl budget the area and emirate pages
 * need. But a buyer who searched `hvac` and filtered to Al Quoz has described
 * exactly the page `/dubai/al-quoz/hvac-refrigeration` exists to be — so this
 * hands them that page rather than competing with it.
 *
 * Published pages only, re-checked against the floors. Pointing a tool at a
 * thin page is the mistake `livePages` already refuses to make in the sitemap,
 * and it would be a worse one here: this link is a recommendation.
 */

export interface SearchCrossLink {
  href: string;
  areaName: string;
  categoryName: string;
}

export async function crossLinkFor(query: SearchQuery): Promise<SearchCrossLink | null> {
  /*
     An area filter is required, not merely helpful.

     Without one there is no single page this search corresponds to — `hvac`
     across the whole country is the category page, which the nav already
     reaches, and offering it here would be a link back to where they came from.
  */
  if (!query.area) return null;

  const words = query.q.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  if (words.length === 0) return null;

  const area = await prisma.area.findUnique({
    where: { slug: query.area },
    select: { id: true, name: true, slug: true, emirate: true },
  });
  if (!area) return null;

  const pages = await prisma.areaPage.findMany({
    where: { areaId: area.id, publishedAt: { not: null } },
    select: {
      categoryId: true,
      category: { select: { slug: true, name: true, synonyms: true } },
    },
  });
  if (pages.length === 0) return null;

  /*
     The page whose category the query actually names.

     Matched against the category's own name and its synonyms — the same two
     fields `businessWhere` matches — so a query that reached these suppliers
     through the Arabic synonym is offered the page rather than being told
     nothing corresponds to it.
  */
  const hit = pages.find((page) => {
    const name = page.category.name.toLowerCase();
    const synonyms = page.category.synonyms.map((s) => s.toLowerCase());
    return words.some((word) => name.includes(word) || synonyms.includes(word));
  });
  if (!hit) return null;

  // Intent is not enough; the floors are re-checked exactly as the sitemap
  // does, so this can never point at a page the route would serve as thin.
  const state = await areaPageState(area.id, hit.categoryId);
  if (!state?.live) return null;

  return {
    href: `/${area.emirate as string}/${area.slug}/${hit.category.slug}`,
    areaName: area.name,
    categoryName: hit.category.name,
  };
}
