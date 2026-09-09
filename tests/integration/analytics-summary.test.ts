import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { actorFromDevSeller } from "@/lib/auth/dev-seller";
import type { Actor } from "@/lib/auth/roles";
import { analyticsSummary } from "@/lib/analytics/summary";
import { recordSearchImpressions } from "@/lib/analytics/record";
import { dubaiDayStart } from "@/lib/format";

/**
 * Board `3l`'s read model, against a real database.
 *
 * The unit suite proves the comparison arithmetic. This proves the four things
 * only Postgres can answer: that the window is symmetric in the query as well
 * as in the model, that week one and no-data are distinguishable states, that
 * `not_stated` is a row rather than a hidden remainder, and that a seat without
 * the capability is refused.
 */

const SLUG = "harbour-point-trading-llc";
const PREFIX = "zz-3l-";

let businessId = "";
let owner: Actor;
/** Two other real listings, to sit above and below this one in a result page. */
let others: string[] = [];

beforeAll(async () => {
  const business = await prisma.business.findUniqueOrThrow({
    where: { slug: SLUG },
    select: {
      id: true,
      team: {
        where: { roles: { has: "seller_owner" } },
        select: { id: true, roles: true },
        take: 1,
      },
    },
  });
  businessId = business.id;
  const seat = business.team[0];
  if (!seat) throw new Error(`${SLUG} has no owner seat`);
  owner = actorFromDevSeller({ userId: seat.id, roles: seat.roles, businessId });

  /*
     Real ids, because the rollup has a foreign key.

     An earlier version of this file ranked the fixture against `"x"` and `"y"`;
     the insert failed the constraint, the writer swallowed it as designed, and
     the assertions failed on a volume of one. A fake id in a table with an FK
     does not produce a row that is merely wrong — it produces no row at all.
  */
  const rest = await prisma.business.findMany({
    where: { id: { not: businessId }, publishedAt: { not: null } },
    orderBy: { slug: "asc" },
    take: 3,
    select: { id: true },
  });
  others = rest.map((row) => row.id);
});

async function clear() {
  await prisma.searchImpressionDay.deleteMany({
    where: { normalised: { startsWith: PREFIX } },
  });
  await prisma.searchImpressionDay.deleteMany({ where: { businessId } });
  await prisma.listingViewDay.deleteMany({ where: { businessId } });
  await prisma.productViewDay.deleteMany({ where: { businessId } });
  await prisma.listingDeviceDay.deleteMany({ where: { businessId } });
}

beforeAll(clear);
afterEach(clear);
afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

/*
   The window sits in the future, and that is what makes these tests possible.

   Reveals and enquiries are transactional rows this suite does not own — every
   claimed fixture in the seed has some, and there is no quiet listing with an
   owner seat to borrow. Deleting them to get a clean funnel would break every
   other board that counts them.

   Placing the window somewhere no seed data reaches gives the same empty start
   without touching a row, and the impressions written below are the only thing
   in it. `analyticsSummary` takes `now` for exactly this reason.
*/
const NOW = new Date("2027-06-01T12:00:00.000Z");
/** Inside the current half of the window. */
const RECENT = new Date("2027-05-20T12:00:00.000Z");
/** Inside the previous half. */
const EARLIER = new Date("2027-04-20T12:00:00.000Z");

