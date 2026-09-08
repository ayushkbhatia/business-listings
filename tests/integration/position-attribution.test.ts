import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { runPositionSnapshots } from "@/lib/analytics/snapshot-job";
import { positionCard } from "@/lib/analytics/position";
import { pruneAnalytics } from "@/lib/analytics/retention";
import { dubaiDayStart } from "@/lib/format";
import { DEFAULT_WEIGHTS } from "@/lib/search/ranking";

/**
 * The `3a`/`3l` amendment, against a real database.
 *
 * The parts a unit test cannot reach are all here: whether the nightly job is
 * idempotent by day, whether the two partial unique indexes actually hold when
 * `emirate` is null, whether the card reads what the job wrote, and whether the
 * three absences stay three.
 *
 * Create-and-destroy fixtures. `billing.test.ts` learned this the hard way and
 * `domains.test.ts` broke `account.spec.ts` at a distance by borrowing a seeded
 * seller — this suite writes ranks for every published listing in the database,
 * so it must not also mutate one.
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** A listing that replies in four hours: the top of `scoreResponseTime`. */
const RAW_FAST = {
  relevance: 1,
  verificationTier: 2,
  responseTimeMedianMs: 4 * HOUR,
  specCompleteness: 0.74,
  distanceKm: null,
  planMultiplier: 1.35,
};
const SCORES_FAST = {
  relevance: 1,
  verificationTier: 1,
  responseTime: 1,
  specCompleteness: 0.74,
  distance: 0.5,
  planTier: 1,
};

/** The same listing, now replying in thirty-one hours. */
const RAW_SLOW = { ...RAW_FAST, responseTimeMedianMs: 31 * HOUR };
const SCORES_SLOW = { ...SCORES_FAST, responseTime: 0.2 };

const madeBusinesses: string[] = [];
let categoryId = "";

beforeAll(async () => {
  const category = await prisma.category.findFirstOrThrow({ select: { id: true } });
  categoryId = category.id;

  /*
     Both tables, emptied first.

     Not a shared fixture being eaten: nothing else in the platform reads or
     writes `category_rank_day` or `listing_factor_day`, and the nightly job is
     the only writer. This suite writes several nights of them, so without this
     its second run sees the first run's history and "week one" stops being week
     one — which is exactly the failure that has bitten this repo repeatedly,
     found here on the second `vitest run` rather than in CI a week later.

     It does take the seed's nightly ranks with it, which board 3a's e2e card
     assertion reads. In CI that is harmless — `verify` and `acceptance` are
     separate jobs against separate databases. Locally, reseed between the two.
  */
  await prisma.categoryRankDay.deleteMany({});
  await prisma.listingFactorDay.deleteMany({});
});

afterAll(async () => {
  if (madeBusinesses.length > 0) {
    await prisma.business.deleteMany({ where: { id: { in: madeBusinesses } } });
  }
});

