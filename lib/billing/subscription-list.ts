import "server-only";
import { prisma } from "@/lib/db/client";
import { effectiveCaps, type PlanCaps } from "@/lib/plan/entitlements";
import { FILS_PER_AED } from "./proration";

/**
 * Every subscription, for board 4g's list.
 *
 * The column worth having is the last one: whether this account is on the
 * plan's current numbers or on the ones it signed up with. That difference did
 * not exist until this step — the snapshot stored no caps and nothing read it —
 * and it is the difference "apply to existing" turns on.
 */

export interface SubscriptionRow {
  id: string;
  businessId: string;
  businessName: string;
  slug: string;
  planId: string;
  planName: string;
  status: string;
  monthlyFils: number;
  startedAt: Date;
  renewsAt: Date;
  endsAt: Date | null;
  dunningStage: string;
  /** Caps that differ from the plan's current ones, by field name. */
  grandfatheredFields: string[];
}

const CAP_FIELDS = [
  "enquiriesPerMonth",
  "productLimit",
  "locationLimit",
  "photoLimit",
  "teamSeats",
] as const;

export async function subscriptionList(limit = 500): Promise<SubscriptionRow[]> {
  const subscriptions = await prisma.subscription.findMany({
    orderBy: [{ startedAt: "desc" }],
    take: limit,
    select: {
      id: true,
      businessId: true,
      planId: true,
      status: true,
      startedAt: true,
      renewsAt: true,
      endsAt: true,
      dunningStage: true,
      entitlementSnapshot: true,
      business: { select: { displayName: true, slug: true } },
      plan: {
        select: {
          id: true, name: true, monthlyPriceAed: true, enquiriesPerMonth: true,
          productLimit: true, locationLimit: true, photoLimit: true, teamSeats: true,
          rankingMultiplier: true, customDomain: true, siteVisitIncluded: true, sortOrder: true,
        },
      },
    },
  });

  return subscriptions.map((subscription) => {
    const caps: PlanCaps = {
      ...subscription.plan,
      monthlyPriceAed: Number(subscription.plan.monthlyPriceAed),
      rankingMultiplier: Number(subscription.plan.rankingMultiplier),
    };
    const effective = effectiveCaps(caps, subscription.entitlementSnapshot);

    return {
      id: subscription.id,
      businessId: subscription.businessId,
      businessName: subscription.business.displayName,
      slug: subscription.business.slug,
      planId: subscription.planId,
      planName: subscription.plan.name,
      status: subscription.status,
      monthlyFils: Math.round(caps.monthlyPriceAed * FILS_PER_AED),
      startedAt: subscription.startedAt,
      renewsAt: subscription.renewsAt,
      endsAt: subscription.endsAt,
      dunningStage: subscription.dunningStage,
      grandfatheredFields: CAP_FIELDS.filter((field) => effective[field] !== caps[field]),
    };
  });
}
