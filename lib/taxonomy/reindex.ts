import "server-only";
import { prisma } from "@/lib/db/client";
import { reindexBusinessCatalogue } from "@/lib/search/reindex";

/**
 * Board 4d — the match surfaces a taxonomy write leaves stale.
 *
 * A listing's search text carries its categories' names and synonyms, and a
 * product's carries its category's name (`lib/search/index-text.ts`). Renaming a
 * category, editing its synonyms, or merging one into another changes what
 * every listing filed there is findable by — and until this nothing rebuilt
 * them, so a synonym added on the editor routed through the live `synonyms`
 * match and never reached the text the ranking reads.
 *
 * Run after the response, from the action, because a sector can hold thousands
 * of listings and the person who pressed Save is not waiting on search. One
 * business at a time: each rebuild reads that business's catalogue, and
 * doing hundreds at once would be hundreds of concurrent catalogue reads against
 * a pooled database. A failure on one is logged and the rest continue — a
 * single bad row must not leave every listing after it stale.
 */
export async function reindexCategoryListings(categoryIds: readonly string[]): Promise<{ reindexed: number; failed: number }> {
  if (categoryIds.length === 0) return { reindexed: 0, failed: 0 };
  const ids = [...new Set(categoryIds)];

  const businesses = await prisma.business.findMany({
    where: {
      OR: [
        { primaryCategoryId: { in: ids } },
        { categories: { some: { categoryId: { in: ids } } } },
        { products: { some: { categoryId: { in: ids } } } },
      ],
    },
    select: { id: true },
    orderBy: [{ id: "asc" }],
  });

  let reindexed = 0;
  let failed = 0;
  for (const business of businesses) {
    try {
      await reindexBusinessCatalogue(business.id);
      reindexed += 1;
    } catch (error) {
      failed += 1;
      console.error("[taxonomy] reindex failed", { businessId: business.id, error });
    }
  }
  return { reindexed, failed };
}
