"use client";

import { useRouter } from "next/navigation";
import { DataTable, type Column } from "@/components/structure";
import { StatusBadge } from "@/components/display";
import { formatCount, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Board 12a's run list. A client component because `Column.render` is a
 * function, which a server component cannot pass.
 */

export interface RunRow {
  id: string;
  source: string;
  filename: string;
  status: string;
  rowCount: number;
  stagedCount: number;
  rejectedCount: number;
  createdAt: Date;
}

export function RunTable({ rows }: { rows: readonly RunRow[] }) {
  const router = useRouter();

  const columns: Column<RunRow>[] = [
    {
      key: "source",
      header: t("admin.ingest.col.source"),
      render: (row) => (
        <span className="flex flex-col">
          <span className="text-ink">{row.source}</span>
          <span className="font-mono text-eyebrow text-faint">{row.filename}</span>
        </span>
      ),
    },
    {
      key: "rows",
      header: t("admin.ingest.col.rows"),
      numeric: true,
      width: "7rem",
      render: (row) => formatCount(row.rowCount),
    },
    {
      key: "staged",
      header: t("admin.ingest.col.staged"),
      numeric: true,
      width: "7rem",
      render: (row) => formatCount(row.stagedCount),
    },
    {
      key: "rejected",
      header: t("admin.ingest.col.rejected"),
      numeric: true,
      width: "7rem",
      render: (row) => (
        <span className={row.rejectedCount > 0 ? "text-warn-ink" : "text-muted"}>
          {formatCount(row.rejectedCount)}
        </span>
      ),
    },
    {
      key: "status",
      header: t("admin.ingest.col.status"),
      width: "8rem",
      render: (row) => (
        <StatusBadge tone={row.status === "approved" ? "ok" : row.status === "discarded" ? "neutral" : "warn"}>
          {row.status}
        </StatusBadge>
      ),
    },
    {
      key: "when",
      header: t("admin.ingest.col.when"),
      width: "9rem",
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
      stickyHeader
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
          <p className="mx-auto mt-1 max-w-prose text-caption text-muted">
            {t("admin.ingest.empty.body")}
          </p>
        </div>
      }
    />
  );
}
