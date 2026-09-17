/*
   Board `11e` — the traffic a sponsored slot is priced from.

   `/dashboard/promote` reads three things a fresh database has none of: how
   often buyers looked at a trade in an emirate, how often they clicked out of
   it, and where this seller ranked there. All three are written by real buyers
   and by the nightly run, so on a seeded directory the screen would have shown
   every slot at the floor price with "not measured yet" on every row — which is
   the honest cold state and a useless one to build against.

   So this seeds the **inputs** and then runs the real classifier over them.
   `runDemandBandsIn` is the same function the first of the month calls, on the
   seed's own client — the rule board `4f` settled after a seeded copy of a job
   drifted from the job: seed what the job reads, then run the job.
*/
import type { PrismaClient } from "../lib/db/generated/client.js";
import type { Emirate } from "../lib/db/generated/enums.js";
import { runDemandBandsIn } from "../lib/placement/demand-run.js";

type Db = PrismaClient;

const DAY = 86_400_000;

/** Enough days that a quarter's window has something in it on every scope. */
const DAYS = 75;

/**
 * How busy each seeded scope is, relative to the others.
 *
 * Not a price and not a band — a shape. The classifier cuts the bands by decile
 * over whatever it finds, so what matters here is that the scopes differ from
 * each other enough to land on different rungs, which is what makes the screen
 * worth looking at on a seeded database.
 */
const BUSY: Record<string, number> = {
  dubai: 40,
  abu_dhabi: 16,
  sharjah: 9,
  ajman: 4,
  ras_al_khaimah: 3,
  fujairah: 2,
  umm_al_quwain: 1,
};

function dayOnly(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

export async function seedPlacementDemand(db: Db, now: Date = new Date()): Promise<void> {
  console.log("→ placement demand");

  /*
     The scopes that exist are the ones with supply — a category gains an
     emirate scope only where a published business in it actually has a branch
     there. The same rule the nightly rank run follows, and for the same reason:
     eight scopes per category per night for places nobody sells in is a table
     that grows with the enum rather than with the directory.
  */
  const businesses = await db.business.findMany({
    where: { publishedAt: { not: null }, suspendedAt: null },
    select: {
      id: true,
      primaryCategoryId: true,
      categories: { select: { categoryId: true } },
      locations: { where: { published: true }, select: { emirate: true } },
    },
  });

  const scopes = new Map<string, { categoryId: string; emirate: Emirate; businessIds: string[] }>();
  for (const business of businesses) {
    const categoryIds = [
      ...new Set([business.primaryCategoryId, ...business.categories.map((row) => row.categoryId)]),
    ];
    const emirates = [...new Set(business.locations.map((location) => location.emirate))];
    for (const categoryId of categoryIds) {
      for (const emirate of emirates) {
        const key = `${categoryId}|${emirate}`;
        const existing = scopes.get(key);
        if (existing) existing.businessIds.push(business.id);
        else scopes.set(key, { categoryId, emirate, businessIds: [business.id] });
      }
    }
  }
  if (scopes.size === 0) return;

  const positions: {
    businessId: string;
    categoryId: string;
    emirate: Emirate;
    day: Date;
    position: number;
    impressions: number;
  }[] = [];
  const clicks: { categoryId: string; emirate: Emirate; day: Date; clicks: number }[] = [];
  const ranks: {
    businessId: string;
    categoryId: string;
    emirate: Emirate;
    day: Date;
    position: number;
    total: number;
  }[] = [];

  for (const scope of [...scopes.values()]) {
    const busy = BUSY[scope.emirate] ?? 1;
    const ordered = [...scope.businessIds].sort();

    for (let back = 0; back < DAYS; back += 1) {
      const day = dayOnly(new Date(now.getTime() - back * DAY));
      /*
         A weekday shape, because a flat line is the one thing real traffic
         never is — and the band is cut from a sum, so the shape costs nothing
         and makes the seeded figures read like measurements rather than like a
         constant repeated seventy-five times.
      */
      const weekday = day.getUTCDay();
      const quiet = weekday === 5 || weekday === 6 ? 0.45 : 1;
      const loads = Math.max(1, Math.round(busy * quiet));

      for (const [index, businessId] of ordered.entries()) {
        positions.push({
          businessId,
          categoryId: scope.categoryId,
          emirate: scope.emirate,
          day,
          position: index + 1,
          // Every listing on page one is counted on every load, which is what
          // makes the maximum over a scope's listings the number of loads.
          impressions: loads,
        });
        ranks.push({
          businessId,
          categoryId: scope.categoryId,
          emirate: scope.emirate,
          day,
          position: index + 1,
          total: ordered.length,
        });
      }

      // Roughly one in six buyers picks something. Whole numbers, and never
      // more clicks than loads.
      clicks.push({
        categoryId: scope.categoryId,
        emirate: scope.emirate,
        day,
        clicks: Math.min(loads, Math.round(loads / 6)),
      });
    }
  }

  await db.categoryPositionDay.createMany({ data: positions, skipDuplicates: true });
  await db.categoryRankDay.createMany({ data: ranks, skipDuplicates: true });
  await db.scopeClickDay.createMany({ data: clicks, skipDuplicates: true });

  // And then the real classifier, over what was just written.
  const result = await runDemandBandsIn(db, now);
  console.log(
    `   ${scopes.size} scopes, ${result.measured} with measured traffic, banded to ${result.measuredTo.toISOString().slice(0, 10)}`,
  );
}
