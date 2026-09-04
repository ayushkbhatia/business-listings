import type { PlanCaps } from "@/lib/plan/entitlements";
import type { RankingWeights } from "@/lib/search/ranking";

/**
 * Board 1l — what the public pricing page is allowed to say, derived.
 *
 * Every figure on `/pricing` comes from a `Plan` row or from the ranking
 * config, and this module is where the derivation lives so that the page, the
 * plan step of onboarding and the change screen cannot disagree about it. The
 * page itself holds no arithmetic and no number.
 *
 * ## Why this file exists rather than three copies of the same sum
 *
 * "A seller who reads AED 299 here and sees AED 349 at checkout will not
 * complete." The four surfaces that quote a price — the home CTA band `1a`,
 * this page `1l`, the plan step `2e` and the change screen `11f` — all read the
 * same row already. What they did not share was everything computed *from* the
 * row: the annual figure, which plan is recommended, and what the ranking
 * multiplier is actually worth. Those are the claims most likely to drift,
 * because each is one line of arithmetic somebody can rewrite locally.
 */

export const MONTHS_IN_YEAR = 12;

/**
 * A year costs what the plan says a year costs.
 *
 * This was a constant, and beside it sat `ANNUAL_BILLING_LIVE = false` with a
 * note ending *"the day billing grows a yearly period, this becomes true and
 * the note goes."* That day arrived: `Subscription.term` exists, `runRenewals`
 * charges a period, and `Plan.annualMonthsCharged` says how many months a year
 * is worth. Both the constant and the flag are gone, and the discount is a
 * column that `/admin/plans` will edit rather than a deploy.
 *
 * Null means the plan is not sold by the year — Free, and any tier we decide
 * not to offer yearly. `offersAnnual` in `lib/billing/period.ts` is the check,
 * and it is the same one the billing screens use.
 */
export type BillingPeriod = "monthly" | "annual";

/** The `Plan` columns this module needs, plus the one that says it is on sale. */
export interface PricingPlan extends PlanCaps {
  /** Null while the plan is still sold. See `Plan.withdrawnAt`. */
  withdrawnAt: Date | null;
  /** Months charged for a year. Null means this plan is monthly-only. */
  annualMonthsCharged: number | null;
}

/**
 * What a year costs, from the monthly price and the plan's own discount.
 *
 * There is no second price column and there must not be one: two prices for the
 * same plan is two numbers to keep in step, and the discount stops being
 * checkable the moment they drift.
 *
 * Returns null where the plan has no annual price, so a caller has to decide
 * what to render rather than being handed a figure nobody can be charged.
 */
export function annualPriceAed(plan: {
  monthlyPriceAed: number;
  annualMonthsCharged: number | null;
}): number | null {
  if (plan.annualMonthsCharged === null) return null;
  return plan.monthlyPriceAed * plan.annualMonthsCharged;
}

/**
 * How many months of twelve a year saves, on this plan.
 *
 * Stated as months rather than as a percentage on purpose: a supplier budgets
 * in months, and "two months free" is a sentence they can check. The percentage
 * is 16.67%, which is a number nobody has ever felt.
 *
 * Per plan rather than per page, because the discount is a column. Two tiers
 * with different discounts each state their own, which is the honest rendering
 * of a thing that can differ.
 */
export function annualMonthsFree(plan: { annualMonthsCharged: number | null }): number {
  if (plan.annualMonthsCharged === null) return 0;
  return MONTHS_IN_YEAR - plan.annualMonthsCharged;
}

/** The price for the period being shown, in whole dirhams. Null where there is none. */
export function priceForPeriod(
  plan: { monthlyPriceAed: number; annualMonthsCharged: number | null },
  period: BillingPeriod,
): number | null {
  return period === "annual" ? annualPriceAed(plan) : plan.monthlyPriceAed;
}

/**
 * On sale today.
 *
 * Criterion 12, both halves. A withdrawn plan does not render here, and the row
 * is untouched — so everybody already on it keeps their plan, their price and
 * their grandfathered caps. Withdrawal is a decision about what can be started,
 * never about what is running.
 */
export function isPurchasable(plan: { withdrawnAt: Date | null }, now: Date = new Date()): boolean {
  return plan.withdrawnAt === null || plan.withdrawnAt > now;
}

export function purchasable<T extends { withdrawnAt: Date | null }>(
  plans: readonly T[],
  now: Date = new Date(),
): T[] {
  return plans.filter((plan) => isPurchasable(plan, now));
}

/**
 * The one card that takes the tinted shadow.
 *
 * The cheapest paid plan, never the dearest. Board 11f already made this
 * decision in words — *"it is recommended because it is the one most suppliers
 * want rather than the one that earns most; a directory whose recommendation is
 * always its dearest tier is a directory a supplier learns to read past"* — and
 * it was written there as a literal `plan.id === "basic"`, which is the same
 * decision made three times in three files. Here it is made once, from price,
 * so adding a fourth tier moves the promotion without anybody remembering to.
 *
 * Returns null when there is nothing to recommend: one plan, or none paid.
 * Criterion 8 is "exactly one card is promoted", and zero is the honest answer
 * to a page with nothing to choose between.
 */
export function recommendedPlanId(plans: readonly { id: string; monthlyPriceAed: number }[]): string | null {
  const paid = plans
    .filter((plan) => plan.monthlyPriceAed > 0)
    .sort((a, b) => a.monthlyPriceAed - b.monthlyPriceAed);
  if (paid.length < 2) return paid[0]?.id ?? null;
  return paid[0]!.id;
}