describe("the nightly snapshot", () => {
  it("writes a rank and a denominator for every published listing in a category", async () => {
    const now = new Date();
    const result = await runPositionSnapshots(now);

    expect(result.listings).toBeGreaterThan(0);
    expect(result.scopes).toBeGreaterThan(0);
    expect(result.ranks).toBeGreaterThan(0);
    // The cap is a backstop against a bulk import, not a page size. It has
    // never bitten, and the field says so out loud rather than truncating in
    // silence.
    expect(result.skipped).toEqual([]);

    const rows = await prisma.categoryRankDay.findMany({
      where: { day: dubaiDayStart(now), categoryId, emirate: null },
      orderBy: { position: "asc" },
      select: { position: true, total: true },
    });

    expect(rows.length).toBeGreaterThan(0);
    // One-based, contiguous, and every row carries the same denominator: the
    // size of the set it was ranked in. `#7 of 5` is not a near miss, it is a
    // job that ranked one set and counted another.
    expect(rows.map((row) => row.position)).toEqual(rows.map((_row, index) => index + 1));
    expect(new Set(rows.map((row) => row.total))).toEqual(new Set([rows.length]));
  });

  it("is idempotent by day, so a re-run after a failed night corrects rather than duplicates", async () => {
    /*
       The invariant the two partial unique indexes exist for. A plain unique
       index would accept a second country-wide row for the same listing on the
       same day, because in SQL a null never equals a null — and the second run
       would then double every country-wide scope in the table for ever.
    */
    const now = new Date();
    const day = dubaiDayStart(now);

    const first = await runPositionSnapshots(now);
    const afterOne = await prisma.categoryRankDay.count({ where: { day } });

    const second = await runPositionSnapshots(now);
    const afterTwo = await prisma.categoryRankDay.count({ where: { day } });

    expect(second.ranks).toBe(first.ranks);
    // The row count, not the reported count. A job can report the same number
    // twice while inserting twice, which is exactly what a plain unique index
    // over a nullable emirate would have allowed.
    expect(afterTwo).toBe(afterOne);
    expect(await prisma.listingFactorDay.count({ where: { day } })).toBe(first.listings);
  });

  it("stores the weights in force, which is what tells a staff change from a seller's", async () => {
    const now = new Date();
    await runPositionSnapshots(now);

    const row = await prisma.listingFactorDay.findFirstOrThrow({
      where: { day: dubaiDayStart(now) },
      select: { scores: true, weights: true, raw: true },
    });

    // Every one of the six, or attribution cannot name which moved.
    for (const key of Object.keys(DEFAULT_WEIGHTS)) {
      expect(row.scores).toHaveProperty(key);
      expect(row.weights).toHaveProperty(key);
    }
    expect(row.raw).toHaveProperty("responseTimeMedianMs");
  });
});