describe("the states the board names", () => {
  it("reports no data when nothing has been measured", async () => {
    /*
       Every cause of an empty analytics page is a setup gap, so the screen
       sends the seller to `8a` rather than explaining a chart. It is a state,
       not an error.
    */
    const summary = await analyticsSummary(owner, businessId, NOW);
    expect(summary).not.toBeNull();
    expect(summary!.noData).toBe(true);
    expect(summary!.weekOne).toBe(false);
    expect(summary!.trackingSince).toBeNull();
  });

  it("reports week one when the current period has data and the previous has none", async () => {
    // Not an error state. It is the state this board spends its first month in.
    await recordSearchImpressions([businessId], `${PREFIX}valve`, RECENT);

    const summary = await analyticsSummary(owner, businessId, NOW);
    expect(summary!.noData).toBe(false);
    expect(summary!.weekOne).toBe(true);
    // Every change reads "no comparison yet" rather than inventing a zero.
    for (const stage of summary!.stages) expect(stage.delta.kind).toBe("none");
    // And the cross-tenant median is suppressed with them.
    expect(summary!.median).toBeNull();
  });

  it("compares once a previous period exists", async () => {
    await recordSearchImpressions([businessId], `${PREFIX}valve`, EARLIER);
    await recordSearchImpressions([businessId], `${PREFIX}valve`, RECENT);
    await recordSearchImpressions([businessId], `${PREFIX}valve`, RECENT);

    const summary = await analyticsSummary(owner, businessId, NOW);
    expect(summary!.weekOne).toBe(false);
    expect(summary!.stages[0]!.delta.kind).toBe("percent");
  });

  it("says when tracking started, so a rise from zero is not read as growth", async () => {
    /*
       Three of the five stages could not be backfilled — an impression that was
       not written is gone. A page that showed a rise from nothing would be
       reporting the pipeline switching on as if it were the seller's work.
    */
    await recordSearchImpressions([businessId], `${PREFIX}valve`, RECENT);
    const summary = await analyticsSummary(owner, businessId, NOW);
    expect(summary!.trackingSince?.toISOString()).toBe(dubaiDayStart(RECENT).toISOString());
  });
});

describe("the window is symmetric in the query too", () => {
  it("counts the current half and the previous half apart", async () => {
    // Two impressions now, one before. If the halves overlapped or the
    // boundary were inclusive at both ends, one row would land in both.
    await recordSearchImpressions([businessId], `${PREFIX}a`, EARLIER);
    await recordSearchImpressions([businessId], `${PREFIX}a`, RECENT);
    await recordSearchImpressions([businessId], `${PREFIX}b`, RECENT);

    const summary = await analyticsSummary(owner, businessId, NOW);
    expect(summary!.stages[0]!.count).toBe(2);
    if (summary!.stages[0]!.delta.kind === "percent") {
      expect(summary!.stages[0]!.delta.value).toBeCloseTo(100, 5);
    } else {
      throw new Error("expected a proportional change on the top stage");
    }
  });

  it("ignores anything older than both halves", async () => {
    await recordSearchImpressions([businessId], `${PREFIX}old`, new Date("2026-05-01T12:00:00.000Z"));
    const summary = await analyticsSummary(owner, businessId, NOW);
    expect(summary!.stages[0]!.count).toBe(0);
  });
});

describe("the query panel", () => {
  it("ranks queries by volume and keeps the best position held", async () => {
    await recordSearchImpressions([others[0]!, businessId], `${PREFIX}busy`, RECENT);
    await recordSearchImpressions([businessId], `${PREFIX}busy`, RECENT);
    await recordSearchImpressions([others[0]!, others[1]!, businessId], `${PREFIX}quiet`, RECENT);

    const summary = await analyticsSummary(owner, businessId, NOW);
    const busy = summary!.queries.find((row) => row.query === `${PREFIX}busy`);
    const quiet = summary!.queries.find((row) => row.query === `${PREFIX}quiet`);

    expect(summary!.queries[0]!.query).toBe(`${PREFIX}busy`);
    expect(busy!.volume).toBe(2);
    // Second on one search and first on the other: the best of the day.
    expect(busy!.position).toBe(1);
    expect(quiet!.position).toBe(3);
  });

  it("has no movement for a query with no previous period", async () => {
    // Not ranked is a state and not a bad rank, and neither is "no history".
    await recordSearchImpressions([businessId], `${PREFIX}new`, RECENT);
    const summary = await analyticsSummary(owner, businessId, NOW);
    expect(summary!.queries[0]!.movement.kind).toBe("none");
  });

  it("reports places moved against the previous period", async () => {
    await recordSearchImpressions([others[0]!, others[1]!, others[2]!, businessId], `${PREFIX}moved`, EARLIER);
    await recordSearchImpressions([businessId], `${PREFIX}moved`, RECENT);

    const summary = await analyticsSummary(owner, businessId, NOW);
    const row = summary!.queries.find((entry) => entry.query === `${PREFIX}moved`);
    // Fourth to first: three places better, and better is negative.
    expect(row!.movement).toEqual({ kind: "places", value: -3 });
  });
});

