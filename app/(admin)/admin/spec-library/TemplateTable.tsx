"use client";

import { DataTable, type Column } from "@/components/structure";
import { StatusBadge } from "@/components/display";
import type { TemplateSummary } from "@/lib/spec/versions";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Board 4e's table. A client component for the same reason board 4d's is:
 * `Column.render` is a function, and a server component cannot pass one.
 */

export function TemplateTable({ rows }: { rows: readonly TemplateSummary[] }) {
  const columns: Column<TemplateSummary>[] = [
    {
      key: "template",
      header: t("admin.spec.col.template"),
      render: (row) => row.name,
    },
    {
      key: "category",
      header: t("admin.spec.col.category"),
      render: (row) => row.categoryName,
    },
    {
      key: "version",
      header: t("admin.spec.col.version"),
      numeric: true,
      width: "6rem",
      mono: true,
      render: (row) => `v${row.version}`,
    },
    {
      key: "fields",
      header: t("admin.spec.col.fields"),
      width: "13rem",
      render: (row) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <span>
            {t("admin.spec.fields_value", {
              total: formatCount(row.fields),
              required: formatCount(row.requiredFields),
            })}
          </span>
          {row.inGrace > 0 && (
            <span className="rounded-chip bg-warn-surface px-1.5 py-px font-mono text-eyebrow uppercase text-warn-ink">
              {t("admin.spec.in_grace", { count: formatCount(row.inGrace) })}
            </span>
          )}
        </span>
      ),
    },
    {
      key: "clones",
      header: t("admin.spec.col.clones"),
      numeric: true,
      width: "7rem",
      hideBelow: "md",
      render: (row) => formatCount(row.clones),
    },
    {
      key: "status",
      header: t("admin.spec.col.status"),
      width: "8rem",
      render: (row) => (
        <StatusBadge tone={row.status === "live" ? "ok" : "neutral"}>{row.status}</StatusBadge>
      ),
    },
  ];

  return (
    <DataTable
      caption={t("admin.spec.caption")}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      stickyHeader
      rowTone={(row) => (row.inGrace > 0 ? "attention" : "default")}
      empty={
        <div className="text-center">
          <p className="text-body-sm text-body">{t("admin.spec.empty.title")}</p>
          <p className="mx-auto mt-1 max-w-prose text-caption text-muted">
            {t("admin.spec.empty.body")}
          </p>
        </div>
      }
    />
  );
}
