import { redirect } from "next/navigation";
import { Alert } from "@/components/display";
import { prisma } from "@/lib/db/client";
import { PlanCard } from "@/components/domain";
import { featuresOf, priceLabelOf, summaryOf } from "@/lib/billing/plan-features";
import { t } from "@/lib/i18n";
import { OnboardingPage, requireClaimant } from "../_shell";
import { finishOnboarding } from "../actions";

/**
 * Board 2e — pick a plan, on a listing that is already live.
 *
 * Criterion 3, seen from the other side. The line at the top says the listing
 * is up and gives its address, because a pricing table shown to somebody who
 * thinks they are still blocked reads as a paywall however it is worded.
 *
 * "Stay on Free" is a real button rather than a link in small type. Free is a
 * plan and not a trial, and a screen that makes the free option hard to find
 * says the opposite of what the product says.
 */
export const metadata = { title: "Pick a plan" };
export const dynamic = "force-dynamic";

const PLAN_SELECT = {
  id: true, name: true, monthlyPriceAed: true, enquiriesPerMonth: true, productLimit: true,
  locationLimit: true, photoLimit: true, teamSeats: true, rankingMultiplier: true,
  customDomain: true, siteVisitIncluded: true, sortOrder: true,
  // What a year costs, so a card can state the term the seller is actually on.
  annualMonthsCharged: true,
} as const;

export default async function PlanStepPage() {
  const actor = await requireClaimant("plan");
  if (!actor.businessId) redirect("/onboarding/claim");

  const [business, plans] = await Promise.all([
    prisma.business.findUniqueOrThrow({
      where: { id: actor.businessId },
      select: { slug: true, planId: true, publishedAt: true },
    }),
    prisma.plan.findMany({ orderBy: { sortOrder: "asc" }, select: PLAN_SELECT }),
  ]);

  // Getting here without being live means the locations step was skipped by a
  // typed URL. Send them back rather than showing a plan for a listing nobody
  // can see.
  if (!business.publishedAt) redirect("/onboarding/locations");

  return (
    <OnboardingPage step="plan" title={t("plan_step.title")}>
      <Alert tone="ok">{t("plan_step.live_already", { url: `/b/${business.slug}` })}</Alert>

      <div className="grid gap-4 lg:grid-cols-3">
        {plans.map((plan) => (
          <PlanCard
            key={plan.id}
            name={plan.name}
            headingLevel={2}
            monthlyPriceAed={plan.monthlyPriceAed}
            priceLabel={priceLabelOf(plan)}
            periodLabel={t("plan.period")}
            {...(summaryOf(plan.id) ? { summary: summaryOf(plan.id)! } : {})}
            features={featuresOf(plan)}
            recommended={plan.id === "basic"}
            recommendedLabel={t("plan.recommended")}
            current={plan.id === (business.planId ?? "free")}
            currentLabel={t("plan.current")}
            action={
              plan.id === "free" ? (
                <form action={finishOnboarding}>
                  <button
                    type="submit"
                    className="inline-flex w-full items-center justify-center rounded-ctl border border-line-strong bg-card px-3.5 py-1.5 text-body-sm font-medium text-ink hover:bg-fill focus-visible:shadow-focus focus-visible:outline-none"
                  >
                    {t("plan_step.stay_free")}
                  </button>
                </form>
              ) : (
                <a
                  href={`/dashboard/billing/change?to=${plan.id}`}
                  className="inline-flex w-full items-center justify-center rounded-ctl border border-moss bg-moss px-3.5 py-1.5 text-body-sm font-medium text-on-ink hover:bg-moss-hover focus-visible:shadow-focus focus-visible:outline-none"
                >
                  {t("plan_step.choose", { plan: plan.name })}
                </a>
              )
            }
          />
        ))}
      </div>

      <form action={finishOnboarding} className="flex justify-end border-t border-line pt-4">
        <button
          type="submit"
          className="text-body-sm text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("plan_step.done")}
        </button>
      </form>
    </OnboardingPage>
  );
}
