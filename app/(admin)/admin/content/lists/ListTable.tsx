"use client";

import Link from "next/link";
import { StatusBadge } from "@/components/display";
import { DataTable, type Column } from "@/components/structure";
import { t } from "@/lib/i18n";

/**
 * The curated-list index table.
 *
 * A client component because `DataTable` is one, and a `Column.render` is a
 * function: passing the column array down from the server page is the repo's
 * most repeated defect and a runtime error on the rendered page rather than a
 * build error. `tests/unit/client-labels.test.ts` catches it, and it caught
 * this.
 */

export interface ListRowView {
  id: string;
  title: string;
  slug: string;
  categoryName: string;
  members: string;
  state: "published" | "overdue" | "draft";
  audited: string;
  due: string;
  drift: string;
}

export function ListTable({ rows }: { rows: readonly ListRowView[] }) {
  const columns: Column<ListRowView>[] = [
    {
      key: "title",
      header: t("lists_admin.col.list"),
      render: (row) => (
        <span className="flex flex-col gap-0.5">
          <Link
            href={`/best/${row.slug}`}
            className="rounded-tag text-body-sm text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
          >
            {row.title}
          </Link>
          <span className="font-mono text-eyebrow uppercase text-muted">{row.categoryName}</span>
        </span>
      ),
    },
    { key: "members", header: t("lists_admin.col.entries"), numeric: true, render: (row) => row.members },
    { key: "audited", header: t("lists_admin.col.audited"), render: (row) => row.audited },
    { key: "due", header: t("lists_admin.col.due"), render: (row) => row.due },
    { key: "drift", header: t("lists_admin.col.drift"), numeric: true, render: (row) => row.drift },
    {
      key: "state",
      header: t("lists_admin.col.state"),
      render: (row) => (
        <StatusBadge
          tone={row.state === "published" ? "ok" : row.state === "overdue" ? "warn" : "neutral"}
        >
          {t(`lists_admin.state.${row.state}` as never)}
        </StatusBadge>
      ),
    },
  ];

  return (
    <DataTable
      caption={t("lists_admin.caption")}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      empty={t("lists_admin.empty")}
    />
  );
}
