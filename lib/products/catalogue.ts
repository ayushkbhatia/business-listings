import "server-only";
import { prisma } from "@/lib/db/client";
import { readHidden } from "@/lib/billing/plan-caps";
import { gapRank, gapsFor, matchesGap } from "./gaps";
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZES,
  type CatalogueQuery,
  type CatalogueRow,
  type CatalogueSort,
  type CatalogueSummary,
  type CatalogueView,
} from "./catalogue-query";
import { resolveTemplatesFor } from "./catalogue-templates";

/**
 * Board 3f — every product the seller has, and the work outstanding on them.
 *
 * ## Why the derivation happens here and not in SQL
 *
 * The two counts this screen exists for — blocked on save, missing a filter
 * value — are a product's spec values judged against its template's required
 * flags and facet set. The template is not a column on the row; it is resolved
 * through the category, overlaid with the seller's own template, and the
 * required set is the platform's floor plus whatever the seller added. None of
 * that is expressible as a `where` clause, which is why board 3g derives it in
 * TypeScript and why this does too, from the same function.
 *
 * So the seller's rows are read once and judged in memory. That is the same
 * shape `fillFor` already uses for board 3h, and it is sound at catalogue
 * scale: the render's 1,242 products is a large supplier, and the row set is
 * narrow. `SCAN_CEILING` is where it stops being sound, and it says so out loud
 * rather than quietly returning a number that is only mostly right.
 *
 * ## Every count is a query
 *
 * The header total, the three status counts, both gap counts and the plan's cap
 * are all read. The board hardcoded all of them, including the 62 this splits
 * into 12 and 50.
 */

/**
 * Where one pass over a seller's catalogue stops being the right shape.
 *
 * Chosen against what the data model allows rather than what a seller has: the
 * Pro plan does not cap products, so there is no ceiling in the schema, and the
 * honest thing is to name the point at which the counts become approximate
 * rather than to let them silently drift. Nothing in the fixture approaches it.
 */
const SCAN_CEILING = 5_000;

const ROW_SELECT = {
  id: true,
  name: true,
  slug: true,
  sku: true,
  status: true,
  availability: true,
  stockQty: true,
  specValues: true,
  categoryId: true,
  importRunId: true,
  updatedAt: true,
  category: { select: { name: true } },
  _count: {
    select: {
      media: true,
      // Open watches only. A fired one has already done its job.
      watches: { where: { notifiedAt: null } },
    },
  },
} as const;

/**
 * The whole catalogue, judged once, then filtered, sorted and paged.
 *
 * One read and one derivation feed both the header and the table, so the
 * header's counts cannot disagree with the rows beneath them — which is
 * criterion 1, and which the board got wrong by adding two states on top of a
 * total and labelling the result as the live count.
 */
export async function getCatalogueView(
  businessId: string,
  query: CatalogueQuery = {},
): Promise<CatalogueView> {
  const [products, hiddenByPlan] = await Promise.all([
    prisma.product.findMany({
      where: { businessId },
      orderBy: [{ updatedAt: "desc" }],
      take: SCAN_CEILING + 1,
      select: ROW_SELECT,
    }),
    hiddenIdsFor(businessId),
  ]);

  const approximate = products.length > SCAN_CEILING;
  const scanned = approximate ? products.slice(0, SCAN_CEILING) : products;

  const { byCategory, gapFields } = await resolveTemplatesFor(
    businessId,
    scanned.map((product) => product.categoryId),
  );

  const rows: CatalogueRow[] = scanned.map((product) => {
    const fields = gapFields.get(product.categoryId);
    const template = byCategory.get(product.categoryId);
    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      sku: product.sku,
      categoryId: product.categoryId,
      categoryName: product.category.name,
      templateName: template?.templateName ?? null,
      status: product.status,
      availability: product.availability,
      stockQty: product.stockQty,
      photoCount: product._count.media,
      watchers: product._count.watches,
      updatedAt: product.updatedAt,
      fromImport: product.importRunId !== null,
      gaps: gapsFor(fields ?? [], product.specValues),
      untemplated: fields === undefined || fields.length === 0,
      storedNotListed: product.status === "draft" && hiddenByPlan.has(product.id),
    };
  });

  const summary: CatalogueSummary = {
    total: rows.length,
    live: rows.filter((row) => row.status === "live").length,
    draft: rows.filter((row) => row.status === "draft").length,
    outOfStock: rows.filter((row) => row.status === "out_of_stock").length,
    // Counted separately and never added together: one is a wall in front of
    // the seller's next edit, the other is reach they will never notice losing.
    blockedOnSave: rows.filter((row) => row.gaps.requiredMissing > 0).length,
    missingFilterValue: rows.filter((row) => row.gaps.filterGaps > 0).length,
    untemplated: rows.filter((row) => row.untemplated).length,
    approximate,
  };

  const needle = query.q?.trim().toLowerCase() ?? "";
  // Built once. A `find` per row inside the filter is quadratic, and this list
  // exists to be long.
  const valuesById = new Map(scanned.map((product) => [product.id, product.specValues]));

  const filtered = rows.filter((row) => {
    if (query.categoryId && row.categoryId !== query.categoryId) return false;
    if (query.status && row.status !== query.status) return false;
    if (query.template && row.templateName !== query.template) return false;
    if (query.gap && !matchesGap(row.gaps, query.gap)) return false;
    if (needle) {
      /*
         Name, SKU and spec values in one test.

         `searchText` already carries all three — `buildProductSearchText`
         packs the name, the SKU, the description, the category and every spec
         value with its size synonyms — so "PN16" finds the products carrying
         that value without a facet, which is what §2 asks for. Matched here
         rather than in SQL because the row set is already in memory and a
         second query would have to re-derive the gap filters anyway.
      */
      const hay = `${row.name} ${row.sku ?? ""} ${row.categoryName}`.toLowerCase();
      if (!hay.includes(needle) && !matchesSpecValues(valuesById.get(row.id), needle)) return false;
    }
    return true;
  });

  const sort = query.sort ?? "gaps";
  filtered.sort(comparatorFor(sort));

  const pageSize = PAGE_SIZES.includes((query.pageSize ?? 0) as (typeof PAGE_SIZES)[number])
    ? query.pageSize!
    : DEFAULT_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(Math.max(1, query.page ?? 1), pageCount);

  return {
    rows: filtered.slice((page - 1) * pageSize, page * pageSize),
    summary,
    filtered: filtered.length,
    page,
    pageSize,
    /*
       Every id in the filtered set, not the page's.

       Board 3f's open question 5: `Select all N` always means the current
       filtered set, and the label carries that count. A bulk action whose blast
       radius changes when a chip is clicked is the trap §3 exists to close, and
       the only way the client can be sure of the scope is to be handed it.
    */
    filteredIds: filtered.map((row) => row.id),
    categories: countBy(rows, (row) => [row.categoryId, row.categoryName]),
    templates: countBy(rows, (row) =>
      row.templateName ? [row.templateName, row.templateName] : null,
    ),
  };
}

