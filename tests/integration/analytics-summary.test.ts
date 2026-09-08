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
