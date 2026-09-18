import "server-only";
import { prisma } from "@/lib/db/client";
import type { CompareField, CompareProduct } from "@/lib/compare/table";
import type { TrayItem, TrayTrade } from "@/lib/compare/tray";
import { resolveTemplate } from "@/lib/spec/resolve";
import { freshStock } from "./storefront-catalogue";
import { PUBLIC_BUSINESS } from "./search";

/**
 * Board `10d` — the products a comparison names, read fresh.
 *
 * The cookie and the URL both carry ids and nothing else the page trusts. Every
 * column is read here, from the database, on the request: a product delisted
 * since it was added drops out, a seller suspended since drops out with it, and
 * a stock count too old to state is not stated. The tray's labels are a label;
 * this is the record.
 */

/** What "on the directory" means for a product — the predicate search uses. */
const PUBLIC_PRODUCT = { status: { not: "draft" as const }, business: PUBLIC_BUSINESS };

/**
 * One product, as the tray needs it — or null when it is not a product a buyer
 * can compare.
 *
 * The trade is the product's own category. One comparison, one trade: the
 * rows come from that category's template (`B1`), and a product filed under
 * another has different fields, not blank ones.
 */
export async function trayItemFor(productId: string): Promise<{ item: TrayItem; trade: TrayTrade } | null> {
  const product = await prisma.product.findFirst({
    where: { id: productId, ...PUBLIC_PRODUCT },
    select: {
      id: true,
      name: true,
      category: { select: { id: true, name: true } },
      business: { select: { displayName: true } },
    },
  });
  if (!product) return null;
  return {
    item: { id: product.id, name: product.name, seller: product.business.displayName },
    trade: { id: product.category.id, name: product.category.name },
  };
}

export interface ComparedProduct extends CompareProduct {
  slug: string;
  name: string;
  sku: string | null;
  businessSlug: string;
  /** Always `displayName`. The trade name reaches no column. */
  seller: string;
  verificationTier: number;
  verifiedAt: Date | null;
  imagePath: string | null;
}

export interface LoadedComparison {
  /** The trade the columns share. Null when nothing resolved. */
  trade: TrayTrade | null;
  /** The template's fields in its own order — the rows (`B1`). Empty where the trade has none. */
  fields: CompareField[];
  /** In the order the buyer chose them (`B12`). */
  products: ComparedProduct[];
  /** Ids the URL named that are no longer listed — delisted, drafted, or their seller suspended (`B10`). */
  delisted: number;
  /** Products named in another trade, left out rather than compared against fields they do not have. */
  otherTrade: { id: string; name: string; trade: string }[];
}

/**
 * Up to four products, one trade, one template.
 *
 * **The trade is the first product's.** A URL that names products from two
 * trades — hand-edited, or older than the one-trade rule — is compared in the
 * trade the buyer picked first, and the rest are named and left out. Nothing
 * is dropped without the page saying so.
 */
export async function loadComparison(ids: readonly string[], now = new Date()): Promise<LoadedComparison> {
  if (ids.length === 0) return { trade: null, fields: [], products: [], delisted: 0, otherTrade: [] };

  const rows = await prisma.product.findMany({
    where: { id: { in: [...ids] }, ...PUBLIC_PRODUCT },
    select: {
      id: true,
      slug: true,
      name: true,
      sku: true,
      availability: true,
      stockQty: true,
      stockUpdatedAt: true,
      leadTimeDays: true,
      specValues: true,
      category: { select: { id: true, name: true } },
      business: {
        select: {
          slug: true,
          displayName: true,
          verificationTier: true,
          verifiedAt: true,
          responseTimeMedianMs: true,
        },
      },
      media: {
        orderBy: [{ sortOrder: "asc" }, { mediaId: "asc" }],
        take: 1,
        select: { media: { select: { storagePath: true } } },
      },
    },
  });

  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered = ids.map((id) => byId.get(id)).filter((row): row is NonNullable<typeof row> => Boolean(row));
  const delisted = ids.length - ordered.length;

  const first = ordered[0];
  if (!first) return { trade: null, fields: [], products: [], delisted, otherTrade: [] };
  const trade: TrayTrade = { id: first.category.id, name: first.category.name };

  const inTrade = ordered.filter((row) => row.category.id === trade.id);
  const otherTrade = ordered
    .filter((row) => row.category.id !== trade.id)
    .map((row) => ({ id: row.id, name: row.name, trade: row.category.name }));

  const template = await resolveTemplate(prisma, trade.id);
  const fields: CompareField[] = (template?.fields ?? []).map((field) => ({
    id: field.id,
    key: field.key,
    label: field.label,
    unit: field.unit,
    type: field.type,
    isFilterable: field.isFilterable,
    options: field.options,
  }));

  return {
    trade,
    fields,
    products: inTrade.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      sku: row.sku,
      businessSlug: row.business.slug,
      seller: row.business.displayName,
      verificationTier: row.business.verificationTier,
      verifiedAt: row.business.verifiedAt,
      imagePath: row.media[0]?.media.storagePath ?? null,
      specValues: row.specValues,
      availability: row.availability,
      /* A count older than the freshness window is not a count a buyer can use (`1e` criterion 8). */
      stockQty: freshStock(row.stockQty, row.stockUpdatedAt, now),
      leadTimeDays: row.leadTimeDays,
      replyMs: row.business.responseTimeMedianMs,
    })),
    delisted,
    otherTrade,
  };
}
