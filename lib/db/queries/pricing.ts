import "server-only";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db/client";
import { liveWeights } from "@/lib/search/settings";
import type { PricingPlan } from "@/lib/billing/pricing";

/**
 * Board 1l's reads. Two of them, both an hour.
 *
 * The spec's data table asks for an hour on every row of this page, and the
 * reason is not load: it is that a price a supplier read this morning should
 * still be the price this afternoon. An hour is the window inside which the
 * page, the home band and the plan step cannot disagree with each other.
 *
 * `/pricing` reads the session — a signed-in seller has to see their own plan
 * marked — which opts the route out of static rendering and makes a page-level
 * `revalidate` inert. Same arrangement as the home page: the route is dynamic
 * and the data is cached, so a hit costs no query and only the session lookup
 * is per-request.
 */

/**
 * Cleared when somebody edits a plan.
 *
 * Before this existed, `/admin/plans` revalidated two admin paths and nothing
 * else, so the home page's plan band — cached for an hour under the home tag —
 * kept quoting the old price for up to an hour after an edit. Criterion 2 says
 * the figures on `1a` and `1l` are identical for the same plan, and two caches
 * with different lifetimes and one invalidator is exactly how that stops being
 * true. Both reads carry this tag now.
 */
export const PLAN_CACHE_TAG = "plans";

/** Cleared when staff move the ranking weights. See `/admin/search`. */
export const RANKING_CACHE_TAG = "ranking-weights";

const HOUR_S = 3600;

const PRICING_PLAN_SELECT = {
  id: true,
  name: true,
  monthlyPriceAed: true,
  enquiriesPerMonth: true,
  productLimit: true,
  locationLimit: true,
  photoLimit: true,
  categoryLimit: true, storageMb: true,
  teamSeats: true,
  rankingMultiplier: true,
  customDomain: true,
  analytics: true,
  csvImport: true,
  sponsoredEligible: true,
  sortOrder: true,
  withdrawnAt: true,
  // What a year costs, in months. Null where the plan is monthly-only.
  annualMonthsCharged: true,
} as const;

/**
 * Every plan, withdrawn ones included.
 *
 * The filtering is the caller's, deliberately: `/pricing` shows what can be
 * started today, while a screen that explains somebody's existing subscription
 * has to be able to name a plan nobody can start any more. Dropping the row in
 * the query would make the second impossible.
 */
export async function readPricingPlans(): Promise<PricingPlan[]> {
  return prisma.plan.findMany({
    orderBy: { sortOrder: "asc" },
    select: PRICING_PLAN_SELECT,
  });
}

/** The weights the search actually ranks by, not the constant behind them. */
export async function readRankingWeights() {
  return liveWeights();
}

/**
 * Which plan this reader is already on, if they have a listing at all.
 *
 * Uncached and per-request: it is about one account, and caching it under a
 * shared key is how one seller's plan ends up marked on another seller's page.
 *
 * `null` from `planId` means Free. The column is nullable because the imported
 * licence records have never chosen anything, and a business that has not
 * chosen is on the free plan by definition rather than on no plan.
 */
export async function readViewerPlanId(businessId: string): Promise<string | null> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { planId: true },
  });
  if (!business) return null;
  return business.planId ?? "free";
}

export const getPricingPlans = unstable_cache(readPricingPlans, ["pricing-plans"], {
  revalidate: HOUR_S,
  tags: [PLAN_CACHE_TAG],
});

export const getRankingWeights = unstable_cache(readRankingWeights, ["pricing-weights"], {
  revalidate: HOUR_S,
  tags: [RANKING_CACHE_TAG],
});
