"use client";

import Link from "next/link";
import { StatusBadge } from "@/components/display";
import { DataTable, type Column } from "@/components/structure";
import { GUIDE_MIN_WORDS } from "@/lib/guides/blocks";
import { t } from "@/lib/i18n";

/** Boards 10b and 6d — every guide, published first. */

export interface GuideRowView {
  id: string;
  title: string;
  slug: string;
  words: number;
  published: boolean;
  updated: string;
}

export function GuideTable({ rows }: { rows: readonly GuideRowView[] }) {
  const columns: Column<GuideRowView>[] = [
    {
      key: "title",
      header: t("guide_admin.col.title"),
      render: (row) => (
        <Link
          href={`/admin/content/guides/${row.id}`}
          className="rounded-tag text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
        >
          {row.title}
        </Link>
      ),
    },
    {
      key: "slug",
      header: t("guide_admin.col.slug"),
      mono: true,
      render: (row) => `/guides/${row.slug}`,
    },
    {
      key: "words",
      header: t("guide_admin.col.words"),
      numeric: true,
      // The number, not a tick. "112 of 250" tells somebody how much writing is
      // left; "not ready" tells them to go and look.
      render: (row) => t("guide_admin.words", { words: row.words, need: GUIDE_MIN_WORDS }),
    },
    {
      key: "status",
      header: t("guide_admin.col.status"),
      render: (row) => (
        <StatusBadge tone={row.published ? "ok" : "neutral"}>
          {row.published ? t("guide_admin.status.published") : t("guide_admin.status.draft")}
        </StatusBadge>
      ),
    },
    { key: "updated", header: t("guide_admin.col.updated"), render: (row) => row.updated },
  ];

  return (
    <DataTable
      caption={t("guide_admin.caption")}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      empty={t("guide_admin.empty")}
    />
  );
}
