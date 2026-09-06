"use client";

import { useRouter } from "next/navigation";
import { DataTable, type Column } from "@/components/structure";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Board 4b — what is waiting, oldest first.
 *
 * Three kinds of row in one queue, because from a moderator's side of the desk
 * they are the same job: something is waiting for a decision. Splitting them
 * into separate screens makes "what is behind" a question you answer by adding
 * up several numbers.
 *
 * **Banded by service level, not sorted by it.** Late rows are grouped first
 * and each band keeps its own age order, so the oldest late row is the first
 * thing on the page and the oldest not-yet-late row is the first thing under
 * it. Sorting purely by age would bury a five-day-old claim under a
 * three-day-old edit that is not late at all.
 *
 * Strings are resolved here rather than passed in. A server component cannot
 * hand a function across the boundary and `t` has no server-only marker — the
 * pattern handoff 2 hit five times before it stuck.
 */

export interface QueueRow {
  id: string;
  kind: "change" | "conflict" | "document";
  /** The field for a change, or "conflict". */
  what: string;
  businessName: string;
  businessSlug: string;
  from: string | null;
  to: string | null;
  ageDays: number;
  late: boolean;
  href: string;
}

export interface QueueTableProps {
  rows: readonly QueueRow[];
  /** Set when the query failed. Never the same thing as an empty queue. */
  failed?: boolean;
}

export function QueueTable({ rows, failed = false }: QueueTableProps) {
  const router = useRouter();

  const columns: Column<QueueRow>[] = [
    {
      key: "what",
      header: t("admin.queue.col.what"),
      width: "13rem",
      render: (row) => (
        <span className="flex flex-col">
          <span className="text-ink">{labelFor(row)}</span>
          <span className="font-mono text-eyebrow uppercase text-faint">
            {row.kind === "conflict"
              ? t("admin.queue.kind.conflict")
              : row.kind === "document"
                ? t("admin.queue.kind.document")
                : t("admin.queue.kind.change")}
          </span>
        </span>
      ),
    },
    {
      key: "business",
      header: t("admin.queue.col.business"),
      render: (row) => row.businessName,
    },
    {
      key: "from",
      header: t("admin.queue.col.from"),
      hideBelow: "lg",
      render: (row) => <span className="text-muted">{row.from ?? "—"}</span>,
    },
    {
      key: "to",
      header: t("admin.queue.col.to"),
      hideBelow: "md",
      render: (row) => row.to ?? "—",
    },
    {
      key: "age",
      header: t("admin.queue.col.age"),
      numeric: true,
      width: "7rem",
      render: (row) => (
        <span className={row.late ? "text-bad-ink" : "text-muted"}>
          {t("admin.queue.age_days", { days: String(row.ageDays) })}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      caption={t("admin.queue.caption")}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      stickyHeader
      groupBy={(row) => (row.late ? "late" : "due")}
      groupLabel={(key, count) =>
        key === "late"
          ? t("admin.queue.band.late", { count: formatCount(count) })
          : t("admin.queue.band.due", { count: formatCount(count) })
      }
      rowTone={(row) => (row.late ? "attention" : "default")}
      onRowClick={(row) => router.push(row.href)}
      rowAction={(row) => ({
        label: t("admin.queue.review"),
        onSelect: () => router.push(row.href),
      })}
      actionsHeader={t("admin.queue.review")}
      empty={
        <div className="text-center">
          <p className="text-body-sm text-body">{t("admin.queue.empty.title")}</p>
          <p className="mx-auto mt-1 max-w-prose text-caption text-muted">
            {t("admin.queue.empty.body")}
          </p>
        </div>
      }
      error={
        failed ? (
          <div className="text-center">
            <p className="text-body-sm text-bad-ink">{t("admin.queue.error.title")}</p>
            <p className="mx-auto mt-1 max-w-prose text-caption text-muted">
              {t("admin.queue.error.body")}
            </p>
          </div>
        ) : undefined
      }
    />
  );
}

function labelFor(row: QueueRow): string {
  if (row.kind === "conflict") return t("admin.queue.kind.conflict");
  // What is being decided is whether it may be published, never whether the
  // certificate is true — nothing here checks an ISO number against a
  // registrar, and the label has to stop short of saying we did.
  if (row.kind === "document") return t("admin.queue.kind.document");
  if (row.what === "trade_name") return t("admin.queue.field.trade_name");
  if (row.what === "primary_category") return t("admin.queue.field.primary_category");
  return t("admin.queue.field.licence");
}
