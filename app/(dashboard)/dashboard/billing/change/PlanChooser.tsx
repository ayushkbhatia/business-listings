"use client";

import Link from "next/link";
import { Alert } from "@/components/display";
import { useState, useTransition } from "react";
import { Button } from "@/components/primitives";
import { PlanCard, type PlanFeature } from "@/components/domain";
import { Panel } from "@/components/structure";
import { t } from "@/lib/i18n";
import type { BillingResult } from "../actions";

/**
 * Board 11f — plan change, with the proration shown before anything happens.
 *
 * One net figure is a number the seller has to take on trust. The credit and
 * the charge are separate lines with their day counts, because the question a
 * supplier actually asks is "why that number", and the answer is arithmetic
 * they can check.
 *
 * No retention offer at any point. Board 11f says so deliberately.
 */

export interface PlanOption {
  id: string;
  name: string;
  monthlyPriceAed: number;
  priceLabel: string;
  summary?: string;
  features: PlanFeature[];
  recommended: boolean;
  current: boolean;
}

export interface QuoteLine {
  planName: string;
  days: number;
  aed: string;
}

export interface ChangeQuote {
  planId: string;
  planName: string;
  credit: QuoteLine | null;
  charge: QuoteLine;
  netAed: string;
  netIsCharge: boolean;
  renewsAt: string;
}

export interface PlanChooserProps {
  plans: readonly PlanOption[];
  quoteAction: (formData: FormData) => Promise<{ ok: true; quote: ChangeQuote } | { ok: false; error: string }>;
  confirmAction: (formData: FormData) => Promise<BillingResult>;
}

export function PlanChooser({ plans, quoteAction, confirmAction }: PlanChooserProps) {
  const [quote, setQuote] = useState<ChangeQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function ask(planId: string) {
    const form = new FormData();
    form.set("planId", planId);
    setError(null);
    startTransition(async () => {
      const result = await quoteAction(form);
      if (!result.ok) {
        setError(result.error);
        setQuote(null);
        return;
      }
      setQuote(result.quote);
    });
  }

  function confirm() {
    if (!quote) return;
    const form = new FormData();
    form.set("planId", quote.planId);
    startTransition(async () => {
      const result = await confirmAction(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone(t("change.done", { plan: quote.planName }));
      setQuote(null);
    });
  }

  if (done) {
    return (
      <Panel title={done}>
        <Link
          href="/dashboard/billing"
          className="text-body-sm text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("change.back")}
        </Link>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {error && (
        <Alert tone="bad" live="assertive">{error}</Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {plans.map((plan) => (
          <PlanCard
            key={plan.id}
            name={plan.name}
            headingLevel={2}
            monthlyPriceAed={plan.monthlyPriceAed}
            priceLabel={plan.priceLabel}
            periodLabel={t("plan.period")}
            {...(plan.summary ? { summary: plan.summary } : {})}
            features={plan.features}
            recommended={plan.recommended}
            recommendedLabel={t("plan.recommended")}
            current={plan.current}
            currentLabel={t("plan.current")}
            action={
              plan.current ? (
                <span className="text-caption text-muted">{t("change.staying")}</span>
              ) : (
                <Button size="sm" block disabled={pending} onClick={() => ask(plan.id)}>
                  {t("change.choose", { plan: plan.name })}
                </Button>
              )
            }
          />
        ))}
      </div>

      {quote && (
        <Panel title={t("change.quote_heading")}>
          <dl className="flex flex-col gap-2">
            {quote.credit && (
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-body-sm">
                <dt className="text-body">
                  {t("change.credit_line", {
                    plan: quote.credit.planName,
                    days: String(quote.credit.days),
                  })}
                </dt>
                <dd className="font-mono tabular-nums text-ink">−AED {quote.credit.aed}</dd>
              </div>
            )}
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-body-sm">
              <dt className="text-body">
                {t("change.charge_line", {
                  plan: quote.charge.planName,
                  days: String(quote.charge.days),
                })}
              </dt>
              <dd className="font-mono tabular-nums text-ink">AED {quote.charge.aed}</dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-line pt-2">
              <dt className="text-body-sm text-ink">
                {quote.netIsCharge ? t("change.net_charge") : t("change.net_credit")}
              </dt>
              <dd className="font-mono text-h3 tabular-nums text-ink">AED {quote.netAed}</dd>
            </div>
          </dl>

          <p className="mt-3 text-caption text-muted">
            {t("change.renews_unchanged", { when: quote.renewsAt })}
          </p>

          <div className="mt-4">
            <Button disabled={pending} onClick={confirm}>
              {t("change.confirm")}
            </Button>
          </div>
        </Panel>
      )}
    </div>
  );
}
