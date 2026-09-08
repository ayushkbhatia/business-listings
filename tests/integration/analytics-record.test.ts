import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  normaliseQuery,
  recordCategoryPositions,
  recordListingDevice,
  recordProductView,
  recordSearchImpressions,
} from "@/lib/analytics/record";

/**
 * Board `3l`'s writers, against a real Postgres.
 *
 * Two of the four are raw `INSERT … ON CONFLICT`, one of them targeting a
 * **partial** unique index — which is exactly the kind of statement that
 * typechecks, reads correctly and fails at runtime. The `unnest … WITH
 * ORDINALITY` that turns a page of results into ranks is the same shape of
 * risk. Nothing here can be proved without a database.
 */

const DAY = new Date("2026-09-08T06:00:00.000Z");
/** Midnight in Dubai for that instant, which is what a `date` column holds. */
const STORED_DAY = new Date("2026-09-08T00:00:00.000Z");

let ids: string[] = [];
let categoryId = "";
let productId = "";

beforeAll(async () => {
  const businesses = await prisma.business.findMany({
    where: { publishedAt: { not: null }, suspendedAt: null },
    orderBy: { slug: "asc" },
    take: 3,
    select: { id: true, primaryCategoryId: true },
  });
  ids = businesses.map((business) => business.id);
  categoryId = businesses[0]!.primaryCategoryId;

  const product = await prisma.product.findFirstOrThrow({
    where: {
      status: { not: "draft" },
      business: { publishedAt: { not: null }, suspendedAt: null },
    },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  productId = product.id;
});

async function clear() {
  await prisma.searchImpressionDay.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.categoryPositionDay.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.productViewDay.deleteMany({ where: { productId } });
  await prisma.listingDeviceDay.deleteMany({ where: { businessId: { in: ids } } });
}

beforeAll(clear);
afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe("search impressions", () => {
  it("writes one row per result, ranked in the order the buyer saw them", async () => {
    await recordSearchImpressions(ids, "Grooved   Butterfly Valve", DAY);

    const rows = await prisma.searchImpressionDay.findMany({
      where: { businessId: { in: ids } },
      orderBy: { bestRank: "asc" },
    });

    expect(rows).toHaveLength(3);
    // One-based, because a rank is a position in a list. The table has a check
    // constraint saying so, and a zero would read as better than first.
    expect(rows.map((row) => row.bestRank)).toEqual([1, 2, 3]);
    expect(rows.map((row) => row.businessId)).toEqual(ids);
    // Normalised the same way `SearchQueryLog` groups, or the two tables would
    // count one phrase as two.
    expect(rows[0]!.normalised).toBe("grooved butterfly valve");
    expect(rows[0]!.day.toISOString()).toBe(STORED_DAY.toISOString());
  });

  it("increments rather than duplicating, and keeps the best rank of the day", async () => {
    /*
       `bestRank` is the lowest the listing held that day, not the latest. A
       seller who was second in the morning and fortieth after a competitor's
       edit has a real story; taking the last value would make the number depend
       on when a buyer happened to search.
    */
    await recordSearchImpressions(ids, "grooved butterfly valve", DAY);
    await recordSearchImpressions([...ids].reverse(), "grooved butterfly valve", DAY);

    const rows = await prisma.searchImpressionDay.findMany({
      where: { businessId: { in: ids }, normalised: "grooved butterfly valve" },
    });
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.impressions).toBe(3);

    // The one that was third and then first keeps 1.
    const last = rows.find((row) => row.businessId === ids[2]);
    expect(last!.bestRank).toBe(1);
  });

  it("counts nothing for a browse with no query", async () => {
    // A browse has no phrase to attribute a position to. It is a category
    // impression, and `recordCategoryPositions` is what takes it.
    await clear();
    await recordSearchImpressions(ids, "   ", DAY);
    expect(await prisma.searchImpressionDay.count({ where: { businessId: { in: ids } } })).toBe(0);
  });
});

describe("category positions", () => {
  it("upserts through the country-wide partial index", async () => {
    /*
       The statement this test exists for. `emirate` is null for a country-wide
       browse, a null never equals a null in SQL, and the identity is therefore
       a partial unique index that `ON CONFLICT` has to name by predicate. Get it
       wrong and every browse inserts a new row for ever.
    */
    await clear();
    await recordCategoryPositions(ids, categoryId, null, DAY);
    await recordCategoryPositions(ids, categoryId, null, DAY);

    const rows = await prisma.categoryPositionDay.findMany({
      where: { businessId: { in: ids }, emirate: null },
    });
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.impressions).toBe(2);
  });

  it("keeps an emirate browse apart from a country-wide one", async () => {
    await clear();
    await recordCategoryPositions(ids, categoryId, null, DAY);
    await recordCategoryPositions(ids, categoryId, "dubai", DAY);

    const all = await prisma.categoryPositionDay.findMany({ where: { businessId: { in: ids } } });
    expect(all).toHaveLength(6);
    expect(all.filter((row) => row.emirate === null)).toHaveLength(3);
    expect(all.filter((row) => row.emirate === "dubai")).toHaveLength(3);
  });

  it("upserts through the in-emirate partial index too", async () => {
    await clear();
    await recordCategoryPositions(ids, categoryId, "dubai", DAY);
    await recordCategoryPositions([...ids].reverse(), categoryId, "dubai", DAY);

    const rows = await prisma.categoryPositionDay.findMany({
      where: { businessId: { in: ids }, emirate: "dubai" },
    });
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.impressions).toBe(2);
    expect(rows.find((row) => row.businessId === ids[2])!.position).toBe(1);
  });
});