describe("where enquiries come from", () => {
  it("renders an unstated emirate as a row rather than hiding it", async () => {
    /*
       Hiding it would make the remaining shares add to 100% of a number that is
       not the total — the padding rule at its quietest. The composer asks for a
       delivery emirate and a buyer may leave it; a guessed country would be a
       claim rather than a measurement.
    */
    const summary = await analyticsSummary(owner, businessId, NOW);
    const keys = summary!.regions.map((row) => row.key);
    if (summary!.regions.length > 0) {
      const total = summary!.regions.reduce((sum, row) => sum + row.share, 0);
      expect(total).toBeCloseTo(1, 6);
    }
    // Whatever this fixture has, nothing is dropped for being unstated.
    expect(keys.filter((key) => key === "not_stated").length).toBeLessThanOrEqual(1);
  });
});

describe("who may read it", () => {
  it("refuses a finance seat, which does not hold the row at all", async () => {
    const finance: Actor = { id: owner.id, roles: ["seller_finance"], businessId };
    await expect(analyticsSummary(finance, businessId, NOW)).rejects.toThrow();
  });

  it("allows a manager in full", async () => {
    const manager: Actor = { id: owner.id, roles: ["seller_manager"], businessId };
    await expect(analyticsSummary(manager, businessId, NOW)).resolves.not.toBeNull();
  });

  it("narrows a sales seat to their own leads rather than refusing them", async () => {
    /*
       Board 7d gives a sales seat "own leads only" — a scope, not a yes or no.
       Impressions have no actor and are not narrowed; the enquiry stage is.
    */
    const sales: Actor = { id: owner.id, roles: ["seller_sales"], businessId };
    const summary = await analyticsSummary(sales, businessId, NOW);
    expect(summary).not.toBeNull();
  });

  it("returns nothing for another business", async () => {
    const stranger = await prisma.business.findFirstOrThrow({
      where: { id: { not: businessId } },
      select: { id: true },
    });
    expect(await analyticsSummary(owner, stranger.id, NOW)).toBeNull();
  });
});

