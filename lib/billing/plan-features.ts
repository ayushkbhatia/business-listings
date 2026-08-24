import type { PlanCaps } from "@/lib/plan/entitlements";
import type { PlanFeature } from "@/components/domain";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * What a plan is worth saying out loud, from the plan's own columns.
 *
 * Shared by the pricing page, the plan step of onboarding and the change
 * screen, because a supplier comparing plans in two of those places and finding
 * different lists learns something true about how carefully this was built.
 *
 * A feature the plan lacks is listed and struck through rather than dropped.
 * The absence is what the next tier up is selling.
 */
export function featuresOf(plan: PlanCaps): PlanFeature[] {
  return [
    {
      label:
        plan.enquiriesPerMonth === null
          ? t("plan.enquiries_unlimited")
          : t("plan.enquiries", { n: formatCount(plan.enquiriesPerMonth) }),
      included: true,
    },
    {
      label:
        plan.productLimit === null
          ? t("plan.products_unlimited")
          : t("plan.products", { n: formatCount(plan.productLimit) }),
      included: true,
    },
    {
      label:
        plan.locationLimit === 1
          ? t("plan.location_one")
          : t("plan.locations", { n: formatCount(plan.locationLimit ?? 0) }),
      included: true,
    },
    {
      label: t("plan.photos", { n: formatCount(plan.photoLimit ?? 0) }),
      included: true,
    },
    {
      label: plan.teamSeats === 1 ? t("plan.seat_one") : t("plan.seats", { n: formatCount(plan.teamSeats) }),
      included: true,
    },
    {
      // "1.15", "1.35", and plain "1" — not "1.0". `.replace(/0$/, "")` strips
      // one trailing zero and leaves the dot behind.
      label: t("plan.ranking", {
        multiplier: plan.rankingMultiplier.toFixed(2).replace(/\.?0+$/, ""),
      }),
      included: plan.rankingMultiplier > 1,
    },
    { label: t("plan.custom_domain"), included: plan.customDomain },
    { label: t("plan.site_visit"), included: plan.siteVisitIncluded },
  ];
}

export function summaryOf(planId: string): string | undefined {
  if (planId === "free") return t("plan.summary.free");
  if (planId === "basic") return t("plan.summary.basic");
  if (planId === "pro") return t("plan.summary.pro");
  return undefined;
}

export function priceLabelOf(plan: PlanCaps): string {
  return plan.monthlyPriceAed === 0 ? t("plan.free") : `AED ${formatCount(plan.monthlyPriceAed)}`;
}
