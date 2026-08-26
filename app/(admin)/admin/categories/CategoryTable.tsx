"use client";

import { DataTable, type Column } from "@/components/structure";
import { StatusBadge, Tag } from "@/components/display";
import type { CategoryHealth } from "@/lib/taxonomy/service";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Board 4d's table.
 *
 * A client component because `DataTable` is one, and a `Column.render` is a
 * function — which a server component cannot hand across the boundary. This is
 * the seventh time this project has hit that, and the shape is always the same:
 * the columns look like data and one field of them is not.
 */

export function CategoryTable({ rows }: { rows: readonly CategoryHealth[] }) {
  const columns: Column<CategoryHealth>[] = [
    {
      key: "category",
      header: t("admin.taxonomy.col.category"),
      render: (row) => (
        <span className="flex flex-col">
          <span className={row.parentId ? "text-body ps-3" : "text-ink"}>{row.name}</span>
          <span className="font-mono text-eyebrow uppercase text-faint">{row.code}</span>
        </span>
      ),
    },
    {
      key: "listings",
      header: t("admin.taxonomy.col.listings"),
      numeric: true,
      width: "6rem",
      render: (row) => formatCount(row.listings),
    },
    {
      key: "verified",
      header: t("admin.taxonomy.col.verified"),
      numeric: true,
      width: "6rem",
      render: (row) =>
        row.listings === 0
          ? "—"
          : `${formatCount(row.verified)} · ${Math.round((row.verified / row.listings) * 100)}%`,
    },
    {
      key: "floor",
      header: t("admin.taxonomy.col.floor"),
      width: "11rem",
      mono: true,
      render: (row) =>
        t("admin.taxonomy.floor_value", {
          listings: formatCount(row.publishThreshold),
          share: String(Math.round(row.verifiedShareMin * 100)),
        }),
    },
    {
      key: "state",
      header: t("admin.taxonomy.col.state"),
      width: "12rem",
      render: (row) => {
        if (row.decision.publishable) {
          return <StatusBadge tone="ok">{t("admin.taxonomy.publishable")}</StatusBadge>;
        }
        const first = row.decision.failures[0]!;
        return (
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusBadge tone="warn">{t("admin.taxonomy.blocked")}</StatusBadge>
            {/* Which half failed, not just that something did. */}
            <span className="font-mono text-eyebrow tabular-nums text-muted">
              {first.reason === "verified_share"
                ? t("admin.taxonomy.blocked_on", {
                    have: `${Math.round(first.have * 100)}%`,
                    need: `${Math.round(first.need * 100)}%`,
                  })
                : t("admin.taxonomy.blocked_on", {
                    have: formatCount(first.have),
                    need: formatCount(first.need),
                  })}
            </span>
          </span>
        );
      },
    },
    {
      key: "synonyms",
      header: t("admin.taxonomy.col.synonyms"),
      hideBelow: "lg",
      render: (row) => (
        <span className="flex flex-wrap gap-1">
          {row.synonyms.slice(0, 4).map((synonym) => (
            <Tag key={synonym} size="sm">
              {synonym}
            </Tag>
          ))}
          {row.synonyms.length > 4 && (
            <span className="text-caption text-faint">+{row.synonyms.length - 4}</span>
          )}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      caption={t("admin.taxonomy.caption")}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      stickyHeader
      rowTone={(row) => (row.decision.publishable ? "default" : "attention")}
      empty={
        <div className="text-center">
          <p className="text-body-sm text-body">{t("admin.taxonomy.empty.title")}</p>
          <p className="mx-auto mt-1 max-w-prose text-caption text-muted">
            {t("admin.taxonomy.empty.body")}
          </p>
        </div>
      }
    />
  );
}
