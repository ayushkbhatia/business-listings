"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, StatusBadge } from "@/components/display";
import { DataTable, type Column } from "@/components/structure";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { ReasonModal } from "../ReasonModal";
import type { ActionResult } from "./actions";

/**
 * Board 12b — the thirty days, reachable.
 *
 * Every decision on the screen is reversible for thirty days: a pair decided
 * by hand, a bulk merge as one unit (B4), and merges made before pairs carried
 * their own state. Criterion 9 says a reversal restores both records exactly,
 * so the row names what will come back rather than only offering a button.
 *
 * The days remaining are the column that matters — the refusal past the window
 * is real, and somebody reading this table is usually deciding whether they
 * still can.
 */

export interface ReversibleTableRow {
  kind: "pair" | "batch" | "merge";
  id: string;
  decision: string;
  owner: string | null;
  reason: string;
  decidedBy: string;
  daysLeft: number;
}

export interface ReversibleTableProps {
  rows: readonly ReversibleTableRow[];
  reverse: (formData: FormData) => Promise<ActionResult>;
}

export function ReversibleTable({ rows, reverse }: ReversibleTableProps) {
  const router = useRouter();
  const [target, setTarget] = useState<ReversibleTableRow | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);

  const columns: Column<ReversibleTableRow>[] = [
    {
      key: "decision",
      header: t("admin.dedupe.col.decision"),
      render: (row) => (
        <span className="flex flex-col gap-1">
          <span className="text-ink">{row.decision}</span>
          <span className="flex flex-wrap items-center gap-2 text-caption text-muted">
            {row.decidedBy}
            {row.owner && (
              <StatusBadge size="sm" tone={row.owner === "awaiting" ? "warn" : "neutral"}>
                {t(`admin.dedupe.owner.${row.owner as "awaiting" | "informed" | "confirmed"}`)}
              </StatusBadge>
            )}
          </span>
        </span>
      ),
    },
    {
      key: "reason",
      header: t("admin.dedupe.col.reason"),
      render: (row) => <span className="text-body">{row.reason}</span>,
      hideBelow: "md",
    },
    {
      key: "left",
      header: t("admin.dedupe.col.days_left"),
      numeric: true,
      width: "9rem",
      render: (row) => t("admin.dedupe.days_left", { count: row.daysLeft, n: formatCount(row.daysLeft) }),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {result && (
        <Alert
          tone={result.ok ? "ok" : "bad"}
          live={result.ok ? "polite" : "assertive"}
          {...(result.ok ? {} : { fix: t("admin.dedupe.error.fix") })}
        >
          {result.ok ? result.message : result.error}
        </Alert>
      )}

      <DataTable
        caption={t("admin.dedupe.reversible_caption")}
        columns={columns}
        rows={rows}
        rowKey={(row) => `${row.kind}:${row.id}`}
        rowAction={(row) =>
          row.owner === "confirmed"
            ? null
            : {
                label: t("admin.dedupe.unmerge"),
                onSelect: () => {
                  setResult(null);
                  setTarget(row);
                },
              }
        }
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

      <ReasonModal
        open={target !== null}
        onClose={() => setTarget(null)}
        title={t("admin.dedupe.unmerge_title")}
        description={t(
          target?.kind === "batch" ? "admin.dedupe.unmerge_batch_description" : "admin.dedupe.unmerge_description",
        )}
        confirmLabel={t("admin.dedupe.unmerge")}
        destructive
        fields={target ? { kind: target.kind, id: target.id } : {}}
        reasonHint={t("admin.dedupe.reason_hint_decision")}
        action={reverse}
        onDone={(outcome) => {
          setTarget(null);
          setResult(outcome);
          router.refresh();
        }}
      >
        {target && <p className="text-body-sm text-ink">{target.decision}</p>}
      </ReasonModal>
    </div>
  );
}
