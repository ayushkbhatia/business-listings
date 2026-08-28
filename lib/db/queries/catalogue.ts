import "server-only";
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
          defaultTemplate: {
            select: { fields: { where: { isFilterable: true }, select: { id: true } } },
          },
        },
      },
      _count: { select: { media: true } },
    },
  });

  const rows: CatalogueRow[] = products.map((product) => {
    const filterable = product.category.defaultTemplate?.fields ?? [];
    const values = (product.specValues ?? {}) as Record<string, unknown>;
    const filled = filterable.filter((f) => {
      const value = values[f.id];
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

/** One product, for the editor. Null when it belongs to someone else. */
export async function getProductForEditor(businessId: string, productId: string) {
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
      category: { select: { name: true, defaultTemplate: { select: { id: true } } } },
      media: { orderBy: { sortOrder: "asc" }, select: { id: true, storagePath: true, alt: true } },
    },
  });
  if (!product || product.businessId !== businessId) return null;
  return product;
}

/** The business's own clone of a category template, if it has cloned one. */
export async function getSellerTemplateForCategory(businessId: string, categoryId: string) {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { defaultTemplate: { select: { id: true } } },
  });
  const platformTemplateId = category?.defaultTemplate?.id;
  if (!platformTemplateId) return null;

  return prisma.sellerTemplate.findFirst({
    where: { businessId, platformTemplateId },
    select: { id: true },
  });
}

/** Saved column mappings, for the "use last month's mapping" control. */
export async function getSavedMappings(businessId: string) {
  return prisma.importMapping.findMany({
    where: { businessId },
    orderBy: [{ usedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true, name: true, columnPlan: true, createdAt: true, usedAt: true },
  });
}
