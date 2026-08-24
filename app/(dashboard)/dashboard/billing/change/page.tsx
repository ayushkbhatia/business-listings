import Link from "next/link";
import { prisma } from "@/lib/db/client";
import { featuresOf, priceLabelOf, summaryOf } from "@/lib/billing/plan-features";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../../_shell";
import { confirmPlanChange, quoteChange } from "../actions";
import { PlanChooser } from "./PlanChooser";

/**
 * Board 11f — plan change.
 *
 * The recommended plan is the middle one, and it is recommended because it is
 * the one most suppliers want rather than the one that earns most. A directory
 * whose recommendation is always its dearest tier is a directory a supplier
 * learns to read past.
 */
export const metadata = { title: "Change plan" };
export const dynamic = "force-dynamic";

const PLAN_SELECT = {
  id: true, name: true, monthlyPriceAed: true, enquiriesPerMonth: true, productLimit: true,
  locationLimit: true, photoLimit: true, teamSeats: true, rankingMultiplier: true,
  customDomain: true, siteVisitIncluded: true, sortOrder: true,
} as const;

export default async function ChangePlanPage() {
  const seat = await requireSellerSeat();

  const [plans, business, badges] = await Promise.all([
    prisma.plan.findMany({ orderBy: { sortOrder: "asc" }, select: PLAN_SELECT }),
    prisma.business.findUniqueOrThrow({
      where: { id: seat.businessId },
      select: { planId: true },
    }),
    getNavBadges(seat.businessId),
  ]);

  const currentId = business.planId ?? "free";

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/billing"
      eyebrow={t("billing.eyebrow")}
      title={t("change.title")}
      breadcrumb={
        <Link
          href="/dashboard/billing"
          className="rounded-tag text-caption text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("change.back")}
        </Link>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="max-w-prose text-body-sm text-muted">{t("change.intro")}</p>

        <PlanChooser
          quoteAction={quoteChange}
          confirmAction={confirmPlanChange}
          plans={plans.map((plan) => ({
            id: plan.id,
            name: plan.name,
            monthlyPriceAed: plan.monthlyPriceAed,
            priceLabel: priceLabelOf(plan),
            ...(summaryOf(plan.id) ? { summary: summaryOf(plan.id)! } : {}),
            features: featuresOf(plan),
            // The middle tier, not the dearest.
            recommended: plan.id === "basic" && currentId !== "basic",
            current: plan.id === currentId,
          }))}
        />
      </div>
    </SellerPage>
  );
}
