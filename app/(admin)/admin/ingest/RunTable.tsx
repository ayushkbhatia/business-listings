"use client";

import { useRouter } from "next/navigation";
import { DataTable, type Column } from "@/components/structure";
import { StatusBadge } from "@/components/display";
import { formatCount, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Board 12a's run list. A client component because `Column.render` is a
 * function, which a server component cannot pass.
 *
 * The columns are the board's buckets — new, waiting, duplicates, rejected —
 * so a run's shape reads across a row without opening it, and a staged run is
 * tinted: a run nobody decides is thousands of companies not in the directory.
 */

export interface RunRow {
  id: string;
  number: number;
  source: string;
  filename: string;
  status: string;
  rowCount: number;
  stagedCount: number;
  queuedCount: number;
  duplicateCount: number;
  rejectedCount: number;
  createdAt: Date;
}

const TONE: Record<string, "ok" | "warn" | "bad" | "neutral" | "info"> = {
  parsing: "info",
  staged: "warn",
  approved: "ok",
  discarded: "neutral",
  rolled_back: "bad",
};

export function RunTable({ rows }: { rows: readonly RunRow[] }) {
  const router = useRouter();

  const count = (value: number, tone?: string) => (
    <span className={value > 0 && tone ? tone : "text-body"}>{formatCount(value)}</span>
  );

  const columns: Column<RunRow>[] = [
    {
      key: "run",
      header: t("admin.ingest.col.run"),
      render: (row) => (
        <span className="flex flex-col">
          <span className="text-ink">{t("admin.run.title", { number: row.number, source: row.source })}</span>
          <span className="font-mono text-eyebrow text-body">{row.filename}</span>
        </span>
      ),
    },
    {
      key: "rows",
      header: t("admin.ingest.col.rows"),
      numeric: true,
      width: "6rem",
      render: (row) => formatCount(row.rowCount),
    },
    {
      key: "new",
      header: t("admin.ingest.col.new"),
      numeric: true,
      width: "6rem",
      render: (row) => formatCount(row.stagedCount),
    },
    {
      key: "queued",
      header: t("admin.ingest.col.queued"),
      numeric: true,
      width: "6rem",
      hideBelow: "md",
      render: (row) => count(row.queuedCount, "text-warn-ink"),
    },
    {
      key: "duplicates",
      header: t("admin.ingest.col.duplicates"),
      numeric: true,
      width: "7rem",
      hideBelow: "lg",
      render: (row) => count(row.duplicateCount),
    },
    {
      key: "rejected",
      header: t("admin.ingest.col.rejected"),
      numeric: true,
      width: "6rem",
      render: (row) => count(row.rejectedCount, "text-bad-ink"),
    },
    {
      key: "status",
      header: t("admin.ingest.col.status"),
      width: "9rem",
      render: (row) => (
        <StatusBadge tone={TONE[row.status] ?? "neutral"}>
          {t(`admin.ingest.status.${row.status as "staged"}`)}
        </StatusBadge>
      ),
    },
    {
      key: "when",
      header: t("admin.ingest.col.when"),
      width: "8rem",
      hideBelow: "md",
      render: (row) => formatDate(row.createdAt),
    },
  ];

  return (
    <DataTable
      caption={t("admin.ingest.caption")}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      onRowClick={(row) => router.push(`/admin/ingest/${row.id}`)}
      rowAction={(row) => ({
        label: t("admin.ingest.open"),
        onSelect: () => router.push(`/admin/ingest/${row.id}`),
      })}
      actionsHeader={t("admin.ingest.open")}
      rowTone={(row) => (row.status === "staged" ? "attention" : "default")}
      empty={
        <div className="text-center">
          <p className="text-body-sm text-body">{t("admin.ingest.empty.title")}</p>
          <p className="mx-auto mt-1 max-w-prose text-caption text-body">
            {t("admin.ingest.empty.body")}
          </p>
        </div>
      }
    />
  );
}
