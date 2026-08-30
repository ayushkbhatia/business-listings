"use client";

import { useState, useTransition } from "react";
import { Button, Input } from "@/components/primitives";
import { DataTable, type Column } from "@/components/structure";
import { Alert } from "@/components/display";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { ActionResult } from "./actions";

/**
 * Board 12b — the thirty days.
 *
 * A merge is reversible for thirty days and `unmergeBusinesses` has always
 * been able to do it, from a manifest written for exactly this. Nothing listed
 * the merges, so the reversal was reachable from no screen: the window was in
 * the service, in the tests and in the note at the bottom of this page, and
 * not in anybody's hands.
 *
 * The days remaining are the column that matters. The refusal past the window
 * is real rather than a warning, and somebody looking at this table is usually
 * deciding whether they still can.
 */

export interface MergeRow {
  id: string;
  keepName: string;
  absorbName: string;
  absorbedSlug: string;
  reason: string;
  daysLeft: number;
}

const MIN_REASON = 4;

export interface MergeTableProps {
  rows: readonly MergeRow[];
  unmerge: (formData: FormData) => Promise<ActionResult>;
}

export function MergeTable({ rows, unmerge }: MergeTableProps) {
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function act(id: string) {
    const form = new FormData();
    form.set("mergeId", id);
    form.set("reason", reason);
    startTransition(async () => {
      const outcome = await unmerge(form);
      setResult(outcome);
      if (outcome.ok) {
        setOpen(null);
        setReason("");
      }
    });
  }

  const columns: Column<MergeRow>[] = [
    {
      key: "pair",
      header: t("admin.dedupe.col.merged"),
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
      key: "reason",
      header: t("admin.review.reason_label"),
      render: (row) => <span className="text-muted">{row.reason}</span>,
    },
    {
      key: "left",
      header: t("admin.dedupe.col.days_left"),
      numeric: true,
      width: "8rem",
      mono: true,
      render: (row) => t("admin.dedupe.days_left", { count: formatCount(row.daysLeft) }),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <DataTable
        caption={t("admin.dedupe.reversible_caption")}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        rowAction={(row) => ({
          label: t("admin.dedupe.unmerge"),
          onSelect: () => {
            setOpen(row.id);
            setResult(null);
          },
        })}
        actionsHeader={t("admin.dedupe.unmerge")}
        empty={
          <div className="text-center">
            <p className="text-body-sm text-body">{t("admin.dedupe.reversible_empty.title")}</p>
            <p className="mx-auto mt-1 max-w-prose text-caption text-muted">
              {t("admin.dedupe.reversible_empty.body")}
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
            onClick={() => act(open)}
          >
            {t("admin.dedupe.unmerge")}
          </Button>
          <Button variant="ghost" onClick={() => setOpen(null)}>
            {t("action.cancel")}
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