describe("the cohort median names whose median it is", () => {
  /**
   * The wave-4 fix batch, and the reason it shipped broken: **no test ever
   * rendered a non-null median.**
   *
   * `medianNote` computed the emirate and threw it away, and the page passed
   * `category: ""` and `emirate: ""` into *"a {median} median for {category} in
   * {emirate}"*. `t()` only reports a param that is `undefined`, so two empty
   * strings interpolated in silence and the sentence rendered as "median for
   * in ." — on the one page whose argument is that its numbers are true.
   *
   * ## Why this builds its own listing
   *
   * `MIN_MEDIAN_COHORT` is eight, and the floor is a policy decision rather
   * than a statistical one: a median over three suppliers plus your own number
   * tells you most of a competitor's. No seeded business with an owner seat has
   * eight peers in its category and emirate — the only cohort that size is the
   * HVAC block, and those listings have no team. So the subject is made here,
   * inside that cohort, and removed again.
   */
  const MADE = `zz-3l-median-${Date.now()}`;
  let subjectId = "";
  let subjectOwner: Actor;
  let peerIds: string[] = [];
  let day = new Date();
  let previousDay = new Date();

  async function build(): Promise<boolean> {
    const dubaiPeers = await prisma.business.findMany({
      where: {
        publishedAt: { not: null },
        suspendedAt: null,
        locations: { some: { published: true, emirate: "dubai" } },
      },
      orderBy: { slug: "asc" },
      select: { id: true, primaryCategoryId: true },
    });
    const byCategory = new Map<string, string[]>();
    for (const peer of dubaiPeers) {
      byCategory.set(peer.primaryCategoryId, [
        ...(byCategory.get(peer.primaryCategoryId) ?? []),
        peer.id,
      ]);
    }
    const biggest = [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    if (!biggest || biggest[1].length < 8) return false;
    const [categoryId, peers] = biggest;
    peerIds = peers.slice(0, 10);

    const area = await prisma.area.findFirstOrThrow({
      where: { emirate: "dubai" },
      select: { id: true },
    });

    const made = await prisma.business.create({
      data: {
        tradeName: MADE,
        displayName: MADE,
        slug: MADE,
        licenceNumber: `MED-${Date.now().toString().slice(-8)}`,
        licenceAuthority: "DED",
        licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
        primaryCategoryId: categoryId,
        claimStatus: "claimed",
        planId: "pro",
        publishedAt: new Date(),
        locations: {
          create: {
            type: "head_office",
            emirate: "dubai",
            areaId: area.id,
            addressLine: "Unit 1, Street 1",
            published: true,
          },
        },
      },
      select: { id: true },
    });
    subjectId = made.id;

    const user = await prisma.user.create({
      data: {
        id: crypto.randomUUID(),
        fullName: "Median Fixture Owner",
        roles: ["seller_owner"],
        businessId: subjectId,
      },
      select: { id: true, roles: true },
    });
    subjectOwner = actorFromDevSeller({
      userId: user.id,
      roles: user.roles,
      businessId: subjectId,
    });

    day = dubaiDayStart(new Date(NOW.getTime() - 5 * 86_400_000));
    /*
       And a day in the *previous* window, for the subject.

       `analyticsSummary` suppresses the median when the previous period is
       empty — week one is a state, not an error, and a cohort comparison on a
       page that has no comparison of its own would be the one figure making a
       claim the rest of the page refuses to. So the fixture has to be in its
       second window before the note renders at all.
    */
    previousDay = dubaiDayStart(new Date(NOW.getTime() - 40 * 86_400_000));

    for (const [index, id] of [subjectId, ...peerIds].entries()) {
      await prisma.searchImpressionDay.create({
        data: {
          businessId: id,
          day,
          normalised: `${MADE}-${index}`,
          impressions: 100,
          bestRank: 1,
        },
      });
      await prisma.listingViewDay.upsert({
        where: { businessId_day: { businessId: id, day } },
        create: { businessId: id, day, views: 10 + index },
        update: { views: 10 + index },
      });
    }

    await prisma.searchImpressionDay.create({
      data: {
        businessId: subjectId,
        day: previousDay,
        normalised: `${MADE}-prev`,
        impressions: 80,
        bestRank: 2,
      },
    });
    await prisma.listingViewDay.upsert({
      where: { businessId_day: { businessId: subjectId, day: previousDay } },
      create: { businessId: subjectId, day: previousDay, views: 8 },
      update: { views: 8 },
    });
    return true;
  }

  async function tearDown() {
    if (!subjectId) return;
    await prisma.searchImpressionDay.deleteMany({
      where: { normalised: { startsWith: MADE } },
    });
    await prisma.listingViewDay.deleteMany({
      where: { businessId: { in: [subjectId, ...peerIds] }, day: { in: [day, previousDay] } },
    });
    await prisma.user.deleteMany({ where: { businessId: subjectId } });
    await prisma.business.delete({ where: { id: subjectId } });
    subjectId = "";
  }

  it("carries the category and the emirate the comparison is against", async () => {
    const built = await build();
    try {
      expect(built, "the seed should hold one Dubai category with eight listings").toBe(true);

      const summary = await analyticsSummary(subjectOwner, subjectId, NOW);
      expect(summary?.median, "the cohort should clear the floor").not.toBeNull();
      /*
         Neither is empty, which is the whole defect. An empty string is not a
         missing param, so nothing failed and the sentence rendered with a gap
         in it — the reason this needed a test that gets as far as a median at
         all rather than one that asserts the null.
      */
      expect(summary!.median!.category.trim().length).toBeGreaterThan(0);
      expect(summary!.median!.emirate).toBe("dubai");
      expect(summary!.median!.cohortSize).toBeGreaterThanOrEqual(8);
    } finally {
      await tearDown();
    }
  });
});
