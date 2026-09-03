import "server-only";
import type { Prisma } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";

/**
 * Board 1e — the catalogue behind one seller's Products tab.
 *
 * Everything here is scoped to one business. That is not a detail: the whole
 * page is a buyer standing in front of one supplier deciding what to ask them
 * for, and a query that could accidentally cross a seller boundary would put
 * somebody else's stock in the list a buyer is about to enquire about.
 */

/** The board's four, and no price sort exists to add. */
export type CatalogueSort = "availability" | "recent" | "name" | "enquired";

const SORTS: readonly CatalogueSort[] = ["availability", "recent", "name", "enquired"];

export const CATALOGUE_PAGE_SIZE = 24;

/**
 * Below this the rail collapses to availability alone.
 *
 * Board 1e: "spec filters over eight products are noise". Config rather than a
 * literal in a component, because the number is a judgement about when a filter
 * starts earning its space and somebody will want to move it.
 */
export const SPEC_FILTER_MIN_PRODUCTS = 12;

/**
 * How old a stock count may be and still be shown as a number.
 *
 * Past this the surface shows the availability band alone. A stale "240 units"
 * is worse than "In stock": one is a promise the seller never made, and the
 * other is true.
 */
export const STOCK_FRESH_DAYS = 30;

export interface CatalogueQuery {
  /** A subcategory of this seller's catalogue, by slug. */
  subcategory?: string;
  availability: string[];
  /** Keyed by platform `SpecField` id. */
  spec: Record<string, string[]>;
  sort: CatalogueSort;
  page: number;
}

const RESERVED = new Set(["subcategory", "availability", "sort", "page", "q"]);

function list(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).flatMap((v) => v.split(",")).filter(Boolean);
}

function one(value: string | string[] | undefined): string | undefined {
  return list(value)[0];
}

export function parseCatalogueQuery(
  params: Record<string, string | string[] | undefined>,
): CatalogueQuery {
  /*
     Anything unreserved is a spec facet keyed by `SpecField` id, exactly as the
     search page reads its rail. The rail is generated from the template, so the
     query string has to be open the same way — adding a filterable field must
     not need a code change here either.
  */
  const spec: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(params)) {
    if (RESERVED.has(key)) continue;
    const values = list(value);
    if (values.length > 0) spec[key] = values;
  }

  const page = Number(one(params.page));
  const sort = one(params.sort);

  return {
    subcategory: one(params.subcategory),
    availability: list(params.availability),
    spec,
    sort: SORTS.includes(sort as CatalogueSort) ? (sort as CatalogueSort) : "availability",
    page: Number.isFinite(page) && page > 1 ? page : 1,
  };
}

/** True when any filter is set — the page is then noindex and canonicalises up. */
export function isFiltered(query: CatalogueQuery): boolean {
  return Boolean(
    query.subcategory ||
      query.availability.length > 0 ||
      Object.keys(query.spec).length > 0,
  );
}

export function toCatalogueParams(
  query: CatalogueQuery,
  overrides: Partial<CatalogueQuery> = {},
): string {
  const merged = { ...query, ...overrides };
  const params = new URLSearchParams();

  if (merged.subcategory) params.set("subcategory", merged.subcategory);
  if (merged.availability.length > 0) params.set("availability", merged.availability.join(","));
  for (const [field, values] of Object.entries(merged.spec)) {
    if (values.length > 0) params.set(field, values.join(","));
  }
  // Defaults stay out of the URL so the unfiltered catalogue's canonical
  // matches the page itself.
  if (merged.sort !== "availability") params.set("sort", merged.sort);
  if (merged.page > 1) params.set("page", String(merged.page));

  return params.toString();
}

/** Published only. A draft is a product the seller has not offered yet. */
const PUBLIC_PRODUCT = { status: { not: "draft" } } as const;

function productWhere(
  businessId: string,
  query: CatalogueQuery,
  options: { ignoreAvailability?: boolean; ignoreSpecField?: string } = {},
): Prisma.ProductWhereInput {
  const and: Prisma.ProductWhereInput[] = [{ businessId, ...PUBLIC_PRODUCT }];

  if (query.subcategory) and.push({ category: { slug: query.subcategory } });

  if (!options.ignoreAvailability && query.availability.length > 0) {
    and.push({ availability: { in: query.availability as never[] } });
  }

  /*
     A facet's own values are counted with that facet's filter removed.

     Otherwise ticking "Stainless steel 316" makes every other body material
     read zero, and the rail stops being a way to change your mind. The search
     page's `getFixedFacets` makes the same choice for the same reason.
  */
  for (const [fieldId, values] of Object.entries(query.spec)) {
    if (values.length === 0 || fieldId === options.ignoreSpecField) continue;
    and.push({
      OR: values.flatMap((value) => [
        { specValues: { path: [fieldId], equals: value } },
        { specValues: { path: [fieldId], array_contains: [value] } },
      ]),
    });
  }

  return { AND: and };
}

export interface CatalogueSubcategory {
  id: string;
  slug: string;
  name: string;
  count: number;
}

