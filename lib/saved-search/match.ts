import "server-only";
import { prisma } from "@/lib/db/client";
import { businessWhere, productWhere } from "@/lib/db/queries/search";
import { descendantsOf } from "@/lib/enquiry/service";
import { parseSearchQuery } from "@/lib/search/query";

/**
 * What a saved search matches, counted with the same predicate the results page
 * filters by.
 *
 * `businessWhere` and `productWhere` are the results page's own `where`, so a
 * saved search cannot promise four new matches that the page it opens then
 * shows three of because two definitions of "matches" drifted. What a count
 * does not reproduce is ranking and the map viewport — neither changes whether
 * something matches, only where it sits.
 *
 * **Listed** means the moment a buyer could first have found it: a business's
 * `publishedAt`, a product's `createdAt` (a product is findable once it is not a
 * draft, and `sweepAlerts` has always read `createdAt` for the same question).
 */

export type SavedTab = "businesses" | "products";

export interface SavedScope {
  query: string;
  categoryId: string | null;
  tab: SavedTab;
}

export function tabOf(query: string): SavedTab {
  return new URLSearchParams(query).get("tab") === "products" ? "products" : "businesses";
}

async function wheres(scope: SavedScope) {
  const params = Object.fromEntries(new URLSearchParams(scope.query));
  const parsed = parseSearchQuery(params);
  const categoryIds = scope.categoryId ? await descendantsOf(scope.categoryId) : undefined;
  return { parsed, categoryIds };
}

/** Everything that matches today. Zero is what makes a search a demand record. */
export async function countMatches(scope: SavedScope): Promise<number> {
  const { parsed, categoryIds } = await wheres(scope);
  return scope.tab === "products"
    ? prisma.product.count({ where: productWhere(parsed, categoryIds) })
    : prisma.business.count({ where: businessWhere(parsed, categoryIds) });
}

/**
 * Matches listed after `since`, and when the newest of them was listed.
 *
 * `since` is when the buyer last opened the search, or when they saved it —
 * `B7`: *4 new matches* counts from the last look, not from creation.
 */
export async function newMatchesSince(scope: SavedScope, since: Date): Promise<{ count: number; newestAt: Date | null }> {
  const { parsed, categoryIds } = await wheres(scope);

  if (scope.tab === "products") {
    const where = { AND: [productWhere(parsed, categoryIds), { createdAt: { gt: since } }] };
    const [count, newest] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findFirst({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { createdAt: true } }),
    ]);
    return { count, newestAt: newest?.createdAt ?? null };
  }

  const where = { AND: [businessWhere(parsed, categoryIds), { publishedAt: { gt: since } }] };
  const [count, newest] = await Promise.all([
    prisma.business.count({ where }),
    prisma.business.findFirst({ where, orderBy: [{ publishedAt: "desc" }, { id: "desc" }], select: { publishedAt: true } }),
  ]);
  return { count, newestAt: newest?.publishedAt ?? null };
}