describe("product views", () => {
  it("counts a view and reads the business off the product", async () => {
    // The beacon is public, so the payload decides nothing about identity.
    await clear();
    await recordProductView(productId, DAY);
    await recordProductView(productId, DAY);

    const row = await prisma.productViewDay.findUniqueOrThrow({
      where: { productId_day: { productId, day: STORED_DAY } },
      select: { views: true, businessId: true },
    });
    expect(row.views).toBe(2);
    expect(row.businessId).not.toBe("");
  });

  it("counts nothing for a product nobody can see", async () => {
    await clear();
    const draft = await prisma.product.findFirst({
      where: { status: "draft" },
      select: { id: true },
    });
    if (!draft) return;

    await recordProductView(draft.id, DAY);
    expect(await prisma.productViewDay.count({ where: { productId: draft.id } })).toBe(0);
  });

  it("counts nothing for an id that is not a product", async () => {
    await recordProductView("not-a-product", DAY);
    expect(await prisma.productViewDay.count({ where: { productId: "not-a-product" } })).toBe(0);
  });
});

describe("device split", () => {
  it("counts per bucket, on the day the supplier had", async () => {
    await clear();
    await recordListingDevice(ids[0]!, "mobile", DAY);
    await recordListingDevice(ids[0]!, "mobile", DAY);
    await recordListingDevice(ids[0]!, "desktop", DAY);

    /*
       Ordered by the enum, which in Postgres means **declaration order** and not
       alphabetical — `device_kind` is declared mobile, desktop, tablet. Worth
       asserting rather than sorting around: any screen that reads this ordered
       gets the same sequence, and it is the one the panel renders in.
    */
    const rows = await prisma.listingDeviceDay.findMany({
      where: { businessId: ids[0]! },
      orderBy: { device: "asc" },
    });
    expect(rows.map((row) => [row.device, row.views])).toEqual([
      ["mobile", 2],
      ["desktop", 1],
    ]);
  });
});

describe("normaliseQuery", () => {
  it("matches what SearchQueryLog groups on", () => {
    expect(normaliseQuery("  SKF   Bearing  ")).toBe("skf bearing");
    expect(normaliseQuery("")).toBe("");
  });

  it("caps the length, because a query is a URL parameter", () => {
    expect(normaliseQuery("a".repeat(400))).toHaveLength(200);
  });
});
