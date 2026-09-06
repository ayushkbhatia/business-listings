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

export interface CatalogueRow {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  status: string;
  availability: string;
  stockQty: number | null;
  leadTimeDays: number | null;
  categoryName: string;
  /** How many of the template's filterable fields this product has filled. */
  filterableFilled: number;
  filterableTotal: number;
  photoCount: number;
  updatedAt: Date;
  /** Set when a CSV created this row and the run can still be undone. */
  fromImport: boolean;
  /**
   * Buyers waiting for this line to come back into stock.
   *
   * Board 1e's "Notify me" creates one of these, and this is where the seller
   * meets it: on the row they would edit to fix it, rather than on a screen
   * they have to remember to visit. A count on an out-of-stock line is the
   * clearest argument the directory makes for restocking something.
   */
  watchers: number;
}

export interface CatalogueView {
  rows: CatalogueRow[];
  total: number;
  /** Products with no filterable spec at all — the number board 11e argues from. */
  missingFilterableSpecs: number;
  draftCount: number;
}

export async function getCatalogue(businessId: string): Promise<CatalogueView> {
  const products = await prisma.product.findMany({
    where: { businessId },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      sku: true,
      status: true,
      availability: true,
      stockQty: true,
      leadTimeDays: true,
      specValues: true,
      importRunId: true,
      updatedAt: true,
      category: {
        select: {
          id: true,
          name: true,
          /*
             The parent's template counts too.

             A template belongs to the trade, not the niche: the seeded one sits
             on "Valves & fittings" and there is none on "Ball valves". This
             read only the product's own category, so every product filed under
             a subcategory came back with no filterable fields — which the table
             rendered as "No template" and `missingFilterableSpecs` excluded
             from its own count, because a product with nothing to fill cannot
             be missing anything. Two screens agreeing on a number neither had
             measured.

             Resolved below in one pass rather than per row: see `templateIdFor`.
          */
          defaultTemplateId: true,
          parent: { select: { defaultTemplateId: true } },
        },
      },
      _count: {
        select: {
          media: true,
          // Open watches only. A fired one has already done its job.
          watches: { where: { notifiedAt: null } },
        },
      },
    },
  });

  /*
     Two queries for every template on the page, not two per product.

     The rows share a handful of categories between them, so the filterable
     fields are fetched once per distinct template and looked up per row. Doing
     the hop inside the map would be one `category.findUnique` plus one
     `specField.findMany` per product — 128 round trips on a 64-product
     catalogue, for a figure the previous version got wrong for free.
  */
  const templateIds = [
    ...new Set(
      products
        .map((p) => p.category.defaultTemplateId ?? p.category.parent?.defaultTemplateId)
        .filter((id): id is string => id !== null && id !== undefined),
    ),
  ];
  const filterableFields =
    templateIds.length > 0
      ? await prisma.specField.findMany({
          where: { templateId: { in: templateIds }, isFilterable: true },
          select: { id: true, templateId: true },
        })
      : [];
  const filterableByTemplate = new Map<string, string[]>();
  for (const field of filterableFields) {
    const list = filterableByTemplate.get(field.templateId);
    if (list) list.push(field.id);
    else filterableByTemplate.set(field.templateId, [field.id]);
  }

  const rows: CatalogueRow[] = products.map((product) => {
    const templateId =
      product.category.defaultTemplateId ?? product.category.parent?.defaultTemplateId ?? null;
    const filterable = (templateId ? filterableByTemplate.get(templateId) : undefined) ?? [];
    const values = (product.specValues ?? {}) as Record<string, unknown>;
    const filled = filterable.filter((fieldId) => {
      const value = values[fieldId];
      return value !== undefined && value !== null && value !== "";
    }).length;

    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      sku: product.sku,
      status: product.status,
      availability: product.availability,
      stockQty: product.stockQty,
      leadTimeDays: product.leadTimeDays,
      categoryName: product.category.name,
      filterableFilled: filled,
      filterableTotal: filterable.length,
      photoCount: product._count.media,
      updatedAt: product.updatedAt,
      fromImport: product.importRunId !== null,
      watchers: product._count.watches,
    };
  });

  return {
    rows,
    total: rows.length,
    // Counted the way board 11e phrases it: "62 products are missing filterable
    // specs" means none at all, not merely incomplete.
    missingFilterableSpecs: rows.filter((r) => r.filterableTotal > 0 && r.filterableFilled === 0)
      .length,
    draftCount: rows.filter((r) => r.status === "draft").length,
  };
}

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
