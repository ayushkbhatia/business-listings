"use client";

import { useState, useTransition } from "react";
import { Button, Input } from "@/components/primitives";
import { DataTable, type Column } from "@/components/structure";
import { Alert, Tag } from "@/components/display";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { ActionResult } from "./actions";

/**
 * Board 12b — the confidence bands.
 *
 * Banded rather than sorted, so the safe pile and the one that needs a person
 * are visibly two different piles. The **why** column is the point: a score on
 * its own is a feeling, and in the middle band a person needs to see that two
 * listings share a phone number and nothing else.
 *
 * **History at risk** sits next to the buttons for the same reason board 4c
 * puts waiting buyers there. Merging two genuinely separate companies destroys
 * reviews, and the number of reviews is the size of the mistake.
 */

export interface Signal {
  key: string;
  strength: number;
  detail: string;
}

export interface CandidateRow {
  id: string;
  score: number;
  band: string;
  signals: Signal[];
  keepId: string;
  keepName: string;
  keepSlug: string;
  absorbId: string;
  absorbName: string;
  absorbSlug: string;
  reviewsAtRisk: number;
  enquiriesAtRisk: number;
}

export interface DedupeTableProps {
  rows: readonly CandidateRow[];
  merge: (formData: FormData) => Promise<ActionResult>;
  dismiss: (formData: FormData) => Promise<ActionResult>;
}

const MIN_REASON = 4;

export function DedupeTable({ rows, merge, dismiss }: DedupeTableProps) {
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function act(row: CandidateRow, action: (form: FormData) => Promise<ActionResult>) {
    const form = new FormData();
    form.set("candidateId", row.id);
    form.set("keepId", row.keepId);
    form.set("absorbId", row.absorbId);
    form.set("reason", reason);
    startTransition(async () => {
      const outcome = await action(form);
      setResult(outcome);
      if (outcome.ok) {
        setOpen(null);
        setReason("");
      }
    });
  }

  const columns: Column<CandidateRow>[] = [
    {
      key: "pair",
      header: t("admin.dedupe.col.pair"),
      render: (row) => (
        <span className="flex flex-col gap-0.5">
          <span className="text-ink">
            {row.keepName}{" "}
            <span className="font-mono text-eyebrow uppercase text-faint">
              {t("admin.dedupe.keeps")}
            </span>
          </span>
          <span className="text-muted">
            {row.absorbName}{" "}
            <span className="font-mono text-eyebrow uppercase text-faint">
              {t("admin.dedupe.absorbed")}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: "why",
      header: t("admin.dedupe.col.why"),
      render: (row) => (
        <span className="flex flex-wrap gap-1">
          {row.signals.map((signal) => (
            <Tag key={signal.key} size="sm">
              {t(`admin.dedupe.signal.${signal.key}` as never)}
            </Tag>
          ))}
        </span>
      ),
    },
    {
      key: "history",
      header: t("admin.dedupe.col.history"),
      width: "12rem",
      hideBelow: "lg",
      render: (row) => (
        <span className={row.reviewsAtRisk > 0 ? "text-warn-ink" : "text-muted"}>
          {t("admin.dedupe.history", {
            reviews: formatCount(row.reviewsAtRisk),
            enquiries: formatCount(row.enquiriesAtRisk),
          })}
        </span>
      ),
    },
    {
      key: "score",
      header: t("admin.dedupe.col.score"),
      numeric: true,
      width: "6rem",
      mono: true,
      render: (row) => `${Math.round(row.score * 100)}%`,
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <DataTable
        caption={t("admin.dedupe.caption")}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        stickyHeader
        groupBy={(row) => row.band}
        groupLabel={(key, count) =>
          key === "certain"
            ? t("admin.dedupe.band.certain", { count: formatCount(count) })
            : t("admin.dedupe.band.probable", { count: formatCount(count) })
        }
        rowTone={(row) => (row.band === "probable" ? "attention" : "default")}
        rowAction={(row) => ({
          label: t("admin.dedupe.merge"),
          onSelect: () => {
            setOpen(row.id);
            setResult(null);
          },
        })}
        actionsHeader={t("admin.dedupe.merge")}
        empty={
          <div className="text-center">
            <p className="text-body-sm text-body">{t("admin.dedupe.empty.title")}</p>
            <p className="mx-auto mt-1 max-w-prose text-caption text-muted">
              {t("admin.dedupe.empty.body")}
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
          <Button
            disabled={reason.trim().length < MIN_REASON || pending}
            onClick={() => act(rows.find((r) => r.id === open)!, merge)}
          >
            {t("admin.dedupe.merge")}
          </Button>
          <Button
            variant="secondary"
            disabled={reason.trim().length < MIN_REASON || pending}
            onClick={() => act(rows.find((r) => r.id === open)!, dismiss)}
          >
            {t("admin.dedupe.dismiss")}
          </Button>
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
