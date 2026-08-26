"use client";

import { StatusBadge } from "@/components/display";
import { DataTable, type Column } from "@/components/structure";
import { t } from "@/lib/i18n";

/**
 * The templates, and what an edit to each would move.
 *
 * The store count is the column that matters. Every screen that can change a
 * template has to make the blast radius visible before the save, and the list
 * is where somebody decides which template to open.
 */

export interface TemplateRowView {
  id: string;
  name: string;
  sectorName: string;
  status: string;
  version: string;
  sections: string;
  storeCount: string;
}

const TONE: Record<string, "ok" | "warn" | "neutral"> = {
  live: "ok",
  draft: "warn",
  retired: "neutral",
};

export function TemplateTable({ rows }: { rows: readonly TemplateRowView[] }) {
  const columns: Column<TemplateRowView>[] = [
    { key: "sector", header: t("admin.templates.col.sector"), render: (row) => row.sectorName },
    { key: "name", header: t("admin.templates.col.name"), render: (row) => row.name },
    {
      key: "status",
      header: t("admin.templates.col.status"),
      width: "7rem",
      render: (row) => (
        <StatusBadge tone={TONE[row.status] ?? "neutral"}>
          {t(`admin.templates.status.${row.status}` as never)}
        </StatusBadge>
      ),
    },
    {
      key: "version",
      header: t("admin.templates.col.version"),
      mono: true,
      width: "6rem",
      hideBelow: "md",
      render: (row) => row.version,
    },
    {
      key: "sections",
      header: t("admin.templates.col.sections"),
      numeric: true,
      width: "8rem",
      render: (row) => row.sections,
    },
    {
      key: "stores",
      header: t("admin.templates.col.stores"),
      numeric: true,
      width: "8rem",
      render: (row) => <span className="text-ink">{row.storeCount}</span>,
    },
  ];

  return (
    <DataTable
      caption={t("admin.templates.caption")}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      stickyHeader
      empty={
        <div className="text-center">
          <p className="text-body-sm text-body">{t("admin.templates.empty.title")}</p>
          <p className="mx-auto mt-1 max-w-prose text-caption text-muted">
            {t("admin.templates.empty.body")}
          </p>
        </div>
      }
    />
  );
}
