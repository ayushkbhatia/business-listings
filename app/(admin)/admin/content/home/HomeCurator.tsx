"use client";

import { useState, useTransition } from "react";
import { Alert, StatusBadge } from "@/components/display";
import { Checkbox, Label, Textarea } from "@/components/primitives";
import { DataTable, type Column } from "@/components/structure";
import { t } from "@/lib/i18n";
import type { ActionResult } from "./actions";

/**
 * Board 12g — which trades the home page leads with.
 *
 * A trade whose own landing page does not publish cannot be featured, and the
 * checkbox is disabled rather than the save failing: the page matrix already
 * knows the answer, so asking somebody to find out by clicking is rude.
 */

export interface HomeRowView {
  id: string;
  name: string;
  listings: string;
  publishable: boolean;
  showOnHome: boolean;
}

const MIN_REASON = 4;

export function HomeCurator({
  rows,
  save,
}: {
  rows: readonly HomeRowView[];
  save: (formData: FormData) => Promise<ActionResult>;
}) {
  const [reason, setReason] = useState("");
  const [pendingShown, setPendingShown] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const ready = reason.trim().length >= MIN_REASON;

  function toggle(row: HomeRowView, next: boolean) {
    setPendingShown((current) => ({ ...current, [row.id]: next }));
    const form = new FormData();
    form.set("categoryId", row.id);
    form.set("showOnHome", next ? "on" : "off");
    form.set("reason", reason);
    startTransition(async () => {
      const outcome = await save(form);
      setResult(outcome);
      if (outcome.ok) setReason("");
      else setPendingShown({});
    });
  }

  const columns: Column<HomeRowView>[] = [
    { key: "trade", header: t("home.col.trade"), render: (row) => row.name },
    {
      key: "listings",
      header: t("home.col.listings"),
      numeric: true,
      width: "7rem",
      render: (row) => row.listings,
    },
    {
      key: "page",
      header: t("home.col.page"),
      width: "11rem",
      render: (row) => (
        <StatusBadge tone={row.publishable ? "ok" : "warn"}>
          {row.publishable ? t("home.publishes") : t("home.thin")}
        </StatusBadge>
      ),
    },
    {
      key: "shown",
      header: t("home.col.shown"),
      width: "12rem",
      render: (row) => (
        <Checkbox
          checked={pendingShown[row.id] ?? row.showOnHome}
          // Disabled on the way in only: a trade already on the home page can
          // always come off, including one that stopped publishing.
          disabled={pending || !ready || (!row.publishable && !row.showOnHome)}
          label=""
          aria-label={t("home.toggle", { trade: row.name })}
          onChange={(event) => toggle(row, event.target.checked)}
        />
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

      <div className="max-w-md">
        <div className="flex flex-col gap-1">
          <Label htmlFor="home-reason" requirement="required" requirementLabel={t("field.required")}>
            {t("builder.reason_label")}
          </Label>
          <Textarea
            id="home-reason"
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      </div>

      <DataTable
        caption={t("home.caption")}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        empty={
          <div className="text-center">
            <p className="text-body-sm text-body">{t("home.empty")}</p>
          </div>
        }
      />
    </div>
  );
}
