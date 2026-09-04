import type { Metadata } from "next";
import { Eyebrow } from "@/components/display";
import { PlanComparison } from "@/components/domain";
import { Breadcrumb, PublicShell } from "@/components/structure";
import { getActor } from "@/lib/auth/session";
import { isSellerRole } from "@/lib/auth/roles";
import {
  annualPriceLabelOf,
  comparisonRowsOf,
  featuresOf,
  priceLabelOf,
  summaryOf,
} from "@/lib/billing/plan-features";
import {
  MONTHS_IN_YEAR,
  annualMonthsFree,
  ctaFor,
  purchasable,
  recommendedPlanId,
} from "@/lib/billing/pricing";
import { getPricingPlans, getRankingWeights, readViewerPlanId } from "@/lib/db/queries";
import { formatCount } from "@/lib/format";
import { MAX_ROWS } from "@/lib/import/csv";
import { t } from "@/lib/i18n";
import { absoluteUrl } from "@/lib/site";
import { DirectoryFooter, DirectoryNav } from "../_chrome";
import { JsonLd } from "../_json-ld";
import { PlanGrid, type PricingCard } from "./PlanGrid";

/**
 * Board 1l — pricing and plans.
 *
 * One argument: **listing is free, and paying buys reach rather than access.**
 * A free listing is a complete, permanent product; what money buys is position
 * and tooling. That is why nothing here expires, no card counts down, and the
 * lines a plan does not have are named plainly instead of teased.
 *
 * ## Every figure is a query
 *
 * No price, no cap and no multiplier is written into this file. The same
 * numbers appear on the home CTA band `1a`, the plan step `2e` and the change
 * screen `11f`, and a supplier who reads one figure here and a different one at
 * checkout does not complete — so all four render from the `Plan` row, through
 * the same `featuresOf`, and the arithmetic on top of it lives in
 * `lib/billing/pricing.ts` rather than in any of the four.
 *
 * ## The three claims this page had to reconcile against the product
 *
 * Board 1l says this page must be literally true, because a supplier checks
 * every word of it against the product inside a week. Three of the things the
 * board draws were not true of what is built, and each is resolved here rather
 * than rendered:
 *
 *  1. **The ranking multiplier.** Drawn as `3× + top slot`. It is
 *     `Plan.rankingMultiplier`, it runs 1 → 1.35, and it scales one of six
 *     components — plan tier, deliberately the smallest, capped at 10 by
 *     `PLAN_TIER_CEILING` with the reason beside it. The row renders the live
 *     multiplier and carries the sentence that bounds it, next to the number
 *     rather than in a footnote.
 *  2. **"Top placement in your subcategory"** as a Pro entitlement. It is not
 *     one. A sponsored slot is a `PlacementSlot`, taken per subcategory and
 *     emirate at its own monthly price by a seller on any plan, always
 *     labelled, never above a verified supplier on a filter the buyer set. It
 *     is listed under what is the same on every plan, which is where it is.
 *  3. **A 14-day trial.** There is none. `SubStatus` has a `trialing` value
 *     that nothing writes: no trial length on `Plan`, no start, no end, no code
 *     path. Offering one here would be a promise the product cannot keep on the
 *     first day, so the Pro card says "Start on Pro".
 *
 * The prices themselves are ours to publish and are not the no-price rule: that
 * rule governs what a **seller** publishes about their goods. A subscription is
 * what we charge, and this is the one page where a price in structured data is
 * correct.
 */

/*
 * Dynamic route, cached data — the same arrangement as the home page and for
 * the same reason. This page reads the session, because a signed-in seller must
 * see their own plan marked and their buttons pointed at billing rather than at
 * onboarding, and a cookie read opts the route out of static rendering. A
 * page-level `revalidate` would therefore be inert. The caching sits on the two
 * reads instead, an hour each, cleared by the admin screens that change them.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const plans = purchasable(await getPricingPlans());
  const cheapestPaid = plans
    .filter((plan) => plan.monthlyPriceAed > 0)
    .sort((a, b) => a.monthlyPriceAed - b.monthlyPriceAed)[0];

  /*
     The free tier and the entry price, no adjectives. "business listing UAE
     price" is a real query and the answer to it is two numbers.

     With every paid plan withdrawn there is no entry price, and the version
     with the placeholder filled in would read "from AED 0 a month" — a number
     that is arithmetically true and says nothing. The cold-start state is a
     designed state, so it gets its own sentence rather than a zero.
  */
  if (!cheapestPaid) {
    return {
      title: t("pricing.seo_title_free"),
      description: t("pricing.seo_description_free"),
      alternates: { canonical: absoluteUrl("/pricing") },
    };
  }

  const from = formatCount(cheapestPaid.monthlyPriceAed);
  return {
    title: t("pricing.seo_title", { from }),
    description: t("pricing.seo_description", { from }),
    alternates: { canonical: absoluteUrl("/pricing") },
  };
}

