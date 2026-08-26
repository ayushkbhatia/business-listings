"use client";

import { DataTable, type Column } from "@/components/structure";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Board 4i's log.
 *
 * The reason column is the widest one on purpose. Every other column is an
 * identifier; the reason is the only part a person wrote, and it is the only
 * part that answers "why" a year later.
 */

export interface AuditRowData {
  id: string;
  when: Date;
  who: string;
  action: string;
  subject: string;
  reason: string;
}

export function AuditTable({ rows }: { rows: readonly AuditRowData[] }) {
  const columns: Column<AuditRowData>[] = [
    {
      key: "when",
      header: t("admin.audit.col.when"),
      width: "9rem",
      render: (row) => formatDate(row.when),
    },
    {
      key: "who",
      header: t("admin.audit.col.who"),
      width: "10rem",
      hideBelow: "md",
      render: (row) => row.who,
    },
    {
      key: "action",
      header: t("admin.audit.col.action"),
      width: "12rem",
      mono: true,
      render: (row) => row.action,
    },
    {
      key: "subject",
      header: t("admin.audit.col.subject"),
      width: "14rem",
      mono: true,
      hideBelow: "lg",
      render: (row) => row.subject,
    },
    {
      key: "reason",
      header: t("admin.audit.col.reason"),
      render: (row) => <span className="text-body">{row.reason}</span>,
    },
  ];

  return (
    <DataTable
      caption={t("admin.audit.caption")}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      stickyHeader
      empty={
        <div className="text-center">
          <p className="text-body-sm text-body">{t("admin.audit.empty.title")}</p>
          <p className="mx-auto mt-1 max-w-prose text-caption text-muted">
            {t("admin.audit.empty.body")}
          </p>
        </div>
      }
    />
  );
}
