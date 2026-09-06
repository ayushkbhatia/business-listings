import type { Prisma, PrismaClient } from "@/lib/db/generated/client";

/**
 * Which library template a category answers to. One definition, for everyone.
 *
 * ## Why this file exists
 *
 * Before board 4e, `SpecTemplate` carried a `categoryId` and six readers
 * resolved "the template for this category" separately — five of them as
 * `findFirst({ where: { categoryId }, orderBy: { version: "desc" } })` and one
 * as `Category.defaultTemplateId`. On the seeded pump catalogue they already
 * disagreed: `seedPumps` creates a template against the category and never sets
 * `defaultTemplateId`, so the buyer-facing facet rail found it and
 * `templateForCategory` found nothing — a pump seller's required fields were
 * silently never enforced.
 *
 * Board 4e makes the relation many-to-many, which turns that disagreement from
 * a bug into an unanswerable question: a subcategory holds several templates,
 * so "the one for this category" needs a rule rather than a `findFirst`. The
 * rule is `4d`'s per-subcategory **default**, and `Category.defaultTemplateId`
 * is where it lives.
 *
 * ## The rule
 *
 *   1. The category's own default.
 *   2. Its parent's default. Templates belong to the trade, not the niche: the
 *      seeded one is on "Valves & fittings" and there is none on "Gate valves",
 *      and two levels is the whole taxonomy, so one hop up is the whole search.
 *   3. Any live template serving the category, then its parent. A fallback, not
 *      a preference — it is what stops a subcategory that has a template and no
 *      default from resolving to nothing, which is the exact state the pump
 *      catalogue was in.
 */

/*
   The client is injected rather than imported, and this module is deliberately
   free of `server-only` and of `@/lib/db/client`. `scripts/reindex.mts` builds
   its own `PrismaClient` and needs this same rule — a script resolving the
   template a different way is how there came to be six answers in the first
   place.
*/
type Client = Pick<PrismaClient, "category" | "specTemplate"> | Prisma.TransactionClient;

export async function resolveTemplateId(
  client: Client,
  categoryId: string,
): Promise<string | null> {
  const category = await client.category.findUnique({
    where: { id: categoryId },
    select: {
      defaultTemplateId: true,
      parentId: true,
      parent: { select: { defaultTemplateId: true } },
    },
  });
  if (!category) return null;
  if (category.defaultTemplateId) return category.defaultTemplateId;
  if (category.parent?.defaultTemplateId) return category.parent.defaultTemplateId;

  const ids = category.parentId ? [categoryId, category.parentId] : [categoryId];
  const serving = await client.specTemplate.findFirst({
    where: { status: "live", categories: { some: { categoryId: { in: ids } } } },
    // The category's own template before its parent's, then the newest — the
    // same preference order the two default lookups above express.
    orderBy: [{ version: "desc" }, { name: "asc" }],
    select: { id: true, categories: { select: { categoryId: true } } },
  });
  return serving?.id ?? null;
}

/** The template a category answers to, with its fields in template order. */
export async function resolveTemplate(client: Client, categoryId: string) {
  const templateId = await resolveTemplateId(client, categoryId);
  if (!templateId) return null;
  return client.specTemplate.findUnique({
    where: { id: templateId },
    include: { fields: { orderBy: { sortOrder: "asc" } } },
  });
}
