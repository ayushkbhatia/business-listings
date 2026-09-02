import "server-only";
import { prisma } from "@/lib/db/client";
import { businessWhere } from "./search";
import type { SearchQuery } from "@/lib/search/query";

/**
 * Board 1b's header reads.
 *
 * Three counts in a sentence and one per subcategory chip, all of them scoped
 * to the filters the buyer has set. That last part is the whole point and the
 * classic thing to get wrong: a chip row counted against the unfiltered set
 * tells a buyer who has already picked Dubai that there are 341 valve suppliers
 * when there are 44, and the rail beside it says something different again.
 */

/** The stat line: suppliers, how many have a catalogue, and how many products. */
export interface BrowseStats {
  listings: number;
  withCatalogue: number;
  products: number;
}

export async function getBrowseStats(
  query: SearchQuery,
  categoryIds: string[] | undefined,
): Promise<BrowseStats> {
  const where = businessWhere(query, categoryIds);

  const [listings, withCatalogue, products] = await Promise.all([
    prisma.business.count({ where }),
    prisma.business.count({
      where: { ...where, products: { some: { status: { not: "draft" } } } },
    }),
    prisma.product.count({
      where: { status: { not: "draft" }, business: where },
    }),
  ]);

  return { listings, withCatalogue, products };
}

export interface SubcategoryChip {
  id: string;
  slug: string;
  name: string;
  count: number;
}

/**
 * One chip per subcategory, largest first, counted under the current filters.
 *
 * A subcategory with nothing in it under these filters is dropped rather than
 * shown at zero: the row is a way in, and a chip that leads to an empty page is
 * a dead end wearing the same clothes as a live one.
 */
export async function getSubcategoryChips(
  query: SearchQuery,
  sector: { id: string },
): Promise<SubcategoryChip[]> {
  const children = await prisma.category.findMany({
    where: { parentId: sector.id },
    select: { id: true, slug: true, name: true },
  });
  if (children.length === 0) return [];

  /*
     One grouped query, not one per chip.

     This was a count per subcategory, which on HVAC's thirty-six children was
     thirty-six sequential round trips to render one header — enough to make the
     page the slowest thing on the site and, against a pooled connection, enough
     to start timing other requests out. `groupBy` over the same predicate gives
     the identical numbers in one.

     The predicate is the page's own, so the counts still respect every other
     active filter: ticking Dubai moves these, which is the whole point of them.
  */
  const grouped = await prisma.business.groupBy({
    by: ["primaryCategoryId"],
    where: {
      ...businessWhere(query, children.map((child) => child.id)),
    },
    _count: { _all: true },
  });

  const countFor = new Map(grouped.map((row) => [row.primaryCategoryId, row._count._all]));

  return children
    .map((child) => ({ ...child, count: countFor.get(child.id) ?? 0 }))
    .filter((child) => child.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
