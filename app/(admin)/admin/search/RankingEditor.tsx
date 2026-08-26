"use client";

import { useState, useTransition } from "react";
import { Alert, StatusBadge } from "@/components/display";
import { Button, Input, Label, Textarea } from "@/components/primitives";
import { DataTable, Panel, type Column } from "@/components/structure";
// From `ranking.ts`, which is pure. `settings.ts` is server-only.
import { PLAN_TIER_CEILING, WEIGHT_KEYS } from "@/lib/search/ranking";
import { t } from "@/lib/i18n";
import type { ActionResult } from "./actions";

/**
 * Board 12c — what decides the order, and who we moved by hand.
 *
 * The plan weight has a ceiling in the database as well as here, and the copy
 * says why: a directory that sells its way to the top is one nobody comes back
 * to, and the subscription only holds if being found is worth paying for.
 */

export interface BoostRowView {
  id: string;
  businessName: string;
  points: string;
  reason: string;
  expires: string;
  expired: boolean;
}

const MIN_REASON = 4;

export function RankingEditor({
  weights,
  boosts,
  saveWeights,
  addBoost,
}: {
  weights: Record<string, number>;
  boosts: readonly BoostRowView[];
  saveWeights: (formData: FormData) => Promise<ActionResult>;
  addBoost: (formData: FormData) => Promise<ActionResult>;
}) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(WEIGHT_KEYS.map((key) => [key, String(weights[key] ?? 0)])),
  );
  const [reason, setReason] = useState("");
  const [businessId, setBusinessId] = useState("");
  const [points, setPoints] = useState("5");
  const [expiresAt, setExpires] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const ready = reason.trim().length >= MIN_REASON;

  function send(action: (formData: FormData) => Promise<ActionResult>, fields: Record<string, string>) {
    const form = new FormData();
    form.set("reason", reason);
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    startTransition(async () => {
      const outcome = await action(form);
      setResult(outcome);
      if (outcome.ok) setReason("");
    });
  }

  const columns: Column<BoostRowView>[] = [
    { key: "business", header: t("ranking.col.business"), render: (row) => row.businessName },
    {
      key: "points",
      header: t("ranking.col.points"),
      numeric: true,
      width: "6rem",
      render: (row) => row.points,
    },
    { key: "reason", header: t("ranking.col.reason"), render: (row) => row.reason },
    {
      key: "expires",
      header: t("ranking.col.expires"),
      mono: true,
      width: "8rem",
      render: (row) => row.expires,
    },
    {
      key: "state",
      header: t("ranking.col.state"),
      width: "7rem",
      render: (row) => (
        <StatusBadge tone={row.expired ? "neutral" : "ok"}>
          {row.expired ? t("ranking.expired") : t("ranking.live")}
        </StatusBadge>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-[var(--gutter)]">
      {result && (
        <Alert tone={result.ok ? "ok" : "bad"} live="assertive">
          {result.ok ? result.message : result.error}
        </Alert>
      )}

      <div className="flex flex-col gap-1">
        <Label
          htmlFor="ranking-reason"
          requirement="required"
          requirementLabel={t("field.required")}
        >
          {t("builder.reason_label")}
        </Label>
        <Textarea
          id="ranking-reason"
          rows={2}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>

      <Panel title={t("ranking.weights")} description={t("ranking.weights_hint")}>
        <div className="grid gap-4 sm:grid-cols-3">
          {WEIGHT_KEYS.map((key) => (
            <div key={key} className="flex flex-col gap-1">
              <Label
                htmlFor={`weight-${key}`}
                {...(key === "planTier" ? { hint: t("ranking.plan_cap") } : {})}
              >
                {t(`ranking.weight.${key}` as never)}
              </Label>
              <Input
                id={`weight-${key}`}
                inputMode="numeric"
                value={values[key] ?? "0"}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [key]: event.target.value }))
                }
              />
              {key === "planTier" && Number(values[key]) > PLAN_TIER_CEILING && (
                <p className="text-caption text-bad-ink">{t("ranking.plan_cap")}</p>
              )}
            </div>
          ))}
        </div>

        <div className="mt-4">
          <Button
            disabled={!ready || pending}
            onClick={() => send(saveWeights, values as Record<string, string>)}
          >
            {t("ranking.save")}
          </Button>
        </div>
      </Panel>

      <Panel title={t("ranking.add_boost")} description={t("ranking.boosts_hint")}>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="boost-business">{t("ranking.business_id")}</Label>
            <Input
              id="boost-business"
              mono
              value={businessId}
              onChange={(event) => setBusinessId(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="boost-points" hint={t("ranking.points_hint")}>
              {t("ranking.points")}
            </Label>
            <Input
              id="boost-points"
              inputMode="numeric"
              value={points}
              onChange={(event) => setPoints(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="boost-expires" hint={t("ranking.expires_hint")}>
              {t("ranking.expires")}
            </Label>
            <Input
              id="boost-expires"
              type="date"
              value={expiresAt}
              onChange={(event) => setExpires(event.target.value)}
            />
          </div>
        </div>

        <div className="mt-4">
          <Button
            disabled={!ready || pending || !businessId.trim() || !expiresAt}
            onClick={() => send(addBoost, { businessId, points, expiresAt })}
          >
            {t("ranking.boost")}
          </Button>
        </div>
      </Panel>

      <DataTable
        caption={t("ranking.boosts")}
        columns={columns}
        rows={boosts}
        rowKey={(row) => row.id}
        stickyHeader
        empty={
          <div className="text-center">
            <p className="text-body-sm text-body">{t("ranking.boosts_empty")}</p>
          </div>
        }
      />
    </div>
  );
}
