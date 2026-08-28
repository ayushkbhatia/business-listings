import type { PrismaClient } from "../lib/db/generated/client.js";

/**
 * File a share of each sector's listings under one of its subcategories.
 *
 * Handoff 5, step 2. Board 10a is 418 subcategory pages and the seed had every
 * one of them empty: businesses were filed against the six sectors and never
 * against the four children, so the whole template — emirate breakdown, spec
 * chips, FAQ — rendered blank on every one of them and nothing about the step
 * was demonstrable.
 *
 * Deterministic and PRNG-free on purpose. `prisma/seed.mts` warns that the
 * random draw is a sequence and removing or adding one renames every business
 * generated after it, which has already cost a dozen tests their fixtures. This
 * runs afterwards and picks by position, so it moves listings without moving a
 * single slug.
 *
 * `Business.sectorId` is kept by a database trigger on `primaryCategoryId`, so
 * re-filing a listing keeps its sector right with no second write — which is
 * why that trigger replaced the application code in handoff 4.
 */

/** One in this many listings moves down to a subcategory. */
const SHARE = 2;

export async function seedSubcategories(db: PrismaClient) {
  const sectors = await db.category.findMany({
    where: { parentId: null },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      slug: true,
      children: { orderBy: { sortOrder: "asc" }, select: { id: true, slug: true } },
    },
  });

  let moved = 0;

  for (const sector of sectors) {
    if (sector.children.length === 0) continue;

    const businesses = await db.business.findMany({
      where: { primaryCategoryId: sector.id },
      orderBy: { slug: "asc" },
      select: { id: true },
    });

    for (const [index, business] of businesses.entries()) {
      if (index % SHARE !== 0) continue;
      const child = sector.children[Math.floor(index / SHARE) % sector.children.length]!;

      // The catalogue moves with the listing. Spec chips read products by
      // category, so a supplier filed under gate valves whose products were
      // still filed under the sector would render a page with no filters on it.
      await db.$transaction([
        db.business.update({
          where: { id: business.id },
          data: { primaryCategoryId: child.id },
        }),
        db.product.updateMany({
          where: { businessId: business.id, categoryId: sector.id },
          data: { categoryId: child.id },
        }),
      ]);
      moved += 1;
    }
  }

  const counts = await db.category.findMany({
    where: { parentId: { not: null } },
    orderBy: { sortOrder: "asc" },
    select: { slug: true, _count: { select: { primaryFor: true } } },
  });

  console.log(`   ${moved} listings filed under a subcategory`);
  for (const row of counts) {
    console.log(`   ${String(row._count.primaryFor).padStart(3)}  ${row.slug}`);
  }
}