export interface AvailabilityFacet {
  value: string;
  count: number;
  selected: boolean;
}

export interface SpecFilter {
  fieldId: string;
  /**
   * The **platform** label, never the seller's rename.
   *
   * Criterion 5, and the reason is comparability: if one seller calls it
   * "Bore" and another "Nominal size", the filter stops meaning one thing
   * across the directory. The seller's own label is theirs to use in their
   * dashboard.
   */
  label: string;
  unit: string | null;
  options: { value: string; count: number; selected: boolean }[];
}

export interface CatalogueProduct {
  id: string;
  slug: string;
  name: string;
  sku: string | null;
  availability: string;
  /** Null where the count is missing or too old to state. */
  stockQty: number | null;
  leadTimeDays: number | null;
  minOrderQty: number | null;
  specValues: Record<string, unknown>;
  categoryName: string;
  imagePath: string | null;
  /** Open restock watches, for the seller's own screens. Never shown publicly. */
  watchers?: number;
}

export interface CatalogueView {
  products: CatalogueProduct[];
  total: number;
  /** Published products for this seller, whatever the filters say. */
  catalogueTotal: number;
  subcategories: CatalogueSubcategory[];
  availability: AvailabilityFacet[];
  specFilters: SpecFilter[];
}

const AVAILABILITY_ORDER = ["in_stock", "made_to_order", "indent", "out_of_stock"] as const;

/**
 * A stock count, or null when it is too old to state.
 *
 * Criterion 8. Null both when nothing was ever recorded and when the record is
 * stale — the surface treats them the same because they mean the same thing to
 * a buyer: we cannot tell you a number.
 */
export function freshStock(
  stockQty: number | null,
  stockUpdatedAt: Date | null,
  now = new Date(),
): number | null {
  if (stockQty === null || stockUpdatedAt === null) return null;
  const age = now.getTime() - stockUpdatedAt.getTime();
  return age <= STOCK_FRESH_DAYS * 86_400_000 ? stockQty : null;
}

export async function getCatalogueView(
  businessId: string,
  query: CatalogueQuery,
  options: { now?: Date; withWatchers?: boolean } = {},
): Promise<CatalogueView> {
  const now = options.now ?? new Date();
  const where = productWhere(businessId, query);

  const [total, catalogueTotal, subcategoryRows, availabilityRows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.count({ where: { businessId, ...PUBLIC_PRODUCT } }),
    /*
       The seller's own subcategories, counted against everything except the
       subcategory filter — a buyer looking at "Gate valves" still needs to see
       how many butterfly valves there are to switch to them.
    */
    prisma.product.groupBy({
      by: ["categoryId"],
      where: productWhere(businessId, { ...query, subcategory: undefined }),
      _count: true,
    }),
    prisma.product.groupBy({
      by: ["availability"],
      where: productWhere(businessId, query, { ignoreAvailability: true }),
      _count: true,
    }),
  ]);

  const categories = await prisma.category.findMany({
    where: { id: { in: subcategoryRows.map((row) => row.categoryId) } },
    select: { id: true, slug: true, name: true },
  });
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  const subcategories: CatalogueSubcategory[] = subcategoryRows
    .map((row) => {
      const category = categoryById.get(row.categoryId);
      if (!category) return null;
      return { ...category, count: row._count };
    })
    .filter((row): row is CatalogueSubcategory => row !== null)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const availabilityCounts = new Map(
    availabilityRows.map((row) => [row.availability as string, row._count]),
  );
  const availability: AvailabilityFacet[] = AVAILABILITY_ORDER.map((value) => ({
    value,
    count: availabilityCounts.get(value) ?? 0,
    selected: query.availability.includes(value),
  }))
    // A band nobody stocks is not a filter, it is a dead row.
    .filter((facet) => facet.count > 0 || facet.selected);

  const specFilters =
    catalogueTotal >= SPEC_FILTER_MIN_PRODUCTS
      ? await getSpecFilters(businessId, query)
      : [];

  const products = await getPage(businessId, query, now, options.withWatchers ?? false);

  return { products, total, catalogueTotal, subcategories, availability, specFilters };
}

/**
 * The rail's spec blocks, generated from the platform template.
 *
 * Criterion 6: adding a filterable field to the platform template changes this
 * rail on every seller who clones it, with no code change. That is why the
 * candidates come from `SpecField.isFilterable` rather than from anything the
 * seller controls.
 *
 * A seller's `hidden` flag is deliberately **not** consulted. Hiding is about
 * how their own spec table reads; letting it remove a filter would make two
 * sellers' rails differ, which is the same incomparability criterion 5 forbids
 * for labels. A field with nothing behind it drops out anyway, because a filter
 * with one option is not a choice.
 */
