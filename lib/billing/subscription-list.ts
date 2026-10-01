import "server-only";
import { prisma } from "@/lib/db/client";
import { keptFields, PLAN_CAPS_SELECT, toCaps, type FrozenCap } from "@/lib/plan/entitlements";
import { monthlyValueFils } from "./period";
import { COUNTS_AS_MRR } from "./revenue";

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
  planName: string;
  status: string;
  /**
   * What the account is worth a month — not what it pays in one go.
   *
   * An annual subscription pays ten months for twelve, so this is ten twelfths
   * of the list price. It is the same figure `mrrNow` sums, which is what lets
   * a reader add this column up and get the number on the revenue screen.
   *
   * Zero for a status `mrrNow` does not count. A trial is worth nothing a month
   * — it writes no MRR movement for that reason — and an expired or cancelled
   * subscription has stopped paying. Printing the plan's price on those rows
   * made the column add up to more than the revenue screen by every trial on
   * the list.
   */
  monthlyFils: number;
  /** Monthly or annual. The column beside `monthlyFils` that explains it. */
  term: "monthly" | "annual";
  startedAt: Date;
  renewsAt: Date;
  endsAt: Date | null;
  dunningStage: string;
  /**
   * Caps that differ from the plan's current ones, by field name.
   *
   * Every field the snapshot freezes, from `keptFields`. This compared its own
   * list of six — storage was added late, and services, categories and the four
   * switches never were — so an account grandfathered on any of those six read
   * "on the plan".
   */
  grandfatheredFields: FrozenCap[];
}

export interface SubscriptionList {
  /** The newest `limit`, for the table. */
  rows: SubscriptionRow[];
  /**
   * Every subscription, counted. Not `rows.length`: the table stops at `limit`
   * and the header that said "500 subscriptions" at 501 was a count of the
   * page, not of the subscriptions.
   */
  total: number;
  /** Every subscription on old numbers, across all of them, not the page. */
  grandfathered: number;
}

const COUNTED = new Set<string>(COUNTS_AS_MRR);

export async function subscriptionList(limit = 500): Promise<SubscriptionList> {
  const [subscriptions, total, everySnapshot] = await Promise.all([
    prisma.subscription.findMany({
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: limit,
      select: {
        id: true,
        businessId: true,
        status: true,
        term: true,
        startedAt: true,
        renewsAt: true,
        endsAt: true,
        dunningStage: true,
        entitlementSnapshot: true,
        business: { select: { displayName: true } },
        plan: { select: { ...PLAN_CAPS_SELECT, annualMonthsCharged: true } },
      },
    }),
    prisma.subscription.count(),
    /*
       Every snapshot, for the one figure the header states about all of them.
       Two columns, against plans read once — not the page's whole row a few
       thousand times over.
    */
    prisma.subscription.findMany({ select: { planId: true, entitlementSnapshot: true } }),
  ]);

  const plans = new Map(
    (await prisma.plan.findMany({ select: PLAN_CAPS_SELECT })).map((plan) => [plan.id, plan]),
  );
  const grandfathered = everySnapshot.filter((subscription) => {
    const plan = plans.get(subscription.planId);
    return plan !== undefined && keptFields(toCaps(plan), subscription.entitlementSnapshot).length > 0;
  }).length;

  const rows = subscriptions.map((subscription) => ({
    id: subscription.id,
    businessId: subscription.businessId,
    businessName: subscription.business.displayName,
    planName: subscription.plan.name,
    status: subscription.status,
    monthlyFils: COUNTED.has(subscription.status)
      ? monthlyValueFils(
          // `PlanCaps` is entitlements; the annual price is not one of them, so
          // it comes off the row rather than out of the caps.
          {
            monthlyPriceAed: Number(subscription.plan.monthlyPriceAed),
            annualMonthsCharged: subscription.plan.annualMonthsCharged,
          },
          subscription.term,
        )
      : 0,
    term: subscription.term,
    startedAt: subscription.startedAt,
    renewsAt: subscription.renewsAt,
    endsAt: subscription.endsAt,
    dunningStage: subscription.dunningStage,
    grandfatheredFields: keptFields(toCaps(subscription.plan), subscription.entitlementSnapshot),
  }));

  return { rows, total, grandfathered };
}
