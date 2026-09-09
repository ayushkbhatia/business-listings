"use client";

import { useState, useTransition } from "react";
import { Alert, StatusBadge } from "@/components/display";
import {
  Button,
  Input,
  Label,
  SegmentedControl,
  Select,
  Textarea,
} from "@/components/primitives";
import { DataTable, Panel, type Column } from "@/components/structure";
import { MAX_BOOST_POINTS } from "@/lib/search/ranking";
import { t } from "@/lib/i18n";
import type { ActionResult } from "./actions";

/**
 * Manual boosts — points, never percentages.
 *
 * The first render drew `+15%`. `boostListing` takes 1 to 25 **points** added
 * to a 100-point weighted sum; a percentage implies a multiplier on the score
 * and the render taught the wrong model of the thing it was drawing.
 *
 * A boost lifts one listing or one category. The category form is what makes
 * *"thin supply — surfacing the few we have"* a single decision with a single
 * reason rather than forty identical rows, and it is also why the budget counts
 * category boosts against every member business: otherwise the per-business cap
 * is walked around by aiming one category higher.
 *
 * Nothing here can lower a listing. Removing a business from results is a
 * suspension, taken on Businesses — audited, appealable, and already built.
 */

export interface BoostRowView {
  id: string;
  target: string;
  points: string;
  reason: string;
  author: string;
  expires: string;
  expired: boolean;
  /** "18 of 25 — stacks with Chiller AMC", or the per-member cost. Both null on a plain row. */
  stacking: string | null;
}

export interface BoostsTabProps {
  rows: readonly BoostRowView[];
  liveCount: number;
  mayWrite: boolean;
  emirates: readonly { value: string; label: string }[];
  addBoost: (formData: FormData) => Promise<ActionResult>;
}

type Target = "business" | "category";

export function BoostsTab({ rows, liveCount, mayWrite, emirates, addBoost }: BoostsTabProps) {
  const [target, setTarget] = useState<Target>("business");
  const [businessId, setBusinessId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [emirate, setEmirate] = useState("");
  const [points, setPoints] = useState("5");
  const [expiresAt, setExpires] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const identified = target === "business" ? businessId.trim() : categoryId.trim();
  const ready = reason.trim().length >= 4 && identified.length > 0 && expiresAt.length > 0;

  function send() {
    const form = new FormData();
    form.set("reason", reason);
    form.set("points", points);
    form.set("expiresAt", expiresAt);
    if (target === "business") {
      form.set("businessId", businessId);
    } else {
      form.set("categoryId", categoryId);
      form.set("emirate", emirate);
    }
    startTransition(async () => {
      const outcome = await addBoost(form);
      setResult(outcome);
      if (outcome.ok) {
        setReason("");
        setBusinessId("");
        setCategoryId("");
      }
    });
  }

  const columns: Column<BoostRowView>[] = [
    {
      key: "target",
      header: t("ranking.col.business"),
      render: (row) => (
        <span className="flex flex-col gap-0.5">
          <span>{row.target}</span>
          {row.stacking && <span className="text-caption text-body">{row.stacking}</span>}
        </span>
      ),
    },
    {
      key: "points",
      header: t("ranking.col.points"),
      numeric: true,
      width: "6.5rem",
      render: (row) => row.points,
    },
    { key: "reason", header: t("ranking.col.reason"), render: (row) => row.reason },
    { key: "author", header: t("ranking.col.author"), width: "9rem", render: (row) => row.author },
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

      {mayWrite && (
        <Panel title={t("ranking.add_boost")} description={t("ranking.boosts_hint")}>
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-caption font-medium text-ink">{t("ranking.boost_target")}</p>
              <div className="mt-1.5">
                <SegmentedControl
                  label={t("ranking.boost_target")}
                  value={target}
                  onChange={(next) => setTarget(next as Target)}
                  options={[
                    { value: "business", label: t("ranking.boost_target.business") },
                    { value: "category", label: t("ranking.boost_target.category") },
                  ]}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {target === "business" ? (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="boost-business">{t("ranking.business_id")}</Label>
                  <Input
                    id="boost-business"
                    mono
                    value={businessId}
                    onChange={(event) => setBusinessId(event.target.value)}
                  />
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="boost-category">{t("ranking.category_id")}</Label>
                    <Input
                      id="boost-category"
                      mono
                      value={categoryId}
                      onChange={(event) => setCategoryId(event.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="boost-emirate" hint={t("ranking.boost_emirate_hint")}>
                      {t("ranking.boost_emirate")}
                    </Label>
                    <Select
                      id="boost-emirate"
                      value={emirate}
                      onChange={(event) => setEmirate(event.target.value)}
                      options={[
                        { value: "", label: t("ranking.boost_emirate_all") },
                        ...emirates,
                      ]}
                    />
                  </div>
                </>
              )}

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

            <div className="flex flex-col gap-1">
              <Label
                htmlFor="boost-reason"
                requirement="required"
                requirementLabel={t("field.required")}
              >
                {t("builder.reason_label")}
              </Label>
              <Textarea
                id="boost-reason"
                rows={2}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>

            <div>
              <Button disabled={!ready || pending} onClick={send}>
                {t("ranking.boost")}
              </Button>
            </div>
          </div>
        </Panel>
      )}

      <Panel
        title={t("ranking.boosts")}
        eyebrow={t("ranking.boosts_active", { count: liveCount })}
        footer={
          <p className="max-w-prose text-caption text-body">
            {t("ranking.boosts_footer", { max: MAX_BOOST_POINTS })}
          </p>
        }
      >
        <DataTable
          caption={t("ranking.boosts")}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          stickyHeader
          empty={
            <div className="text-center">
              <p className="text-body-sm text-body">{t("ranking.boosts_empty")}</p>
            </div>
          }
        />
        <p className="mt-3 max-w-prose text-caption text-body">{t("ranking.note")}</p>
      </Panel>
    </div>
  );
}
