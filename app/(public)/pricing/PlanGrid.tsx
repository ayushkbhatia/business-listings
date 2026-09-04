"use client";

import Link from "next/link";
import { useState } from "react";
import { PlanCard, type PlanFeature } from "@/components/domain";
import { Button, SegmentedControl, buttonClassName } from "@/components/primitives";
import type { BillingPeriod, PlanCtaKind } from "@/lib/billing/pricing";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

/**
 * The three cards and the monthly/annual toggle.
 *
 * The only client component on `/pricing`, and it is one because the toggle is
 * a `radiogroup` with state. Everything it renders arrives already decided:
 * both price labels are formatted on the server from the `Plan` row, the CTA is
 * a label, an address and a variant, and the feature lines are strings. No
 * function crosses the boundary and no arithmetic happens here — the page's
 * whole promise is that its numbers come from the database, and a number
 * computed in the browser is a number nothing tested.
 *
 * The toggle changes which of two labels is shown. It does not navigate: a
 * query parameter would cost a round trip to swap a word, and would put a
 * second address on a page that has one canonical.
 */

export interface PricingCta {
  kind: PlanCtaKind;
  /** Already localised, with the plan's name in it where the copy has one. */
  label: string;
  /** Absent on the plan the reader is already on. */
  href?: string;
  variant: "primary" | "secondary" | "ghost";
}

export interface PricingCard {
  id: string;
  name: string;
  /** Drives whether a period suffix renders at all. Free has no period. */
  monthlyPriceAed: number;
  /** "Free" / "AED 349", formatted on the server. */
  monthlyLabel: string;
  /** "AED 3,490", ten months from the same column. Null where none is sold. */
  annualLabel: string | null;
  /** How many of twelve months a year saves on this plan. Zero where none is. */
  monthsFree: number;
  summary?: string;
  features: readonly PlanFeature[];
  recommended: boolean;
  current: boolean;
  cta: PricingCta;
}

export interface PlanGridProps {
  cards: readonly PricingCard[];
  /** Twelve, from `MONTHS_IN_YEAR`. Passed rather than assumed. */
  monthsInYear: number;
}

export function PlanGrid({ cards, monthsInYear }: PlanGridProps) {
  const [period, setPeriod] = useState<BillingPeriod>("monthly");
  /*
     The toggle appears when there is a year to buy.

     The discount is a column per plan, so a page where nothing is sold yearly
     shows no toggle at all rather than one that switches between two identical
     views. Each card states its own saving, because two tiers can legitimately
     carry different ones.
  */
  const sellsAnnual = cards.some((card) => card.annualLabel !== null);

  /*
     No cards, no toggle.

     Only reachable by withdrawing every plan, which nobody plans to do — but a
     period switch above an empty grid is the version of this page that reads
     broken rather than thin, and the cold-start state is a designed state.
  */
  if (cards.length === 0) return null;

  return (
    <div className="flex flex-col gap-6">
      {sellsAnnual && (
        <div className="flex flex-col items-center gap-3">
          <SegmentedControl<BillingPeriod>
            label={t("pricing.period_label")}
            value={period}
            onChange={setPeriod}
            options={[
              { value: "monthly", label: t("pricing.period_monthly") },
              { value: "annual", label: t("pricing.period_annual") },
            ]}
          />
          {period === "annual" && (
            <p className="text-caption text-muted">
              {t("pricing.annual_explained", { months: monthsInYear })}
            </p>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {cards.map((card) => (
          <div
            key={card.id}
            /*
               Stacked, the promoted card goes first: card order is the only
               hierarchy left once the columns are gone, and the tinted shadow
               reads as decoration on a card nobody reaches.
            */
            className={cn("flex", card.recommended && "order-first lg:order-none")}
          >
            <PlanCard
              name={card.name}
              headingLevel={2}
              monthlyPriceAed={card.monthlyPriceAed}
              /*
                 A plan with no annual price keeps its monthly one on the annual
                 view rather than blanking. Free is the case that matters: it
                 costs nothing either way, and a gap where a price should be
                 reads as a page that failed to load.
              */
              priceLabel={
                period === "annual" && card.annualLabel !== null
                  ? card.annualLabel
                  : card.monthlyLabel
              }
              periodLabel={
                period === "annual" && card.annualLabel !== null
                  ? t("pricing.per_year")
                  : t("pricing.per_month")
              }
              {...(period === "annual" && card.monthsFree > 0
                ? { note: t("pricing.period_saving", { months: card.monthsFree }) }
                : {})}
              {...(card.summary ? { summary: card.summary } : {})}
              features={card.features}
              recommended={card.recommended}
              recommendedLabel={t("plan.recommended")}
              current={card.current}
              currentLabel={t("plan.current")}
              action={
                card.cta.href ? (
                  <Link
                    href={card.cta.href}
                    className={buttonClassName({
                      variant: card.cta.variant,
                      size: "lg",
                      block: true,
                    })}
                  >
                    {card.cta.label}
                  </Link>
                ) : (
                  // The plan they are on. A button that does nothing, rather
                  // than a link to where they already are.
                  <Button variant="secondary" size="lg" block disabled>
                    {card.cta.label}
                  </Button>
                )
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
}
