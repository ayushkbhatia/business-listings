"use client";

import { DataTable, Panel, type Column } from "@/components/structure";
import { t } from "@/lib/i18n";

/**
 * Every published ranking change, newest first.
 *
 * `RankingWeights` is a single mutable row, so before this the platform could
 * say what the ranking *is* and never what it *was* — and `staffMutation`
 * recorded only the weights that moved rather than the vector they moved to.
 *
 * A draft that was never published is not here. It reordered nothing, told
 * nobody, and a history of intentions is not a history of what happened.
 *
 * `What moved` is computed against the previous row rather than stored: a
 * stored diff and a stored vector are two facts that can disagree, and only one
 * of them is the thing that went live.
 */

export interface HistoryRowView {
  id: string;
  when: string;
  vector: string;
  /** "Reply 18 → 24 · Relevance 34 → 28", or the first-vector line. */
  moved: string;
  reason: string;
  author: string;
  /** "431", or an em dash where the row predates the count being recorded. */
  told: string;
}

export function HistoryTable({ rows }: { rows: readonly HistoryRowView[] }) {
  const columns: Column<HistoryRowView>[] = [
    {
      key: "when",
      header: t("ranking.history.col.when"),
      mono: true,
      width: "11rem",
      render: (row) => row.when,
    },
    {
      key: "moved",
      header: t("ranking.history.col.moved"),
      render: (row) => (
        <span className="flex flex-col gap-0.5">
          <span>{row.moved}</span>
          <span className="font-mono text-eyebrow tabular-nums text-body">{row.vector}</span>
        </span>
      ),
    },
    { key: "reason", header: t("ranking.history.col.reason"), render: (row) => row.reason },
    {
      key: "author",
      header: t("ranking.history.col.author"),
      width: "9rem",
      render: (row) => row.author,
    },
    {
      key: "told",
      header: t("ranking.history.col.told"),
      numeric: true,
      width: "8rem",
      render: (row) => row.told,
    },
  ];

  return (
    <Panel title={t("ranking.history")} description={t("ranking.history_hint")}>
      <DataTable
        caption={t("ranking.history.caption")}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        stickyHeader
        empty={
          <div className="text-center">
            <p className="text-body-sm text-body">{t("ranking.history.empty")}</p>
          </div>
        }
      />
    </Panel>
  );
}
