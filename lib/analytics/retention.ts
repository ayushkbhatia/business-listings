import "server-only";
import { prisma } from "@/lib/db/client";
import { dubaiDayStart } from "@/lib/format";

/**
 * Board `3l` — how long the rollups are kept.
 *
 * **90 days**, which is spec Q4 and the smallest window that supports what the
 * page promises. The screen compares 30 days against the 30 before, so 60 is
 * the floor for the comparison to exist at all; 90 leaves a month of margin and
 * makes a quarter view possible later without a second retention decision.
 *
 * These four tables grow with *traffic* rather than with sign-ups, which is the
 * property that decides whether something needs a prune. `search_impression_day`
 * is the one to watch: its grain is a business, a day and a distinct query, so
 * it grows with the variety of what buyers type rather than with how often they
 * type it.
 *
 * Not a security parameter, unlike `auth_attempt` — nothing here identifies a
 * person. `SearchImpressionDay` holds a phrase and a rank with no actor, and
 * `ListingDeviceDay` holds one of three words. The cutoff is how far back a
 * seller's screen can look, and nothing more.
 */

/** Spec Q4. Sixty is the floor for a 30-day comparison; this is that plus margin. */
export const KEEP_DAYS = 90;

export interface AnalyticsPruneResult {
  searchImpressions: number;
  categoryPositions: number;
  productViews: number;
  devices: number;
  /** The day at and before which rows were removed. */
  olderThan: Date;
  ranAt: Date;
}

export async function pruneAnalytics(
  now: Date = new Date(),
  keepDays: number = KEEP_DAYS,
): Promise<AnalyticsPruneResult> {
  /*
     The cutoff is a *day*, not an instant.

     Every one of these tables is keyed by a `date` column holding midnight in
     Dubai. Comparing it against `now - 90 days` would cut mid-day and take part
     of the ninetieth day with it, which is a rounding error nobody would notice
     and an off-by-one in the one place a seller counts days.
  */
  const olderThan = dubaiDayStart(new Date(now.getTime() - keepDays * 86_400_000));
  const where = { day: { lt: olderThan } };

  const [searchImpressions, categoryPositions, productViews, devices] = await Promise.all([
    prisma.searchImpressionDay.deleteMany({ where }),
    prisma.categoryPositionDay.deleteMany({ where }),
    prisma.productViewDay.deleteMany({ where }),
    prisma.listingDeviceDay.deleteMany({ where }),
  ]);

  return {
    searchImpressions: searchImpressions.count,
    categoryPositions: categoryPositions.count,
    productViews: productViews.count,
    devices: devices.count,
    olderThan,
    ranAt: now,
  };
}
