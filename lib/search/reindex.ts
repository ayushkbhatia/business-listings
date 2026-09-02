import "server-only";
import type { Prisma, PrismaClient } from "@/lib/db/generated/client";
import { prisma as defaultClient } from "@/lib/db/client";
import {
  buildBusinessSearchText,
  buildProductSearchText,
  type IndexableField,
  type ProductIndexInput,
} from "./index-text";

/**
 * Keeping the match surfaces in step with the rows they describe.
 *
 * One module owns both writes because they are one write. A product's text and
 * its business's text are built from overlapping material, and a caller that
 * refreshed only the product would leave the business claiming a catalogue it
 * no longer has — which is the failure that is invisible until a buyer's search
 * quietly returns the wrong supplier.
 *
 * ## Why this is not a database trigger
 *
 * `Business.sectorId` is kept by one, and that is the right tool for copying a
 * column. This is not copying a column: it expands `4"` into `DN100` through a
 * table that lives in TypeScript and is unit-tested there. Reimplementing it in
 * PL/pgSQL would be the same table written a third time.
 *
 * ## Cost
 *
 * A product write reads that business's published catalogue — tens of rows, not
 * thousands, and only for the one business. The alternative is paying it on
 * every search, for every candidate.
 */

type Client = PrismaClient | Prisma.TransactionClient;

/** Fields for one product's template version, in the shape the index wants. */
async function fieldsFor(
  client: Client,
  categoryId: string,
): Promise<IndexableField[]> {
  const template = await client.specTemplate.findFirst({
    where: { categoryId },
    orderBy: { version: "desc" },
    select: { fields: { select: { id: true, label: true, unit: true } } },
  });
  return template?.fields ?? [];
}

/**
 * The catalogue a business is findable by.
 *
 * Drafts are included on purpose. A draft is a product the seller has told us
 * they carry; it is not published to a storefront, but "who can supply a DN100
 * butterfly valve" is a question about the supplier, and a supplier who stocks
 * one can answer it. What must never leak is the product's own row into a
 * product search — and that is `productWhere`'s job, not this one's.
 */
async function catalogueFor(client: Client, businessId: string): Promise<ProductIndexInput[]> {
  const products = await client.product.findMany({
    where: { businessId },
    select: {
      name: true,
      sku: true,
      description: true,
      categoryId: true,
      specValues: true,
      category: { select: { name: true } },
    },
    // A supplier with four thousand line items is indexed on the first few
    // hundred. The alternative is a text column nobody can store and a write
    // that walks the whole catalogue on every edit.
    take: 300,
  });

  const fieldCache = new Map<string, IndexableField[]>();
  const out: ProductIndexInput[] = [];
  for (const product of products) {
    let fields = fieldCache.get(product.categoryId);
    if (!fields) {
      fields = await fieldsFor(client, product.categoryId);
      fieldCache.set(product.categoryId, fields);
    }
    out.push({
      name: product.name,
      sku: product.sku,
      description: product.description,
      categoryName: product.category.name,
      specValues: (product.specValues ?? {}) as Record<string, unknown>,
      fields,
    });
  }
  return out;
}

/** Rebuild one business's match surface, catalogue included. */
export async function reindexBusiness(
  businessId: string,
  client: Client = defaultClient,
): Promise<void> {
  const business = await client.business.findUnique({
    where: { id: businessId },
    select: {
      displayName: true,
      tradeName: true,
      description: true,
      primaryCategory: { select: { name: true, synonyms: true } },
      categories: { select: { category: { select: { name: true, synonyms: true } } } },
    },
  });
  if (!business) return;

  const categories = [
    business.primaryCategory,
    ...business.categories.map((link: { category: { name: string; synonyms: string[] } }) => link.category),
  ];

  await client.business.update({
    where: { id: businessId },
    data: {
      searchText: buildBusinessSearchText({
        displayName: business.displayName,
        tradeName: business.tradeName,
        description: business.description,
        categoryNames: categories.map((category) => category.name),
        synonyms: categories.flatMap((category) => category.synonyms),
        products: await catalogueFor(client, businessId),
      }),
    },
  });
}

/** Rebuild one product's own surface, and its business's with it. */
export async function reindexProduct(
  productId: string,
  client: Client = defaultClient,
): Promise<void> {
  const product = await client.product.findUnique({
    where: { id: productId },
    select: {
      businessId: true,
      name: true,
      sku: true,
      description: true,
      categoryId: true,
      specValues: true,
      category: { select: { name: true } },
    },
  });
  if (!product) return;

  await client.product.update({
    where: { id: productId },
    data: {
      searchText: buildProductSearchText({
        name: product.name,
        sku: product.sku,
        description: product.description,
        categoryName: product.category.name,
        specValues: (product.specValues ?? {}) as Record<string, unknown>,
        fields: await fieldsFor(client, product.categoryId),
      }),
    },
  });

  await reindexBusiness(product.businessId, client);
}

/**
 * Every product a business owns, then the business.
 *
 * The importer's path: `createMany` cannot return ids, and reindexing a
 * thousand freshly-created rows one at a time would be a thousand round trips
 * to build text we already have the material for. One pass instead.
 */
export async function reindexBusinessCatalogue(
  businessId: string,
  client: Client = defaultClient,
): Promise<number> {
  const products = await client.product.findMany({
    where: { businessId },
    select: {
      id: true,
      name: true,
      sku: true,
      description: true,
      categoryId: true,
      specValues: true,
      category: { select: { name: true } },
    },
  });

  const fieldCache = new Map<string, IndexableField[]>();
  for (const product of products) {
    let fields = fieldCache.get(product.categoryId);
    if (!fields) {
      fields = await fieldsFor(client, product.categoryId);
      fieldCache.set(product.categoryId, fields);
    }
    await client.product.update({
      where: { id: product.id },
      data: {
        searchText: buildProductSearchText({
          name: product.name,
          sku: product.sku,
          description: product.description,
          categoryName: product.category.name,
          specValues: (product.specValues ?? {}) as Record<string, unknown>,
          fields,
        }),
      },
    });
  }

  await reindexBusiness(businessId, client);
  return products.length;
}
