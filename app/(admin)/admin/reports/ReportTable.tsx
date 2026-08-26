"use client";

import { useState, useTransition } from "react";
import { Button, Input } from "@/components/primitives";
import { DataTable, type Column } from "@/components/structure";
import { Alert } from "@/components/display";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { ActionResult } from "./actions";

/**
 * Board 4h — the conduct queue.
 *
 * Three outcomes, each with a reason, and no fourth. The vocabulary is the
 * feature: a supplier report is about conduct, and a queue that offered a
 * money outcome would be a queue somebody asks to move money.
 *
 * "Before" is the three-strikes column. Three buyers reporting the same wrong
 * phone number is not three opinions, it is one fact, and a moderator seeing
 * "third report of this field" decides differently.
 */

export interface ReportRow {
  id: string;
  kind: string;
  detail: string | null;
  businessName: string;
  automatic: boolean;
  priorsOnField: number;
  ageDays: number;
}

const OUTCOMES = ["seller_corrected", "upheld", "no_action"] as const;

const MIN_REASON = 4;

export function ReportTable({
  rows,
  resolve,
}: {
  rows: readonly ReportRow[];
  resolve: (formData: FormData) => Promise<ActionResult>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function send(reportId: string, outcome: string) {
    const form = new FormData();
    form.set("reportId", reportId);
    form.set("outcome", outcome);
    form.set("reason", reason);
    startTransition(async () => {
      const outcomeResult = await resolve(form);
      setResult(outcomeResult);
      if (outcomeResult.ok) {
        setOpen(null);
        setReason("");
      }
    });
  }

  const columns: Column<ReportRow>[] = [
    {
      key: "what",
      header: t("admin.reports.col.what"),
      width: "12rem",
      render: (row) => (
        <span className="flex flex-col">
          <span className="text-ink">{t(`admin.reports.kind.${row.kind}` as never)}</span>
          {row.automatic && (
            <span className="font-mono text-eyebrow uppercase text-faint">
              {t("admin.reports.automatic")}
            </span>
          )}
        </span>
      ),
    },
    {
      key: "business",
      header: t("admin.reports.col.business"),
      render: (row) => row.businessName,
    },
    {
      key: "detail",
      header: t("admin.reports.col.detail"),
      hideBelow: "lg",
      render: (row) => <span className="text-muted">{row.detail ?? "—"}</span>,
    },
    {
      key: "priors",
      header: t("admin.reports.col.priors"),
      width: "9rem",
      render: (row) =>
        row.priorsOnField > 1 ? (
          <span className="rounded-chip bg-warn-surface px-1.5 py-px font-mono text-eyebrow uppercase text-warn-ink">
            {t("admin.reports.priors", { count: formatCount(row.priorsOnField) })}
          </span>
        ) : (
          <span className="text-faint">{t("admin.reports.no_priors")}</span>
        ),
    },
    {
      key: "age",
      header: t("admin.reports.col.age"),
      numeric: true,
      width: "6rem",
      render: (row) => t("admin.queue.age_days", { days: String(row.ageDays) }),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <DataTable
        caption={t("admin.reports.caption")}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        stickyHeader
        rowTone={(row) => (row.priorsOnField > 1 ? "attention" : "default")}
        rowAction={(row) => ({
          label: t("admin.review.decision_heading"),
          onSelect: () => {
            setOpen(row.id);
            setResult(null);
          },
        })}
        actionsHeader={t("admin.review.decision_heading")}
        empty={
          <div className="text-center">
            <p className="text-body-sm text-body">{t("admin.reports.empty.title")}</p>
            <p className="mx-auto mt-1 max-w-prose text-caption text-muted">
              {t("admin.reports.empty.body")}
            </p>
          </div>
        }
      />

      {open && (
        <div className="flex flex-wrap items-end gap-2 rounded-card border border-line bg-card p-3">
          <label className="flex min-w-64 flex-1 flex-col gap-1">
            <span className="text-body-sm text-ink">{t("admin.review.reason_label")}</span>
            <Input value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          {OUTCOMES.map((outcome) => (
            <Button
              key={outcome}
              variant={outcome === "upheld" ? "primary" : "secondary"}
              disabled={reason.trim().length < MIN_REASON || pending}
              onClick={() => send(open, outcome)}
            >
              {t(`admin.reports.outcome.${outcome}` as never)}
            </Button>
          ))}
        </div>
      )}

      {result && (
        <Alert
          tone={result.ok ? "ok" : "bad"}
          live={result.ok ? "polite" : "assertive"}
          {...(result.ok ? {} : { fix: t("admin.review.reason_hint") })}
        >
          {result.ok ? result.message : result.error}
        </Alert>
      )}
    </div>
  );
}
