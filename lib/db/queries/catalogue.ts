import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db/client";
import type { SpecFieldOption } from "@/lib/import/columns";

/**
 * Reads for the catalogue loop — boards 3f, 3g, 3h and 11d.
 *
 * Every read is scoped to one `businessId`, taken from the actor and never from
 * a route parameter, exactly as lib/db/queries/seller.ts is. A seller who edits
 * the id in the URL gets a 404 rather than somebody else's catalogue.
 */

/*
   `getCatalogue` and its row type lived here and are gone.

   Board 3f reads `lib/products/catalogue.ts` now, because the two counts that
   screen exists for — blocked on save, missing a filter value — are spec values
   judged against a template's required flags and facet set, and none of that is
   a `where` clause. Keeping a second, thinner catalogue query beside it would be
   a second answer to the same question, which is the defect board 3g was built
   to close.
*/

/** The platform template for a category, as the import mapper needs it. */
/**
 * A category's default template, or its parent's.
 *
 * Templates belong to the trade, not to the niche: the seeded one is on
 * "Valves & fittings" and there is none on "Gate valves". Filing a supplier
 * under a subcategory used to take the spec fields away from their whole
 * catalogue — the CSV mapper offered none to map onto, the template screen said
 * there was no template, and nothing said why. Two levels is the whole
 * taxonomy, so one hop up is the whole search.
 */
export async function resolveDefaultTemplateId(categoryId: string): Promise<string | null> {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { defaultTemplateId: true, parent: { select: { defaultTemplateId: true } } },
  });
  return category?.defaultTemplateId ?? category?.parent?.defaultTemplateId ?? null;
}

export async function getSpecFieldOptions(categoryId: string): Promise<SpecFieldOption[]> {
  const templateId = await resolveDefaultTemplateId(categoryId);
  if (!templateId) return [];

  const fields = await prisma.specField.findMany({
    where: { templateId },
    orderBy: { sortOrder: "asc" },
    select: { id: true, key: true, label: true, isFilterable: true },
  });
  return fields;
}

/**
 * One product, for the editor. Null when it belongs to someone else.
 *
 * Cached per request because `generateMetadata` and the page body both need it,
 * and Next runs them as two passes over the same route — without this every
 * open of the editor ran the query twice. Same reason `getSpecTemplate` is
 * wrapped.
 */
export const getProductForEditor = cache(async (businessId: string, productId: string) => {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      businessId: true,
      name: true,
      slug: true,
      sku: true,
      description: true,
      status: true,
      availability: true,
      stockQty: true,
      leadTimeDays: true,
      minOrderQty: true,
      specValues: true,
      categoryId: true,
      category: { select: { name: true } },
      // The public path this product sits on, for the Preview link and for the
      // revalidation `saveProduct` does after a write.
      business: { select: { slug: true } },
      media: { orderBy: { sortOrder: "asc" }, select: { id: true, storagePath: true, alt: true } },
    },
  });
  if (!product || product.businessId !== businessId) return null;
  return product;
});

/** Saved column mappings, for the "use last month's mapping" control. */
export async function getSavedMappings(businessId: string) {
  return prisma.importMapping.findMany({
    where: { businessId },
    orderBy: [{ usedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true, name: true, columnPlan: true, createdAt: true, usedAt: true },
  });
}