describe("the card", () => {
  it("reads the rank the job wrote, with its denominator", async () => {
    const now = new Date();
    await runPositionSnapshots(now);

    const ranked = await prisma.categoryRankDay.findFirstOrThrow({
      where: { day: dubaiDayStart(now) },
      select: { businessId: true },
    });

    const card = await positionCard(ranked.businessId, now);

    expect(card.rows.length).toBeGreaterThan(0);
    // Never padded past what the seller actually ranks in, and never more than
    // the overview's three — the full list belongs on analytics.
    expect(card.rows.length).toBeLessThanOrEqual(3);

    const first = card.rows[0]!;
    expect(first.state).toBe("ranked");
    expect(first.rank).toBeGreaterThanOrEqual(1);
    expect(first.total).toBeGreaterThanOrEqual(first.rank!);
    // Week one. One snapshot is a rank with no history, which is an absence of
    // comparison and never a movement of zero.
    expect(first.movement.kind).toBe("none");
    expect(first.reason.kind).toBe("none");
  });

  it("carries a movement and a reason once there are two nights to compare", async () => {
    /*
       The whole chain, end to end: the job writes two nights, the seller's own
       measurement moves between them, and the card names it.

       This is the test the amendment exists for. Everything else here checks a
       row landed; this checks that the sentence a seller reads is the one the
       arithmetic produced, over data that went through Postgres on the way.
    */
    const now = new Date();
    const earlier = new Date(now.getTime() - 10 * DAY);

    await runPositionSnapshots(earlier);
    await runPositionSnapshots(now);

    /*
       The scope the *card* chose, not the first row in the table.

       Which emirate a category renders at is a decision `positionCard` makes —
       what buyers browsed, else the seller's own single emirate, else the
       country-wide listing — so a fixture written against an arbitrary row can
       land on a scope the card will never show. Ask the card first.
    */
    const anyRow = await prisma.categoryRankDay.findFirstOrThrow({
      where: { day: dubaiDayStart(now) },
      select: { businessId: true },
    });
    const shown = (await positionCard(anyRow.businessId, now)).rows[0]!;
    const target = {
      businessId: anyRow.businessId,
      categoryId: shown.categoryId,
      emirate: shown.emirate,
    };

    /*
       A fall the seller caused, written into the earlier night rather than
       simulated in the assertion. `scoreRow` normalises a four-hour median to 1
       and a thirty-one-hour one to roughly 0.2, so this is that listing having
       been fast and become slow.
    */
    await prisma.listingFactorDay.update({
      where: { businessId_day: { businessId: target.businessId, day: dubaiDayStart(earlier) } },
      data: { raw: { ...RAW_FAST }, scores: { ...SCORES_FAST } },
    });
    await prisma.listingFactorDay.update({
      where: { businessId_day: { businessId: target.businessId, day: dubaiDayStart(now) } },
      data: { raw: { ...RAW_SLOW }, scores: { ...SCORES_SLOW } },
    });
    // A fall in the ranking to go with it, so there is a movement to explain.
    await prisma.categoryRankDay.updateMany({
      where: { ...target, day: dubaiDayStart(now) },
      data: { position: 9, total: 40 },
    });
    await prisma.categoryRankDay.updateMany({
      where: { ...target, day: dubaiDayStart(earlier) },
      data: { position: 3, total: 40 },
    });

    const card = await positionCard(target.businessId, now);
    const row = card.rows.find(
      (candidate) =>
        candidate.categoryId === target.categoryId && candidate.emirate === target.emirate,
    );

    expect(row).toBeDefined();
    expect(row!.rank).toBe(9);
    expect(row!.total).toBe(40);
    expect(row!.movement).toEqual({ kind: "places", value: 6 });
    expect(row!.reason.kind).toBe("seller");
    if (row!.reason.kind !== "seller") return;
    expect(row!.reason.factor).toBe("responseTime");
    expect(row!.reason.direction).toBe("down");
    expect(row!.reason.places).toBe(6);
  });

  it("says `not measured` for a listing the job has never ranked", async () => {
    /*
       State 06, and the reason it cannot share a rendering with state 05: this
       listing is not absent from the results, we simply have not looked. The
       card must say which.
    */
    const business = await makeUnpublishedListing();
    const card = await positionCard(business, new Date());

    expect(card.rows).toHaveLength(1);
    expect(card.rows[0]!.state).toBe("not_measured");
    expect(card.rows[0]!.rank).toBeNull();
  });
});

describe("retention", () => {
  it("prunes both new tables, which grow on a directory with no visitors at all", async () => {
    const business = await makeUnpublishedListing();
    const old = dubaiDayStart(new Date(Date.now() - 200 * DAY));

    await prisma.categoryRankDay.create({
      data: { businessId: business, categoryId, emirate: null, day: old, position: 1, total: 1 },
    });
    await prisma.listingFactorDay.create({
      data: {
        businessId: business,
        day: old,
        scores: {},
        raw: {},
        weights: {},
        boostPoints: 0,
      },
    });

    const pruned = await pruneAnalytics();

    expect(pruned.categoryRanks).toBeGreaterThan(0);
    expect(pruned.factorDays).toBeGreaterThan(0);
    expect(
      await prisma.categoryRankDay.count({ where: { businessId: business, day: old } }),
    ).toBe(0);
  });
});

/** A listing of this suite's own, never a seeded one. */
async function makeUnpublishedListing(): Promise<string> {
  const slug = `position-test-${madeBusinesses.length}-${process.pid}`;
  const business = await prisma.business.create({
    data: {
      slug,
      displayName: "Position fixture",
      tradeName: "Position fixture",
      licenceNumber: `POS-${slug}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date("2027-12-31T00:00:00Z"),
      primaryCategoryId: categoryId,
      // Deliberately not published: the snapshot ranks the public set, so this
      // listing is one the job will never have written a row for.
      publishedAt: null,
    },
    select: { id: true },
  });
  madeBusinesses.push(business.id);
  return business.id;
}