/**
 * What the plan-tier weight is worth, out of the whole ranking.
 *
 * This is the number that keeps the multiplier honest. `Plan.rankingMultiplier`
 * runs 1 → 1.35, and read alone a reader takes it for a third more visibility.
 * It is not: it scales one of six components, and that component is deliberately
 * the smallest — `PLAN_TIER_CEILING` in `lib/search/ranking.ts` caps it at 10
 * with the reason written beside it.
 *
 * Reading the live weights rather than the constant is criterion 6: raising the
 * weight in `/admin/search` changes what this page claims, in the same minute,
 * without a deploy.
 */
export interface RankingShare {
  /** The plan-tier weight itself. */
  points: number;
  /** Every weight added up. Not assumed to be 100 — staff can set any of them. */
  total: number;
  /** The other five, added up. */
  others: number;
}

export function rankingShare(weights: RankingWeights): RankingShare {
  const total =
    weights.relevance +
    weights.verificationTier +
    weights.responseTime +
    weights.specCompleteness +
    weights.distance +
    weights.planTier;
  return { points: weights.planTier, total, others: total - weights.planTier };
}

/**
 * A row of the comparison table.
 *
 * `cells` is parallel to the plans given, so the table's columns and its body
 * cannot fall out of step with each other.
 */
export interface ComparisonCell {
  planId: string;
  /** Already localised. */
  label: string;
  /** Drives the tick / dash treatment. `unknown` where the answer is a value. */
  state: "included" | "absent" | "value";
}

export interface ComparisonRow {
  key: string;
  /** Already localised. */
  header: string;
  /** The qualification that stops the row being read as more than it is. */
  note?: string;
  cells: ComparisonCell[];
}

/**
 * Drop a row every plan answers the same way.
 *
 * "Never pad a list to fill a grid." A comparison row identical in all three
 * columns compares nothing — it is a feature list wearing a table's clothes,
 * and it is exactly how a five-row table becomes a thirty-row one. Levelling
 * two plans in `/admin/plans` should shorten this table, not leave a row that
 * says the same thing three times.
 */
export function rowsThatDiffer(rows: readonly ComparisonRow[]): ComparisonRow[] {
  return rows.filter((row) => {
    const first = row.cells[0];
    if (!first) return false;
    return row.cells.some((cell) => cell.label !== first.label);
  });
}

/**
 * What the button on a plan card does, for the person reading it.
 *
 * The states board 1l names, as a decision rather than as four branches spread
 * through a component:
 *
 *   - **No plan of their own** — signed out, a buyer, or staff. Every card
 *     points at the claim flow. A buyer reading the seller pricing page is a
 *     prospect, so nothing is hidden from them and nothing redirects them.
 *   - **On this plan** — the card says so and its button does nothing. Not a
 *     link to the plan they are already on.
 *   - **Dearer than theirs** — an upgrade, to the change screen.
 *   - **Cheaper than theirs** — a downgrade, to the same screen, and never as a
 *     primary button. The change screen is where the proration and the
 *     consequences are spelled out; sending a downgrade anywhere else asks
 *     somebody to give something up without showing them what.
 *
 * There is no trial anywhere in this. `SubStatus` has a `trialing` value and
 * nothing in the product ever writes it: no trial length on `Plan`, no start,
 * no end, no code path. So the page offers none — criterion 11 says a seller
 * who has used the trial must see no trial language, and the honest reading of
 * a product with no trial is that nobody has one to use.
 */
export type PlanCtaKind = "claim" | "start" | "current" | "upgrade" | "downgrade";

export interface PlanCta {
  kind: PlanCtaKind;
  /** Absent on `current`, which is a state rather than a destination. */
  href?: string;
  /** A downgrade is never primary. */
  variant: "primary" | "secondary" | "ghost";
}

export interface CtaInput {
  plan: { id: string; monthlyPriceAed: number };
  /** The reader's own plan, or null when they have no listing. */
  currentPlanId: string | null;
  /** What the reader's plan costs. Needed to tell an upgrade from a downgrade. */
  currentMonthlyPriceAed: number | null;
  /** True for the one promoted card, which takes the primary button. */
  recommended: boolean;
}

export function ctaFor({
  plan,
  currentPlanId,
  currentMonthlyPriceAed,
  recommended,
}: CtaInput): PlanCta {
  if (currentPlanId === null) {
    const kind: PlanCtaKind = plan.monthlyPriceAed === 0 ? "claim" : "start";
    return {
      kind,
      /*
         The chosen plan rides along to the claim flow so the plan step can open
         on it. `2e` does not read it yet: the param would have to survive the
         four steps between claiming and choosing, which is a change to the
         onboarding flow rather than to this page. It is here because this is
         the link that will carry it, and because an address that already says
         what the reader picked is the cheap half of that work.
      */
      href: `/onboarding/claim?plan=${plan.id}`,
      variant: recommended ? "primary" : "secondary",
    };
  }

  if (plan.id === currentPlanId) return { kind: "current", variant: "secondary" };

  const theirs = currentMonthlyPriceAed ?? 0;
  if (plan.monthlyPriceAed > theirs) {
    return {
      kind: "upgrade",
      href: `/dashboard/billing/change?to=${plan.id}`,
      variant: recommended ? "primary" : "secondary",
    };
  }

  return {
    kind: "downgrade",
    href: `/dashboard/billing/change?to=${plan.id}`,
    variant: "ghost",
  };
}
