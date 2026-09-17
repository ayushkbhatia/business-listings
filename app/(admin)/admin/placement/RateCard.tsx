"use client";

import { useId, useState, useTransition } from "react";
import { Alert, StatusBadge } from "@/components/display";
import { Button, Input, Label, Textarea } from "@/components/primitives";
import { formatAED, formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { RateResult } from "./actions";

/**
 * The ten rungs, and the two numbers that generate them.
 *
 * Board `11e`, and the owner's instruction: the price of a sponsored slot moves
 * as we learn what sells, without a deploy. So this edits rows.
 *
 * ## The occupancy column is why the screen is worth opening
 *
 * A rate card on its own is ten prices with nothing to judge them against.
 * Beside each rung is how many scopes are actually in it — a band holding two
 * hundred scopes and one holding none are very different arguments about what
 * that rung should cost, and both are facts about the directory rather than
 * opinions about the price.
 */

export interface Rung {
  band: number;
  monthlyPriceAed: number;
  /** Set by hand, so the next curve change leaves it alone. */
  override: boolean;
  /** Scopes sitting in this band today. */
  scopes: number;
}

export interface RateCardProps {
  rungs: readonly Rung[];
  basePriceAed: number;
  /** Already a percentage — 10 for a tenth a band. */
  stepPercent: number;
  canEdit: boolean;
  saveCurve: (formData: FormData) => Promise<RateResult>;
  saveBandPrice: (formData: FormData) => Promise<RateResult>;
}

const MIN_REASON = 4;

export function RateCard({
  rungs,
  basePriceAed,
  stepPercent,
  canEdit,
  saveCurve,
  saveBandPrice,
}: RateCardProps) {
  const [base, setBase] = useState(String(basePriceAed));
  const [step, setStep] = useState(String(stepPercent));
  const [editing, setEditing] = useState<number | null>(null);
  const [price, setPrice] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<RateResult | null>(null);
  const [pending, startTransition] = useTransition();
  const field = useId();

  const ready = reason.trim().length >= MIN_REASON;

  function run(action: (form: FormData) => Promise<RateResult>, form: FormData) {
    form.set("reason", reason);
    startTransition(async () => {
      const outcome = await action(form);
      setResult(outcome);
      if (outcome.ok) {
        setReason("");
        setEditing(null);
      }
    });
  }

  return (
    <div className="flex flex-col gap-[var(--gutter)]">
      {result && (
        <Alert tone={result.ok ? "ok" : "bad"} live="assertive">
          {result.ok ? result.message : result.error}
        </Alert>
      )}

      <table className="w-full border-collapse text-left">
        <caption className="sr-only">{t("admin.placement.caption")}</caption>
        <thead>
          <tr className="bg-paper-sunk">
            <th scope="col" className="px-3 py-2 font-mono text-colhead uppercase text-muted">
              {t("admin.placement.col.band")}
            </th>
            <th scope="col" className="px-3 py-2 font-mono text-colhead uppercase text-muted">
              {t("admin.placement.col.price")}
            </th>
            <th scope="col" className="px-3 py-2 font-mono text-colhead uppercase text-muted">
              {t("admin.placement.col.scopes")}
            </th>
            {canEdit && (
              <th scope="col" className="px-3 py-2 font-mono text-colhead uppercase text-muted">
                {t("admin.placement.col.set")}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rungs.map((rung) => (
            <tr key={rung.band}>
              <th
                scope="row"
                className="border-t border-line px-3 py-2 text-left font-mono text-caption tabular-nums font-normal text-body"
              >
                {formatCount(rung.band)}
              </th>
              <td className="border-t border-line px-3 py-2">
                {editing === rung.band ? (
                  <Input
                    size="sm"
                    mono
                    inputMode="numeric"
                    aria-label={t("admin.placement.price_for", { band: formatCount(rung.band) })}
                    value={price}
                    onChange={(event) => setPrice(event.target.value)}
                  />
                ) : (
                  <span className="flex items-center gap-2 font-mono text-caption tabular-nums text-ink">
                    {formatAED(rung.monthlyPriceAed)}
                    {rung.override && (
                      <StatusBadge tone="neutral">{t("admin.placement.by_hand")}</StatusBadge>
                    )}
                  </span>
                )}
              </td>
              <td className="border-t border-line px-3 py-2 font-mono text-caption tabular-nums text-muted">
                {rung.scopes === 0 ? t("admin.placement.no_scopes") : formatCount(rung.scopes)}
              </td>
              {canEdit && (
                <td className="border-t border-line px-3 py-2">
                  {editing === rung.band ? (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={!ready || pending}
                        onClick={() => {
                          const form = new FormData();
                          form.set("band", String(rung.band));
                          form.set("monthlyPriceAed", price.trim());
                          run(saveBandPrice, form);
                        }}
                      >
                        {t("action.save")}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                        {t("action.cancel")}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setEditing(rung.band);
                        setPrice(String(rung.monthlyPriceAed));
                        setResult(null);
                      }}
                    >
                      {t("admin.placement.set_price")}
                    </Button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {canEdit && (
        <div className="rounded-panel border border-line bg-card p-4">
          <h3 className="text-h3 text-ink">{t("admin.placement.curve_title")}</h3>
          <p className="mt-1 max-w-prose text-caption text-muted">
            {t("admin.placement.curve_body")}
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${field}-base`} hint={t("admin.placement.base_hint")}>
                {t("admin.placement.base")}
              </Label>
              <Input
                id={`${field}-base`}
                mono
                inputMode="numeric"
                value={base}
                onChange={(event) => setBase(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${field}-step`} hint={t("admin.placement.step_hint")}>
                {t("admin.placement.step")}
              </Label>
              <Input
                id={`${field}-step`}
                mono
                inputMode="decimal"
                suffix="%"
                value={step}
                onChange={(event) => setStep(event.target.value)}
              />
            </div>
          </div>

          <div className="mt-3">
            <Button
              disabled={!ready || pending}
              onClick={() => {
                const form = new FormData();
                form.set("basePriceAed", base.trim());
                form.set("stepPercent", step.trim());
                run(saveCurve, form);
              }}
            >
              {t("admin.placement.regenerate")}
            </Button>
          </div>
        </div>
      )}

      {canEdit && (
        <div className="flex flex-col gap-1">
          <Label
            htmlFor={`${field}-reason`}
            requirement="required"
            requirementLabel={t("field.required")}
            hint={t("admin.placement.reason_hint")}
          >
            {t("admin.plans.reason_label")}
          </Label>
          <Textarea
            id={`${field}-reason`}
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      )}
    </div>
  );
}
