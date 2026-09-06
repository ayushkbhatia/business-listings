import "server-only";
import { prisma } from "@/lib/db/client";
import { toCsv } from "@/lib/import/csv";
import {
  CORE_COLUMNS,
  DOC_COLUMNS,
  PHOTO_COLUMNS,
  REFERENCE_COLUMNS,
  exportHeaders,
} from "@/lib/import/round-trip";
import { resolveTemplateId } from "@/lib/spec/resolve";
import { gapsFor } from "./gaps";

/**
 * Board `3f`'s `Export ▾`, and board `3f` Q3's answer.
 *
 * *"Does `Export ▾` produce the file `11d` can read back?"* — yes, and the way
 * that stays true is that both halves read their column names from
 * `lib/import/round-trip.ts`. The export was specified in `3f` §1 and never
 * built; `3h` §6 recorded it as one-way until `11d` existed. It exists here.
 *
 * The point of it is not backup. It is the bulk edit §5 describes: export, fix
 * four hundred rows in Excel where fixing four hundred rows is easy, re-import,
 * and the SKUs match so the products update rather than duplicate. That loop is
 * why `sku` is the first column in the file — it is the one a seller must not
 * casually delete.
 *
 * ## What it does not contain
 *
 * **No price.** There is no price on a product to export — non-negotiable 1 —
 * so this is not a column that is stripped, it is a column that never existed.
 *
 * **No `views`.** §5 lists `views` among the reference columns. This schema has
 * no per-product view count: `StorefrontDailyStat` rolls views up per business
 * per day and nothing attributes one to a product. Writing the column would
 * mean writing zeros and labelling them a measurement, and a directory's only
 * asset is that its numbers are true. The other four reference columns —
 * `url`, `enquiries`, `completeness`, `updated_at` — are real queries and are
 * written.
 */

export interface CatalogueExport {
  filename: string;
  csv: string;
  rows: number;
  /** Distinct template field keys the file carries a column for. */
  specKeys: string[];
}

const STOCK_STATUS: Record<string, string> = {
  in_stock: "in_stock",
  made_to_order: "made_to_order",
  indent: "indent",
  out_of_stock: "out_of_stock",
};

/** `2026-09-06`. A date a spreadsheet will not reinterpret as something else. */
function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

const basename = (path: string): string => path.split("/").pop() ?? path;

export async function exportCatalogue(input: {
  businessId: string;
  origin: string;
  /** Only these products, when the seller exported a selection. */
  productIds?: readonly string[];
}): Promise<CatalogueExport> {
  const products = await prisma.product.findMany({
    where: {
      businessId: input.businessId,
      ...(input.productIds && input.productIds.length > 0
        ? { id: { in: [...input.productIds] } }
        : {}),
    },
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      sku: true,
      description: true,
      availability: true,
      stockQty: true,
      leadTimeDays: true,
      specValues: true,
      updatedAt: true,
      categoryId: true,
      category: { select: { name: true, slug: true } },
      business: { select: { slug: true } },
      _count: { select: { enquiryLines: true } },
      media: {
        orderBy: { sortOrder: "asc" },
        select: { media: { select: { filename: true, storagePath: true } } },
      },
      documents: {
        orderBy: { sortOrder: "asc" },
        select: { document: { select: { filename: true } } },
      },
    },
  });

  /*
     One column per distinct field key across every template in play, not per
     template.

     A catalogue spanning three subcategories has three templates, and a file
     with three separate `Nominal size` columns would be three columns the
     seller has to keep in step by hand — and on the way back in, three columns
     competing for one field. Keys are shared across templates by design, which
     is what makes the per-row resolution on import work; the export uses the
     same fact.
  */
  const categoryIds = [...new Set(products.map((product) => product.categoryId))];
  const templateIds = await Promise.all(
    categoryIds.map(async (categoryId) => ({
      categoryId,
      templateId: await resolveTemplateId(prisma, categoryId),
    })),
  );
  const liveTemplateIds = [
    ...new Set(templateIds.map((t) => t.templateId).filter((id): id is string => id !== null)),
  ];

  const fields = liveTemplateIds.length
    ? await prisma.specField.findMany({
        where: { templateId: { in: liveTemplateIds } },
        orderBy: [{ sortOrder: "asc" }, { key: "asc" }],
        select: { id: true, key: true, templateId: true, required: true, requiredFrom: true, isFilterable: true },
      })
    : [];

  const specKeys: string[] = [];
  for (const field of fields) if (!specKeys.includes(field.key)) specKeys.push(field.key);

  const templateByCategory = new Map(templateIds.map((t) => [t.categoryId, t.templateId]));
  const fieldsByTemplate = new Map<string, typeof fields>();
  for (const field of fields) {
    const list = fieldsByTemplate.get(field.templateId) ?? [];
    list.push(field);
    fieldsByTemplate.set(field.templateId, list);
  }

  const header = exportHeaders(specKeys);
  const lines: string[][] = [header];

  for (const product of products) {
    const values = (product.specValues ?? {}) as Record<string, unknown>;
    const templateId = templateByCategory.get(product.categoryId);
    const templateFields = templateId ? (fieldsByTemplate.get(templateId) ?? []) : [];

    // Key -> the id this product's own template uses. `specValues` is keyed by
    // SpecField id and the file is keyed by key; this is the same translation
    // the import does in the other direction.
    const idByKey = new Map(templateFields.map((field) => [field.key, field.id]));

    const gaps = gapsFor(
      templateFields.map((field) => ({
        fieldId: field.id,
        requiredNow: field.required && (field.requiredFrom === null || field.requiredFrom <= new Date()),
        isFacet: field.isFilterable,
      })),
      values,
    );

    const photos = product.media
      .map((row) => row.media.filename ?? basename(row.media.storagePath))
      .slice(0, PHOTO_COLUMNS.length);
    const documents = product.documents
      .map((row) => row.document.filename)
      .slice(0, DOC_COLUMNS.length);

    lines.push([
      product.sku ?? "",
      product.name,
      // The subcategory's **slug**, not its display name. It is the value the
      // import matches against, and a slug survives a rename where a name does
      // not — `categoryKey` on the way back in accepts either.
      product.category.slug,
      product.description ?? "",
      STOCK_STATUS[product.availability] ?? product.availability,
      product.stockQty === null ? "" : String(product.stockQty),
      product.leadTimeDays === null ? "" : String(product.leadTimeDays),
      ...specKeys.map((key) => {
        const id = idByKey.get(key);
        if (!id) return ""; // Not a field on this row's template.
        const value = values[id];
        if (value === null || value === undefined) return "";
        return Array.isArray(value) ? value.join(" | ") : String(value);
      }),
      ...PHOTO_COLUMNS.map((_, i) => photos[i] ?? ""),
      ...DOC_COLUMNS.map((_, i) => documents[i] ?? ""),
      `${input.origin}/b/${product.business.slug}/p/${product.slug}`,
      String(product._count.enquiryLines),
      gaps.total === 0 ? "" : `${gaps.filled}/${gaps.total}`,
      isoDay(product.updatedAt),
    ]);
  }

  return {
    filename: `catalogue-${isoDay(new Date())}.csv`,
    csv: toCsv(lines),
    rows: products.length,
    specKeys,
  };
}

/** Named so the route and the tests agree about the shape without importing it twice. */
export const EXPORT_COLUMN_COUNT_BASE =
  CORE_COLUMNS.length + PHOTO_COLUMNS.length + DOC_COLUMNS.length + REFERENCE_COLUMNS.length;
