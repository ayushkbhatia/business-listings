import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import type { Actor } from "@/lib/auth/roles";
import {
  DEFAULT_WEIGHTS,
  MAX_BOOST_DAYS,
  MAX_BOOST_POINTS,
  PLAN_TIER_CEILING,
  WEIGHT_KEYS,
  type RankingWeights,
} from "./ranking";

/**
 * Board 12c — the ranking, as something staff can change.
 *
 * `DEFAULT_WEIGHTS` has been a constant since handoff 1 and `searchBusinesses`
 * has always taken a `weights` option that no caller passed. Criterion 5 asks
 * that weights reorder live results, which they could not: there was nothing to
 * write to and nothing reading it.
 *
 * ## Boosts
 *
 * A boost is ops moving a listing for a reason of ours. It is never labelled
 * sponsored, because nobody paid for it — a sold slot is a `PlacementSlot`, is
 * one per results page, and carries a label.
 *
 * Both the reason and the expiry are NOT NULL in the database. The failure mode
 * of a manual override is not that somebody abuses it; it is that somebody
 * helps a supplier out for a fortnight and the results are still bent three
 * years later, with nobody able to say why.
 */

// Re-exported so server callers have one import. The values live in
// `ranking.ts`, which is pure — the editor is a client component and cannot
// reach anything that touches Prisma.
export { MAX_BOOST_DAYS, MAX_BOOST_POINTS, PLAN_TIER_CEILING, WEIGHT_KEYS } from "./ranking";

/**
 * The live weights.
 *
 * Falls back to the constant if the row is missing rather than throwing: a
 * search that returns nothing because a settings row was deleted is a worse
 * outcome than one ranked by the defaults.
 */
export async function liveWeights(): Promise<RankingWeights> {
  const row = await prisma.rankingWeights.findUnique({ where: { id: "current" } });
  if (!row) return DEFAULT_WEIGHTS;
  return {
    relevance: row.relevance,
    verificationTier: row.verificationTier,
    responseTime: row.responseTime,
    specCompleteness: row.specCompleteness,
    distance: row.distance,
    planTier: row.planTier,
  };
}

export type WeightsRefusal = "out_of_range" | "all_zero" | "plan_tier_too_high" | "nothing_changed";

export type WeightsResult =
  | { ok: true }
  | { ok: false; error: WeightsRefusal; message: string };

const WEIGHT_MESSAGE: Record<WeightsRefusal, string> = {
  out_of_range: "Each weight is a whole number from 0 to 100.",
  all_zero: "They cannot all be nought. Everything would rank equally, which is no ranking at all.",
  plan_tier_too_high: `Plan tier stops at ${PLAN_TIER_CEILING}. Above that the results start reading as bought, and a directory that sells its way to the top is one nobody comes back to.`,
  nothing_changed: "Those are the numbers it already has.",
};

export async function setWeights(
  actor: Actor,
  next: RankingWeights,
  reason: string,
): Promise<WeightsResult> {
  for (const key of WEIGHT_KEYS) {
    const value = next[key];
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      return { ok: false, error: "out_of_range", message: WEIGHT_MESSAGE.out_of_range };
    }
  }
  if (WEIGHT_KEYS.every((key) => next[key] === 0)) {
    return { ok: false, error: "all_zero", message: WEIGHT_MESSAGE.all_zero };
  }
  if (next.planTier > PLAN_TIER_CEILING) {
    return {
      ok: false,
      error: "plan_tier_too_high",
      message: WEIGHT_MESSAGE.plan_tier_too_high,
    };
  }

  const current = await liveWeights();
  const moved = WEIGHT_KEYS.filter((key) => current[key] !== next[key]);
  if (moved.length === 0) {
    return { ok: false, error: "nothing_changed", message: WEIGHT_MESSAGE.nothing_changed };
  }

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor,
        capability: "search.ranking.write",
        subject: "RankingWeights:current",
        reason,
        tx,
      },
      async () => {
        await tx.rankingWeights.upsert({
          where: { id: "current" },
          create: { id: "current", ...next },
          update: next,
        });
        return {
          result: null,
          before: Object.fromEntries(moved.map((key) => [key, current[key]])),
          after: Object.fromEntries(moved.map((key) => [key, next[key]])),
        };
      },
    ),
  );

  return { ok: true };
}

