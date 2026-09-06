"use client";

import { DataTable, type Column } from "@/components/structure";
import type { CoverageGap } from "@/lib/spec/library";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Board 4e §6 — the coverage worklist.
 *
 * A separate table from the templates one, because they are separate entities.
 * The board put a category row inside a table of templates with a `Create` link
 * in the `VERSION` column: one row type doing two jobs, and a value column
 * holding an action.
 *
 * Ranked by **products already listed in that subcategory without a template** —
 * the products that exist and cannot be filtered. That ordering is the
 * argument for the worklist; alphabetical would make it a list of names.
 *
 * A subcategory the taxonomy screen is holding back renders `On hold`, not
 * `Create`. Two screens should not both be authoring for a subcategory one of
 * them is trying to remove.
 */

export function CoverageTable({ gaps }: { gaps: readonly CoverageGap[] }) {
  const columns: Column<CoverageGap>[] = [
    {
      key: "subcategory",
      header: t("admin.spec.coverage.col.subcategory"),
      render: (row) => row.name,
    },
    {
      key: "products",
      header: t("admin.spec.coverage.col.products"),
      numeric: true,
      width: "8rem",
      mono: true,
      render: (row) => formatCount(row.products),
    },
    {
      key: "listings",
      header: t("admin.spec.coverage.col.listings"),
      numeric: true,
      width: "8rem",
      mono: true,
      render: (row) => formatCount(row.listings),
    },
    {
      key: "state",
      header: t("admin.spec.coverage.col.state"),
      width: "9rem",
      render: (row) => (
        <span className="font-mono text-eyebrow uppercase text-muted">
          {row.held ? t("admin.spec.coverage.held") : "—"}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      caption={t("admin.spec.coverage.caption")}
      columns={columns}
      rows={gaps}
      rowKey={(row) => row.id}
      stickyHeader
      empty={
        <p className="text-center text-body-sm text-body">{t("admin.spec.coverage.none")}</p>
      }
    />
  );
}