/** The filter-gap figure alone, for a screen that only argues from it. */
export async function catalogueGapSummary(businessId: string): Promise<CatalogueSummary> {
  const view = await getCatalogueView(businessId, { pageSize: 10 });
  return view.summary;
}

function matchesSpecValues(specValues: unknown, needle: string): boolean {
  const values = (specValues ?? {}) as Record<string, unknown>;
  for (const value of Object.values(values)) {
    const parts = Array.isArray(value) ? value : [value];
    for (const part of parts) {
      if (String(part ?? "").toLowerCase().includes(needle)) return true;
    }
  }
  return false;
}

function comparatorFor(sort: CatalogueSort): (a: CatalogueRow, b: CatalogueRow) => number {
  const recent = (a: CatalogueRow, b: CatalogueRow) =>
    b.updatedAt.getTime() - a.updatedAt.getTime();

  switch (sort) {
    case "name":
      return (a, b) => a.name.localeCompare(b.name);
    case "sku":
      return (a, b) => (a.sku ?? "").localeCompare(b.sku ?? "") || recent(a, b);
    case "template":
      return (a, b) => (a.templateName ?? "").localeCompare(b.templateName ?? "") || recent(a, b);
    case "stock":
      // Nulls last: "made to order" is a value, not a zero, and sorting it as
      // one would put every MTO line under the genuinely empty shelves.
      return (a, b) =>
        (a.stockQty ?? -1) === (b.stockQty ?? -1)
          ? recent(a, b)
          : (b.stockQty ?? -1) - (a.stockQty ?? -1);
    case "specs":
      return (a, b) => ratio(a) - ratio(b) || recent(a, b);
    case "status":
      return (a, b) => a.status.localeCompare(b.status) || recent(a, b);
    case "updated":
      return recent;
    case "gaps":
    default:
      /*
         The default, and the reason `Sort` is a control at all.

         Untemplated first — a product with no template cannot be published and
         the seller cannot discover that anywhere else. Then blocked on save,
         which is a wall. Then filter gaps, worst first, which is reach. Then
         everything that is fine, most recently edited.
      */
      return (a, b) =>
        gapRank(a.gaps, !a.untemplated) - gapRank(b.gaps, !b.untemplated) ||
        b.gaps.requiredMissing - a.gaps.requiredMissing ||
        b.gaps.filterGaps - a.gaps.filterGaps ||
        recent(a, b);
  }
}

function ratio(row: CatalogueRow): number {
  return row.gaps.total === 0 ? -1 : row.gaps.filled / row.gaps.total;
}

function countBy(
  rows: readonly CatalogueRow[],
  keyOf: (row: CatalogueRow) => [string, string] | null,
): { id: string; name: string; count: number }[] {
  const seen = new Map<string, { id: string; name: string; count: number }>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    const [id, name] = key;
    const entry = seen.get(id);
    if (entry) entry.count += 1;
    else seen.set(id, { id, name, count: 1 });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The products a plan drop unlisted, as a set.
 *
 * `Subscription.hiddenByPlan` is the record that makes "hidden, not deleted"
 * mean anything — without it a seller who downgraded would have to find and
 * republish every product by hand, and could not tell one the platform hid from
 * a draft they wrote themselves.
 */
async function hiddenIdsFor(businessId: string): Promise<Set<string>> {
  const subscription = await prisma.subscription.findUnique({
    where: { businessId },
    select: { hiddenByPlan: true },
  });
  return new Set(readHidden(subscription?.hiddenByPlan));
}

/*
   Re-exported so a server caller has one import for the query and its shapes.
   The client half imports `./catalogue-query` directly — see its header.
*/
export {
  CATALOGUE_SORTS,
  DEFAULT_PAGE_SIZE,
  PAGE_SIZES,
  type CatalogueQuery,
  type CatalogueRow,
  type CatalogueSort,
  type CatalogueSummary,
  type CatalogueView,
} from "./catalogue-query";
