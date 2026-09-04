"use client";

import Link from "next/link";
import { Alert } from "@/components/display";
import { useState, useTransition } from "react";
import { Button, SegmentedControl } from "@/components/primitives";
import type { BillingTerm } from "@/lib/billing/period";
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
  /**
   * "AED 8,990", or null where the plan is not sold by the year.
   *
   * Shown when the seller is on an annual term, because a card reading
   * "AED 899 a month" to somebody who pays AED 8,990 a year states a figure
   * they are never invoiced — the same defect the billing panel had before it
   * learned to say which term it was talking about.
   */
  annualPriceLabel: string | null;
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
  /** A plan id for a plan change, a term for a term change. */
  planId: string;
  planName: string;
  credit: QuoteLine | null;
  charge: QuoteLine;
  netAed: string;
  netIsCharge: boolean;
  renewsAt: string;
  /**
   * Whether the renewal date moves.
   *
   * A plan change keeps the period — that is the promise this screen has always
   * made, and it is why a change on the 12th does not restart the month. A
   * **term** change cannot keep it: there is no year to be part-way through, so
   * it credits the unused days and opens a new period today. Saying "your
   * renewal date does not move" over a date that just moved is the one thing
   * this panel must not do.
   */
  renewalMoves: boolean;
}

export interface PlanChooserProps {
  plans: readonly PlanOption[];
  quoteAction: (formData: FormData) => Promise<{ ok: true; quote: ChangeQuote } | { ok: false; error: string }>;
  confirmAction: (formData: FormData) => Promise<BillingResult>;
  /** How this subscription is paid today. */
  term: BillingTerm;
  /** False where the plan is not sold by the year, which hides the control. */
  offersAnnual: boolean;
  termQuoteAction: (formData: FormData) => Promise<{ ok: true; quote: ChangeQuote } | { ok: false; error: string }>;
  termConfirmAction: (formData: FormData) => Promise<BillingResult>;
}

export function PlanChooser({
  plans,
  quoteAction,
  confirmAction,
  term,
  offersAnnual,
  termQuoteAction,
  termConfirmAction,
}: PlanChooserProps) {
  const [quote, setQuote] = useState<ChangeQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  /*
     Which pair of actions the panel below belongs to.

     One quote panel, two things that can produce it. Keeping a single panel is
     deliberate: a seller comparing a plan change against a term change wants
     the two costs in the same place and the same shape, and two panels would
     invite them to read one while the other was stale.
  */
  const [asking, setAsking] = useState<"plan" | "term">("plan");

  function askTerm(to: BillingTerm) {
    const form = new FormData();
    form.set("term", to);
    setError(null);
    setAsking("term");
    startTransition(async () => {
      const result = await termQuoteAction(form);
      if (!result.ok) {
        setError(result.error);
        setQuote(null);
        return;
      }
      setQuote(result.quote);
    });
  }

  function ask(planId: string) {
    const form = new FormData();
    form.set("planId", planId);
    setError(null);
    setAsking("plan");
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
    form.set(asking === "term" ? "term" : "planId", quote.planId);
    startTransition(async () => {
      const result = await (asking === "term" ? termConfirmAction : confirmAction)(form);
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

      {offersAnnual && (
        /*
           The term, above the plans and not among them.

           An annual Pro is the same plan on a different payment schedule, not a
           fourth card — putting it in the grid would give `Business.planId` two
           answers and this screen six things to choose between.
        */
        <Panel title={t("change.term_heading")} description={t("change.term_note")}>
          <SegmentedControl<BillingTerm>
            label={t("change.term_heading")}
            value={term}
            onChange={(next) => {
              if (next !== term) askTerm(next);
            }}
            options={[
              { value: "monthly", label: t("subscription.term.monthly") },
              { value: "annual", label: t("subscription.term.annual") },
            ]}
          />
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {plans.map((plan) => (
          <PlanCard
            key={plan.id}
            name={plan.name}
            headingLevel={2}
            monthlyPriceAed={plan.monthlyPriceAed}
            priceLabel={
              term === "annual" && plan.annualPriceLabel !== null
                ? plan.annualPriceLabel
                : plan.priceLabel
            }
            periodLabel={
              term === "annual" && plan.annualPriceLabel !== null
                ? t("pricing.per_year")
                : t("plan.period")
            }
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
            {quote.renewalMoves
              ? t("change.renews_moved", { when: quote.renewsAt })
              : t("change.renews_unchanged", { when: quote.renewsAt })}
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
