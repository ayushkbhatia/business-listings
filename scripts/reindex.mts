import { config as loadEnv } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/db/generated/client.js";
import { buildBusinessSearchText, buildProductSearchText } from "../lib/search/index-text.js";
import { resolveTemplateId } from "../lib/spec/resolve.js";

/**
 * Rebuild every match surface, for rows that predate the write path.
 *
 * `Business.searchText` arrives null on every existing row — its migration
 * deliberately ships no SQL backfill, because expanding `DN100` into `4"` means
 * the table in `lib/trade/nominal-size.ts`, and writing that a second time in
 * PL/pgSQL is the duplication this whole change exists to end.
 *
 * Products need it too. `search_text` was written only by the seed, so anything
 * created by the CSV importer carries null and anything edited in the dashboard
 * carries whatever was true before the edit.
 *
 * Idempotent, and safe to run against a live database: every write is a
 * recomputation of a derived column from rows it does not modify.
 *
 *   pnpm reindex
 *
 * Not wired into `verify` or a migration. It walks the whole table, and a
 * deploy step that does that is a deploy step that gets slower every month —
 * this is a job you run when the index definition changes, which is rare.
 */

// Same as prisma.config.ts: the Prisma CLI loads .env.local, a bare tsx script
// does not, and the two must read the same connection strings.
loadEnv({ path: [".env.local", ".env"], quiet: true });

/*
   The session pooler, not the transaction one. This walks every row in two
   tables; the app's `connection_limit=1` transaction pooler is sized for a
   request, not a migration-shaped job.
*/
const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("Missing DIRECT_URL or DATABASE_URL");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/** Template fields by category, read once per category rather than per row. */
const fieldCache = new Map<string, { id: string; label: string; unit: string | null }[]>();

async function fieldsFor(categoryId: string) {
  const cached = fieldCache.get(categoryId);
  if (cached) return cached;
  // Board 4e: the same resolver the app uses, rather than a sixth answer to
  // "which template governs this category" written in a script.
  const templateId = await resolveTemplateId(prisma, categoryId);
  const template = templateId
    ? await prisma.specTemplate.findUnique({
        where: { id: templateId },
        select: { fields: { select: { id: true, label: true, unit: true } } },
      })
    : null;
  const fields = template?.fields ?? [];
  fieldCache.set(categoryId, fields);
  return fields;
}

async function main() {
  console.log("→ products");
  const products = await prisma.product.findMany({
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

  let done = 0;
  for (const product of products) {
    await prisma.product.update({
      where: { id: product.id },
      data: {
        searchText: buildProductSearchText({
          name: product.name,
          sku: product.sku,
          description: product.description,
          categoryName: product.category.name,
          specValues: (product.specValues ?? {}) as Record<string, unknown>,
          fields: await fieldsFor(product.categoryId),
        }),
      },
    });
    done += 1;
    if (done % 200 === 0) console.log(`  ${done}/${products.length}`);
  }
  console.log(`  ${done} products indexed`);

  console.log("→ businesses");
  const businesses = await prisma.business.findMany({
    select: {
      id: true,
      displayName: true,
      tradeName: true,
      description: true,
      primaryCategory: { select: { name: true, synonyms: true } },
      categories: { select: { category: { select: { name: true, synonyms: true } } } },
      products: {
        select: {
          name: true,
          sku: true,
          description: true,
          categoryId: true,
          specValues: true,
          category: { select: { name: true } },
        },
        take: 300,
      },
    },
  });

  let indexed = 0;
  for (const business of businesses) {
    const categories = [
      business.primaryCategory,
      ...business.categories.map((link) => link.category),
    ];

    const catalogue = [];
    for (const product of business.products) {
      catalogue.push({
        name: product.name,
        sku: product.sku,
        description: product.description,
        categoryName: product.category.name,
        specValues: (product.specValues ?? {}) as Record<string, unknown>,
        fields: await fieldsFor(product.categoryId),
      });
    }

    await prisma.business.update({
      where: { id: business.id },
      data: {
        searchText: buildBusinessSearchText({
          displayName: business.displayName,
          tradeName: business.tradeName,
          description: business.description,
          categoryNames: categories.map((category) => category.name),
          synonyms: categories.flatMap((category) => category.synonyms),
          products: catalogue,
        }),
      },
    });
    indexed += 1;
    if (indexed % 50 === 0) console.log(`  ${indexed}/${businesses.length}`);
  }
  console.log(`  ${indexed} businesses indexed`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
