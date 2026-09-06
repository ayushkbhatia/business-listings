import Link from "next/link";
import { prisma } from "@/lib/db/client";
import { annualPriceLabelOf, featuresOf, priceLabelOf, summaryOf } from "@/lib/billing/plan-features";
import { recommendedPlanId } from "@/lib/billing/pricing";
import { offersAnnual } from "@/lib/billing/period";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../../_shell";
import { confirmPlanChange, confirmTermChange, quoteChange, quoteTerm } from "../actions";
import { PlanChooser } from "./PlanChooser";

/**
 * Board 11f — plan change.
 *
 * The recommended plan is the middle one, and it is recommended because it is
 * the one most suppliers want rather than the one that earns most. A directory
 * whose recommendation is always its dearest tier is a directory a supplier
 * learns to read past.
 */
export const metadata = { title: t("change.title") };
export const dynamic = "force-dynamic";

const PLAN_SELECT = {
  id: true, name: true, monthlyPriceAed: true, enquiriesPerMonth: true, productLimit: true,
  locationLimit: true, photoLimit: true, teamSeats: true, rankingMultiplier: true,
  customDomain: true, sortOrder: true,
  // What a year costs, so a card can state the term the seller is actually on.
  annualMonthsCharged: true,
} as const;

export default async function ChangePlanPage() {
  const seat = await requireSellerSeat();

  const [plans, business, badges] = await Promise.all([
    prisma.plan.findMany({ orderBy: { sortOrder: "asc" }, select: PLAN_SELECT }),
    prisma.business.findUniqueOrThrow({
      where: { id: seat.businessId },
      select: {
        planId: true,
        plan: { select: { monthlyPriceAed: true, annualMonthsCharged: true } },
        subscription: { select: { term: true } },
      },
    }),
    getNavBadges(seat.businessId),
  ]);

  const currentId = business.planId ?? "free";
  const recommendedId = recommendedPlanId(plans);

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
          termQuoteAction={quoteTerm}
          termConfirmAction={confirmTermChange}
          term={business.subscription?.term ?? "monthly"}
          /*
             Only where there is a year to buy and a subscription to move.

             A seller on Free has no term — there is nothing to pay either way —
             and a plan we do not sell yearly has no annual price to quote.
          */
          offersAnnual={
            Boolean(business.subscription) &&
            Boolean(
              business.plan &&
                offersAnnual({
                  monthlyPriceAed: business.plan.monthlyPriceAed,
                  annualMonthsCharged: business.plan.annualMonthsCharged,
                }),
            )
          }
          plans={plans.map((plan) => ({
            id: plan.id,
            name: plan.name,
            monthlyPriceAed: plan.monthlyPriceAed,
            priceLabel: priceLabelOf(plan),
            annualPriceLabel: annualPriceLabelOf(plan),
            ...(summaryOf(plan.id) ? { summary: summaryOf(plan.id)! } : {}),
            features: featuresOf(plan),
            // The middle tier, not the dearest — derived from price rather than
            // named, so a fourth tier moves the recommendation without anybody
            // remembering to. `/pricing` and the plan step read the same
            // function, which is what stops the three screens disagreeing.
            recommended: plan.id === recommendedId && plan.id !== currentId,
            current: plan.id === currentId,
          }))}
        />
      </div>
    </SellerPage>
  );
}