async function getSpecFilters(
  businessId: string,
  query: CatalogueQuery,
): Promise<SpecFilter[]> {
  const seller = await prisma.sellerTemplate.findFirst({
    where: { businessId },
    select: {
      platformTemplate: {
        select: {
          fields: {
            where: { isFilterable: true },
            orderBy: { sortOrder: "asc" },
            select: { id: true, label: true, unit: true },
          },
        },
      },
    },
  });

  const fields = seller?.platformTemplate.fields ?? [];
  if (fields.length === 0) return [];

  const filters: SpecFilter[] = [];
  for (const field of fields) {
    /*
       Counted with this field's own filter removed, so a buyer can change their
       mind about it without every other option reading zero.
    */
    const rows = await prisma.product.findMany({
      where: productWhere(businessId, query, { ignoreSpecField: field.id }),
      select: { specValues: true },
    });

    const counts = new Map<string, number>();
    for (const row of rows) {
      const raw = (row.specValues as Record<string, unknown>)[field.id];
      if (raw === undefined || raw === null) continue;
      for (const value of Array.isArray(raw) ? raw : [raw]) {
        const text = String(value).trim();
        if (text) counts.set(text, (counts.get(text) ?? 0) + 1);
      }
    }

    const selected = query.spec[field.id] ?? [];
    const options = [...counts.entries()]
      .map(([value, count]) => ({ value, count, selected: selected.includes(value) }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

    // One option is not a choice, and zero is not a filter.
    if (options.length < 2 && selected.length === 0) continue;

    filters.push({ fieldId: field.id, label: field.label, unit: field.unit, options });
  }

  return filters;
}

/** One page of products, in the order the buyer asked for. */
async function getPage(
  businessId: string,
  query: CatalogueQuery,
  now: Date,
  withWatchers: boolean,
): Promise<CatalogueProduct[]> {
  const where = productWhere(businessId, query);
  const skip = (query.page - 1) * CATALOGUE_PAGE_SIZE;

  const select = {
    id: true,
    slug: true,
    name: true,
    sku: true,
    availability: true,
    stockQty: true,
    stockUpdatedAt: true,
    leadTimeDays: true,
    minOrderQty: true,
    specValues: true,
    category: { select: { name: true } },
    media: { orderBy: { sortOrder: "asc" as const }, take: 1, select: { storagePath: true } },
    ...(withWatchers
      ? { _count: { select: { watches: { where: { notifiedAt: null } } } } }
      : {}),
  };

  /*
     "Most enquired" is the one order the database cannot sort by directly:
     it is a count over `EnquiryLine`, and there is no denormalised column.

     Counted over this seller's catalogue rather than globally, then applied as
     an explicit id order. A seller's catalogue is bounded — the largest in the
     seed is a few hundred — so this is one grouped query, not a scan.
  */
  if (query.sort === "enquired") {
    const ids = await prisma.product.findMany({ where, select: { id: true } });
    const lines = await prisma.enquiryLine.groupBy({
      by: ["productId"],
      where: { productId: { in: ids.map((row) => row.id) } },
      _count: true,
    });
    const enquiries = new Map(
      lines.map((row) => [row.productId as string, row._count as number]),
    );

    const ordered = ids
      .map((row) => row.id)
      .sort((a, b) => (enquiries.get(b) ?? 0) - (enquiries.get(a) ?? 0))
      .slice(skip, skip + CATALOGUE_PAGE_SIZE);

    const rows = await prisma.product.findMany({ where: { id: { in: ordered } }, select });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ordered
      .map((id) => byId.get(id))
      .filter((row): row is (typeof rows)[number] => row !== undefined)
      .map((row) => toCatalogueProduct(row, now));
  }

  const orderBy: Prisma.ProductOrderByWithRelationInput[] =
    query.sort === "recent"
      ? [{ createdAt: "desc" }, { name: "asc" }]
      : query.sort === "name"
        ? [{ name: "asc" }]
        : /*
             The enum is declared in exactly this order — in stock, made to
             order, indent, out of stock — so ascending is the board's order
             without a CASE expression to keep in step with it.
          */
          [{ availability: "asc" }, { name: "asc" }];

  const rows = await prisma.product.findMany({
    where,
    select,
    orderBy,
    skip,
    take: CATALOGUE_PAGE_SIZE,
  });

  return rows.map((row) => toCatalogueProduct(row, now));
}

function toCatalogueProduct(
  row: {
    id: string;
    slug: string;
    name: string;
    sku: string | null;
    availability: string;
    stockQty: number | null;
    stockUpdatedAt: Date | null;
    leadTimeDays: number | null;
    minOrderQty: number | null;
    specValues: unknown;
    category: { name: string };
    media: { storagePath: string }[];
    _count?: { watches: number };
  },
  now: Date,
): CatalogueProduct {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    sku: row.sku,
    availability: row.availability,
    stockQty: freshStock(row.stockQty, row.stockUpdatedAt, now),
    leadTimeDays: row.leadTimeDays,
    minOrderQty: row.minOrderQty,
    specValues: (row.specValues ?? {}) as Record<string, unknown>,
    categoryName: row.category.name,
    imagePath: row.media[0]?.storagePath ?? null,
    ...(row._count ? { watchers: row._count.watches } : {}),
  };
}
