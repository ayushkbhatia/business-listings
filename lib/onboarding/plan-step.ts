import "server-only";
import { prisma } from "@/lib/db/client";
import { effectiveCaps, type PlanCaps } from "@/lib/plan/entitlements";
import { rankingShare } from "@/lib/billing/pricing";
import { liveWeights } from "@/lib/search/settings";
import { trialStateFor, TRIAL_DAYS, TRIAL_PLAN_ID, type TrialState } from "@/lib/billing/trial";
import { planCohortFor, type PlanCohort } from "@/lib/metrics/plan-cohort";
import { setupStateFor, type SetupState } from "./service";
import { setupClauses, type Clause } from "./recommendation";

/**
 * Board 2e — everything the plan step renders, in one read.
 *
 * The listing is already live when this page loads; `2d` published it. That
 * ordering is the whole design, and it is why this module carries no gate and
 * no expiry: publishing is not held against payment, so the page cannot use the
 * leverage of a withheld listing and has to argue on merit instead. Criterion 2
 * forbids a countdown, an expiring offer, or a nag against a plan the product
 * calls a plan.
 *
 * Two jobs in order — choose a plan, then start the checklist — and the second
 * is the one that decides whether the seller ever gets value. A seller who picks
 * Free and finishes four tasks is worth more than one who picks Pro and
 * abandons, so the checklist is not a footer.
 */

const PLAN_SELECT = {
  id: true,
  name: true,
  monthlyPriceAed: true,
  enquiriesPerMonth: true,
  productLimit: true,
  locationLimit: true,
  photoLimit: true,
  teamSeats: true,
  rankingMultiplier: true,
  customDomain: true,
  siteVisitIncluded: true,
  sortOrder: true,
  annualMonthsCharged: true,
} as const;

export interface PlanOffer extends PlanCaps {
  annualMonthsCharged: number | null;
  /** The seller is on this one now. Exactly one card, and never also promoted. */
  current: boolean;
  /** The one promoted card — criterion 15. Never the current plan. */
  promoted: boolean;
  /** Criterion 11: false everywhere once a trial has been used. */
  offersTrial: boolean;
}

export interface PlanStepState {
  businessId: string;
  slug: string;
  displayName: string;
  /** Criterion 1: the listing is live before this page loads. */
  liveAt: Date;

  plans: PlanOffer[];
  /** Criterion 21: a seller who already pays sees one line, not three cards. */
  alreadyPaid: { planId: string; planName: string } | null;
  trial: TrialState;
  trialDays: number;

  /** Criterion 10. Null below the cohort floor, and the clause does not render. */
  cohort: PlanCohort | null;
  /** Criterion 9. Built from the seller's own rows. */
  clauses: Clause[];

  /** What Pro actually changes, criterion 4 and 5. */
  pro: {
    planName: string;
    multiplier: number;
    /** The seller's own subcategory, named in the benefit line. */
    categoryName: string | null;
    emirateName: string | null;
    /** Plan's share of the ranking score. Small, and the page says so. */
    weight: { points: number; total: number };
  } | null;

  /** Criterion 16: the same collection board 8a reads. */
  setup: SetupState;
}

/**
 * One read for the whole page.
 *
 * `setupStateFor` is board 8a's own function rather than a copy of it —
 * criterion 16 asks that completing a task on either surface update both, and
 * the way to guarantee that is one derivation, not two lists that agree today.
 */
export async function planStepStateFor(
  businessId: string,
  now = new Date(),
): Promise<PlanStepState | null> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      slug: true,
      displayName: true,
      planId: true,
      publishedAt: true,
      primaryCategoryId: true,
      primaryCategory: { select: { name: true } },
      categories: {
        orderBy: { createdAt: "asc" },
        select: { category: { select: { name: true } } },
      },
      locations: {
        orderBy: { createdAt: "asc" },
        select: { type: true, emirate: true },
      },
      subscription: { select: { planId: true, status: true, entitlementSnapshot: true } },
      _count: { select: { products: true } },
    },
  });
  if (!business?.publishedAt) return null;

  const [plans, trial, cohort, setup, weights] = await Promise.all([
    /*
       Withdrawn plans do not render here — criterion 12e's rule, restated as
       2e's own edge case: a plan that has stopped being sold is not offered to
       somebody choosing one, and everybody already on it keeps it.
    */
    prisma.plan.findMany({
      where: { withdrawnAt: null },
      orderBy: { sortOrder: "asc" },
      select: PLAN_SELECT,
    }),
    trialStateFor(businessId, now),
    planCohortFor(business.primaryCategoryId, now),
    setupStateFor(businessId),
    liveWeights(),
  ]);

  const currentPlanId = business.planId ?? "free";
  const paid = currentPlanId !== "free" && business.subscription?.status !== "trialing";

  const offers: PlanOffer[] = plans.map((plan) => {
    const caps: PlanCaps = {
      ...plan,
      monthlyPriceAed: Number(plan.monthlyPriceAed),
      rankingMultiplier: Number(plan.rankingMultiplier),
    };
    /*
       A grandfathered account is shown the caps it signed up on, not today's.
       `effectiveCaps` is the only thing on this platform that knows the
       difference, and a page that read the live plan would tell a seller their
       entitlements had changed when they had not.
    */
    const effective =
      plan.id === currentPlanId ? effectiveCaps(caps, business.subscription?.entitlementSnapshot) : caps;

    return {
      ...effective,
      annualMonthsCharged: plan.annualMonthsCharged,
      current: plan.id === currentPlanId,
      // Criterion 15: exactly one, and never the card the seller is already on.
      promoted: plan.id === TRIAL_PLAN_ID && plan.id !== currentPlanId,
      // Criterion 11 and 14 in one expression: Pro only, and not twice.
      offersTrial: plan.id === TRIAL_PLAN_ID && !trial.used && plan.id !== currentPlanId,
    };
  });

  const proPlan = plans.find((plan) => plan.id === TRIAL_PLAN_ID);
  const share = rankingShare(weights);

  return {
    businessId: business.id,
    slug: business.slug,
    displayName: business.displayName,
    liveAt: business.publishedAt,
    plans: offers,
    alreadyPaid: paid
      ? {
          planId: currentPlanId,
          planName: plans.find((plan) => plan.id === currentPlanId)?.name ?? currentPlanId,
        }
      : null,
    trial,
    trialDays: TRIAL_DAYS,
    cohort,
    clauses: setupClauses({
      locations: business.locations.length,
      locationTypes: business.locations.map((location) => location.type),
      categories: [
        ...(business.primaryCategory ? [business.primaryCategory.name] : []),
        ...business.categories.map((row) => row.category.name),
      ],
      products: business._count.products,
    }),
    pro: proPlan
      ? {
          planName: proPlan.name,
          multiplier: Number(proPlan.rankingMultiplier),
          categoryName: business.primaryCategory?.name ?? null,
          emirateName: business.locations[0]?.emirate ?? null,
          weight: { points: share.points, total: share.total },
        }
      : null,
    setup,
  };
}
