import type { PlanCaps } from "@/lib/plan/entitlements";
import type { PlanFeature } from "@/components/domain";
import type { RankingWeights } from "@/lib/search/ranking";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import {
  annualPriceAed,
  rankingShare,
  rowsThatDiffer,
  type ComparisonRow,
} from "./pricing";

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
      /*
         Board `2e-s`. The counterpart to products, and it is on every card for
         the same reason products is on a services seller's: this page compares
         what a plan contains, not what one visitor will use. A cap a seller
         can hit without ever having been told about it is the defect
         `categoryLimit` and `storageMb` both had.
      */
      label:
        plan.serviceLimit === null
          ? t("plan.services_unlimited")
          : plan.serviceLimit === 1
            ? t("plan.service_one")
            : t("plan.services", { n: formatCount(plan.serviceLimit) }),
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
      /*
         An absent line names the thing, and the strike says it is absent.

         This read "Ranked 1× in search" with a line through it, which is not an
         absence anybody can parse: `1×` is the baseline every listing already
         has, not a feature being withheld. Naming the absence directly — "No
         ranking lift in search" — was worse again, because struck through it is
         a double negative. So it takes the shape every other absent row already
         has: "Your own web address", "A lift in search ranking". The line
         through it is what says no.

         Board 1l is where this became visible; it was wrong on `2e` and `11f`
         too, and all three read the same way now.

         "1.15", "1.35", and plain "1" — not "1.0". `.replace(/\.?0+$/, "")`
         strips the trailing zeros and the dot they leave behind.
      */
      label:
        plan.rankingMultiplier > 1
          ? t("plan.ranking", {
              multiplier: plan.rankingMultiplier.toFixed(2).replace(/\.?0+$/, ""),
            })
          : t("plan.ranking_none"),
      included: plan.rankingMultiplier > 1,
    },
    { label: t("plan.custom_domain"), included: plan.customDomain },
  ];
}

/**
 * The home band's one line, from the same columns as everything else.
 *
 * This lived inside `app/(public)/page.tsx` as a local function, which made the
 * home CTA band the one surface of four that built its own sentence about a
 * plan — and it had already drifted: it interpolated the raw integers where
 * `featuresOf` runs them through `formatCount`, so a cap of 1,500 would have
 * rendered "1,500 products" on the pricing page and "1500 products" on the home
 * page. Nobody would have caught that at three digits.
 *
 * Board 1l criterion 2 asks that `1a`, `1l`, `2e`, `3m` and `11f` show
 * identical figures for the same plan, asserted by a test that renders them
 * from one fixture. That test needs one module to render them from.
 */
export function homeSummaryOf(plan: {
  locationLimit: number | null;
  productLimit: number | null;
  enquiriesPerMonth: number | null;
}): string {
  return [
    plan.locationLimit === null
      ? t("plan.locations_unlimited")
      : plan.locationLimit === 1
        ? t("plan.location_one")
        : t("plan.locations", { n: formatCount(plan.locationLimit) }),
    plan.productLimit === null
      ? t("plan.products_unlimited")
      : t("plan.products", { n: formatCount(plan.productLimit) }),
    plan.enquiriesPerMonth === null
      ? t("plan.enquiries_unlimited")
      : t("plan.enquiries", { n: formatCount(plan.enquiriesPerMonth) }),
  ].join(" · ");
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

/**
 * The same label for a year, from the same column.
 *
 * Null where the plan is not sold by the year, so a caller decides what to show
 * rather than being handed a price nobody can be charged. Free stays free: it
 * costs nothing either way and has no annual discount to state.
 */
export function annualPriceLabelOf(plan: PlanCaps & { annualMonthsCharged: number | null }): string | null {
  if (plan.monthlyPriceAed === 0) return t("plan.free");
  const yearly = annualPriceAed(plan);
  return yearly === null ? null : `AED ${formatCount(yearly)}`;
}

/**
 * The comparison table's rows — what the cards state as one line each, said
 * precisely and side by side.
 *
 * Three rows, not thirty. The cards already carry every cap, so a row here has
 * to earn its place by saying something a card line cannot:
 *
 *   1. **The ranking weight**, with the sentence that bounds it. This is the
 *      row board 1l spends a whole section on, and the reason is that a
 *      multiplier read alone is read as overall visibility. It is not: it
 *      scales one of six components, and that component is deliberately the
 *      smallest. The qualification is rendered beside the number rather than as
 *      a footnote, because a footnote is a bet that the reader will scroll.
 *   2. **The custom domain**, which is a thing rather than a tick.
 *   3. **The site visit**, which is staff going to an address — and the one
 *      place worth saying that the tier which follows is ours to set on every
 *      plan, so that a paid tier is never mistaken for a bought badge.
 *
 * Every cell is derived. The weights arrive live from `/admin/search` rather
 * than from `DEFAULT_WEIGHTS`, which is what makes the claim move when staff
 * move the ranking — board 1l criterion 6.
 *
 * `rowsThatDiffer` drops any row every plan answers identically. Levelling two
 * plans should shorten this table rather than leave a row saying the same thing
 * three times: a comparison row that compares nothing is padding, and padding
 * on a pricing page is the cheapest kind of dishonesty.
 */
export function comparisonRowsOf(
  plans: readonly PlanCaps[],
  weights: RankingWeights,
): ComparisonRow[] {
  const share = rankingShare(weights);

  const rows: ComparisonRow[] = [
    {
      key: "ranking",
      header: t("pricing.row.ranking"),
      note: t("pricing.row.ranking_note", {
        points: share.points,
        total: share.total,
        others: share.others,
      }),
      cells: plans.map((plan) => ({
        planId: plan.id,
        // "1", "1.15", "1.35" — never "1.0". Same trim as the card line, so the
        // two cannot render the same number two ways.
        label: t("pricing.cell.multiplier", {
          multiplier: plan.rankingMultiplier.toFixed(2).replace(/\.?0+$/, ""),
        }),
        state: "value" as const,
      })),
    },
    {
      key: "custom_domain",
      header: t("pricing.row.custom_domain"),
      note: t("pricing.row.custom_domain_note"),
      cells: plans.map((plan) => included(plan, plan.customDomain)),
    },
  ];

  return rowsThatDiffer(rows);
}

function included(plan: PlanCaps, has: boolean) {
  return {
    planId: plan.id,
    label: has ? t("pricing.cell.included") : t("pricing.cell.absent"),
    state: (has ? "included" : "absent") as "included" | "absent",
  };
}