export default async function PricingPage() {
  const [allPlans, weights, actor] = await Promise.all([
    getPricingPlans(),
    getRankingWeights(),
    getActor(),
  ]);

  /*
     What is purchasable today, and only that.

     A plan withdrawn from sale keeps every subscriber it has — the row is never
     deleted, `entitlementSnapshot` still grandfathers their numbers, and the
     billing screens still name it. It simply cannot be started, so it is not on
     the page that starts things.
  */
  const plans = purchasable(allPlans);

  /*
     A buyer, or somebody signed out, has no plan of their own and the page
     renders unchanged for them. A buyer reading the seller pricing page is a
     prospect; hiding it or redirecting them would be answering a question
     nobody asked.
  */
  const sellerBusinessId =
    actor?.businessId && actor.roles.some(isSellerRole) ? actor.businessId : null;
  const currentPlanId = sellerBusinessId ? await readViewerPlanId(sellerBusinessId) : null;
  const currentPlan = plans.find((plan) => plan.id === currentPlanId) ?? null;

  const recommendedId = recommendedPlanId(plans);
  const comparisonRows = comparisonRowsOf(plans, weights);

  const cards: PricingCard[] = plans.map((plan) => {
    // Never both. A card that is recommended and current is recommending
    // something to somebody who already has it.
    const recommended = plan.id === recommendedId && plan.id !== currentPlanId;
    const cta = ctaFor({
      plan,
      currentPlanId,
      currentMonthlyPriceAed: currentPlan?.monthlyPriceAed ?? null,
      recommended,
    });

    return {
      id: plan.id,
      name: plan.name,
      monthlyPriceAed: plan.monthlyPriceAed,
      monthlyLabel: priceLabelOf(plan),
      annualLabel: annualPriceLabelOf(plan),
      monthsFree: annualMonthsFree(plan),
      ...(summaryOf(plan.id) ? { summary: summaryOf(plan.id)! } : {}),
      features: featuresOf(plan),
      recommended,
      current: plan.id === currentPlanId,
      cta: {
        kind: cta.kind,
        variant: cta.variant,
        ...(cta.href ? { href: cta.href } : {}),
        label: ctaLabel(cta.kind, plan.name),
      },
    };
  });

  const crumbs = [
    { label: t("chrome.directory"), href: "/" },
    { label: t("pricing.breadcrumb") },
  ];

  return (
    <PublicShell
      bleed
      nav={<DirectoryNav active="pricing" />}
      breadcrumb={<Breadcrumb label={t("gallery.breadcrumb_label")} items={crumbs} />}
      footer={<DirectoryFooter />}
    >
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: crumbs.map((crumb, index) => ({
            "@type": "ListItem",
            position: index + 1,
            name: crumb.label,
            item: absoluteUrl(crumb.href ?? "/pricing"),
          })),
        }}
      />

      {/*
         An Offer per plan, and this is the only page in the site where that is
         correct: the offer is our subscription, not a seller's goods. The price
         is the monthly one because monthly is what can actually be charged —
         emitting a yearly price in structured data while billing runs monthly
         would put the untrue version in front of a crawler.
      */}
      {plans.map((plan) => (
        <JsonLd
          key={plan.id}
          data={{
            "@context": "https://schema.org",
            "@type": "Product",
            /*
               The wordmark, literally, as the home page's `WebSite` block also
               writes it. A brand name is not translated copy — it is the same
               string in every locale — which is why it does not go through
               `t()` here or in the nav.
            */
            name: `Business Listings ${plan.name}`,
            description: summaryOf(plan.id) ?? t("pricing.lede"),
            brand: { "@type": "Brand", name: "Business Listings" },
            offers: {
              "@type": "Offer",
              url: absoluteUrl("/pricing"),
              price: plan.monthlyPriceAed,
              priceCurrency: "AED",
              availability: "https://schema.org/InStock",
              priceSpecification: {
                "@type": "UnitPriceSpecification",
                price: plan.monthlyPriceAed,
                priceCurrency: "AED",
                billingIncrement: 1,
                unitCode: "MON",
              },
            },
          }}
        />
      ))}

      {/* ── 1 · Hero ───────────────────────────────────────────────────── */}
      <section className="border-b border-line bg-paper">
        <div className="mx-auto max-w-3xl px-5 pt-11 pb-9 text-center">
          <Eyebrow as="p">{t("pricing.eyebrow")}</Eyebrow>
          <h1 className="mt-3 font-serif text-[2.625rem] leading-[1.12] tracking-[-0.02em] text-ink">
            {t("pricing.title")}
          </h1>
          {/*
             "No pay-per-lead" is the sharpest line on the page. It is the model
             every incumbent UAE directory uses, and stating its absence is the
             one differentiator a competitor cannot copy without rebuilding
             their business.
          */}
          <p className="mx-auto mt-3.5 max-w-[600px] text-body leading-[1.6] text-body">
            {t("pricing.lede")}
          </p>
        </div>
      </section>

      {/* ── 2 · Plans ──────────────────────────────────────────────────── */}
      <section aria-labelledby="plans-heading" className="bg-paper">
        <div className="mx-auto max-w-7xl px-5 py-9">
          <h2 id="plans-heading" className="sr-only">
            {t("pricing.plans_heading")}
          </h2>

          <PlanGrid cards={cards} monthsInYear={MONTHS_IN_YEAR} />

          {/*
             Free is a product, not a trial. No countdown, no expiry, no nag —
             and it is said once, plainly, rather than implied by the absence of
             those things.
          */}
          <p className="mt-5 max-w-prose text-caption leading-relaxed text-muted">
            {t("pricing.free_is_permanent")}
          </p>
        </div>
      </section>

      {/* ── 3 · What else is different ─────────────────────────────────── */}
      {/*
         The section goes when its rows do.

         `comparisonRowsOf` drops every dimension the plans answer identically,
         so levelling the tiers empties this — and a heading reading "what else
         is different" over nothing is worse than no section. Widen the window,
         then drop the section: the same rule the home page's "verified this
         week" band answers to.
      */}
      {comparisonRows.length > 0 && (
        <section aria-labelledby="difference-heading" className="border-t border-line bg-paper">
          <div className="mx-auto max-w-7xl px-5 py-9">
            <Eyebrow as="h2" id="difference-heading">
              {t("pricing.table.heading")}
            </Eyebrow>

            <div className="mt-3.5">
              <PlanComparison
                caption={t("pricing.table.caption")}
                featureHeader={t("pricing.table.feature")}
                columns={plans.map((plan) => ({
                  id: plan.id,
                  name: plan.name,
                  highlighted: plan.id === recommendedId,
                }))}
                rows={comparisonRows}
              />
            </div>
          </div>
        </section>
      )}

      {/* ── 4 · What a plan does not change ────────────────────────────── */}
      {/*
         The three things a reader most expects to be tiered, and is not.

         A comparison table that listed them would show the same answer in every
         column, which compares nothing and reads as padding. Said here instead,
         because each one is a place this page could have oversold and did not.
      */}
      <section aria-labelledby="same-heading" className="border-t border-line bg-paper-sunk">
        <div className="mx-auto max-w-7xl px-5 py-9">
          <Eyebrow as="h2" id="same-heading">
            {t("pricing.same_heading")}
          </Eyebrow>
          <ul className="mt-3.5 grid max-w-5xl gap-3 md:grid-cols-2">
            {[
              { key: "response", copy: t("pricing.same.response_time") },
              { key: "import", copy: t("pricing.same.import", { rows: formatCount(MAX_ROWS) }) },
              { key: "placement", copy: t("pricing.same.placement") },
              { key: "commission", copy: t("pricing.same.commission") },
            ].map((item) => (
              <li
                key={item.key}
                className="rounded-card border border-line bg-card p-4 text-body-sm leading-relaxed text-body"
              >
                {item.copy}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </PublicShell>
  );
}

/**
 * The button's words, per state.
 *
 * Here rather than in the client component because the plan's name comes from
 * the database and interpolating it is a server job — and because keeping the
 * five states in one `switch` is what stops a sixth appearing on one surface.
 */
function ctaLabel(kind: PricingCard["cta"]["kind"], planName: string): string {
  switch (kind) {
    case "claim":
      return t("pricing.cta.claim");
    case "start":
      return t("pricing.cta.start", { plan: planName });
    case "current":
      return t("pricing.cta.current");
    case "upgrade":
      return t("pricing.cta.upgrade", { plan: planName });
    case "downgrade":
      return t("pricing.cta.downgrade", { plan: planName });
  }
}
