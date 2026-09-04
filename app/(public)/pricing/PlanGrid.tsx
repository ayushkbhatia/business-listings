"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert } from "@/components/display";
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
  /** "Free" / "AED 3,490". Ten months, from the same column. */
  annualLabel: string;
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
  /** Ten, from `ANNUAL_MONTHS_CHARGED`. The discount is the difference. */
  monthsCharged: number;
  /** False while nothing can actually take a year's money. */
  annualLive: boolean;
}

export function PlanGrid({ cards, monthsInYear, monthsCharged, annualLive }: PlanGridProps) {
  const [period, setPeriod] = useState<BillingPeriod>("monthly");
  const monthsFree = monthsInYear - monthsCharged;

  /*
     No cards, no toggle.

     Only reachable by withdrawing every plan, which nobody plans to do — but a
     period switch above an empty grid is the version of this page that reads
     broken rather than thin, and the cold-start state is a designed state.
  */
  if (cards.length === 0) return null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-3">
        <SegmentedControl<BillingPeriod>
          label={t("pricing.period_label")}
          value={period}
          onChange={setPeriod}
          options={[
            { value: "monthly", label: t("pricing.period_monthly") },
            {
              value: "annual",
              // The discount as months, not a percentage. A supplier budgets in
              // months; 16.67% is a number nobody has ever felt.
              label: `${t("pricing.period_annual")} · ${t("pricing.period_saving", {
                months: monthsFree,
              })}`,
            },
          ]}
        />
        {period === "annual" && (
          <p className="text-caption text-muted">
            {t("pricing.annual_explained", { months: monthsInYear, charged: monthsCharged })}
          </p>
        )}
      </div>

      {/*
         Said once, where the choice is made, and only when it is made.

         Nothing in this product can charge a year: `Plan` has one price column
         and every mechanism under it is monthly. A page that offers annual and
         then bills monthly is exactly the surprise board 1l exists to avoid, so
         the toggle shows what a year costs and this line says what will
         actually happen. It goes when annual billing does.
      */}
      {period === "annual" && !annualLive && (
        <Alert tone="info" live="polite">
          {t("pricing.annual_not_live")}
        </Alert>
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
              priceLabel={period === "annual" ? card.annualLabel : card.monthlyLabel}
              periodLabel={period === "annual" ? t("pricing.per_year") : t("pricing.per_month")}
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
