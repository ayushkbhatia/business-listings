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

/**
 * The same rule, for many categories at once.
 *
 * `resolveTemplateId` is one category and three queries, which is right for a
 * request and wrong for a sweep: `lib/metrics/strength-job.ts` scores every
 * product on the platform in one pass, and a query per product is not a job it
 * can finish. That is why it read `category.defaultTemplateId` directly and
 * became the eighth divergent resolver — step 1 of a three-step rule, applied
 * as if it were the whole rule.
 *
 * So the sweep gets a bulk reader rather than a shortcut. Three queries total,
 * whatever the size of the input, and **the same answer as calling
 * `resolveTemplateId` once per category** — including step 3's quirk, which is
 * that it takes the newest live template serving *either* the category or its
 * parent rather than preferring the category's own. That is what the `findFirst`
 * above does today; reproducing it is the point, and changing it belongs in a
 * change to both.
 */
export async function resolveTemplateIds(
  client: Client,
  categoryIds: readonly string[],
): Promise<Map<string, string | null>> {
  const wanted = [...new Set(categoryIds)];
  const out = new Map<string, string | null>();
  if (wanted.length === 0) return out;

  const [categories, templates] = await Promise.all([
    client.category.findMany({
      where: { id: { in: wanted } },
      select: {
        id: true,
        defaultTemplateId: true,
        parentId: true,
        parent: { select: { defaultTemplateId: true } },
      },
    }),
    /*
       Step 3's whole pool, in the order `findFirst` would have walked it. Live
       templates are a staff-authored set in the dozens, so reading all of them
       is cheaper than one query per category and the ordering is what makes
       the two readers agree.
    */
    client.specTemplate.findMany({
      where: { status: "live" },
      orderBy: [{ version: "desc" }, { name: "asc" }],
      select: { id: true, categories: { select: { categoryId: true } } },
    }),
  ]);

  // Where each template sits in that order, so "whichever `findFirst` would
  // have returned" is a comparison rather than another query.
  const rank = new Map(templates.map((template, index) => [template.id, index]));
  const servedBy = new Map<string, string>();
  for (const template of templates) {
    for (const link of template.categories) {
      if (!servedBy.has(link.categoryId)) servedBy.set(link.categoryId, template.id);
    }
  }
  const earlier = (a: string | undefined, b: string | undefined): string | null => {
    if (!a) return b ?? null;
    if (!b) return a;
    return (rank.get(a) ?? Infinity) <= (rank.get(b) ?? Infinity) ? a : b;
  };

  for (const category of categories) {
    if (category.defaultTemplateId) {
      out.set(category.id, category.defaultTemplateId);
      continue;
    }
    if (category.parent?.defaultTemplateId) {
      out.set(category.id, category.parent.defaultTemplateId);
      continue;
    }
    out.set(
      category.id,
      earlier(
        servedBy.get(category.id),
        category.parentId ? servedBy.get(category.parentId) : undefined,
      ),
    );
  }

  // A category id that names no row resolves to null, the same as
  // `resolveTemplateId`'s `if (!category) return null`.
  for (const id of wanted) if (!out.has(id)) out.set(id, null);
  return out;
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