export type BoostRefusal = "not_found" | "points_out_of_range" | "expiry_in_the_past" | "expiry_too_far";

export type BoostResult =
  | { ok: true; id: string }
  | { ok: false; error: BoostRefusal; message: string };

const BOOST_MESSAGE: Record<BoostRefusal, string> = {
  not_found: "That listing is not here.",
  points_out_of_range: `A boost is 1 to ${MAX_BOOST_POINTS} points. More than that replaces the ranking rather than nudging it.`,
  expiry_in_the_past: "An expiry in the past is a boost that never applies.",
  expiry_too_far: `A boost runs for at most ${MAX_BOOST_DAYS} days. Renew it if it is still the right call then.`,
};

export interface BoostInput {
  actor: Actor;
  businessId: string;
  points: number;
  reason: string;
  expiresAt: Date;
}

export async function boostListing(input: BoostInput, now = new Date()): Promise<BoostResult> {
  const business = await prisma.business.findUnique({
    where: { id: input.businessId },
    select: { id: true, displayName: true },
  });
  if (!business) return { ok: false, error: "not_found", message: BOOST_MESSAGE.not_found };

  if (!Number.isInteger(input.points) || input.points < 1 || input.points > MAX_BOOST_POINTS) {
    return {
      ok: false,
      error: "points_out_of_range",
      message: BOOST_MESSAGE.points_out_of_range,
    };
  }
  if (input.expiresAt <= now) {
    return { ok: false, error: "expiry_in_the_past", message: BOOST_MESSAGE.expiry_in_the_past };
  }
  if (input.expiresAt.getTime() - now.getTime() > MAX_BOOST_DAYS * 86_400_000) {
    return { ok: false, error: "expiry_too_far", message: BOOST_MESSAGE.expiry_too_far };
  }

  const id = await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "placement.boost",
        subject: `Business:${business.id}`,
        reason: input.reason,
        tx,
      },
      async () => {
        const row = await tx.listingBoost.create({
          data: {
            businessId: business.id,
            points: input.points,
            // The same words as the audit row. A boost read from the listing
            // should not need the audit log to explain itself.
            reason: input.reason,
            expiresAt: input.expiresAt,
            createdById: input.actor.id,
          },
          select: { id: true },
        });
        return {
          result: row.id,
          before: null,
          after: { points: input.points, expiresAt: input.expiresAt.toISOString() },
        };
      },
    ),
  );

  return { ok: true, id };
}

export interface BoostView {
  id: string;
  businessId: string;
  businessName: string;
  points: number;
  reason: string;
  expiresAt: Date;
  expired: boolean;
}

/** Boosts, live ones first. Expired ones stay visible — they explain history. */
export async function boostList(now = new Date()): Promise<BoostView[]> {
  const rows = await prisma.listingBoost.findMany({
    orderBy: [{ expiresAt: "desc" }],
    take: 200,
    select: {
      id: true,
      businessId: true,
      points: true,
      reason: true,
      expiresAt: true,
      business: { select: { displayName: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    businessId: row.businessId,
    businessName: row.business.displayName,
    points: row.points,
    reason: row.reason,
    expiresAt: row.expiresAt,
    expired: row.expiresAt <= now,
  }));
}

/** Live boost points per business, for the ranking to add on. */
export async function liveBoosts(now = new Date()): Promise<Map<string, number>> {
  const rows = await prisma.listingBoost.findMany({
    where: { expiresAt: { gt: now } },
    select: { businessId: true, points: true },
  });

  const byBusiness = new Map<string, number>();
  for (const row of rows) {
    // Two live boosts on one listing add up, and the cap on each is what keeps
    // the total sane. Somebody stacking five is visible on the screen.
    byBusiness.set(row.businessId, (byBusiness.get(row.businessId) ?? 0) + row.points);
  }
  return byBusiness;
}
