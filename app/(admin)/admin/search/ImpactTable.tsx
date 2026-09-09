"use client";

import { DataTable, Panel, type Column } from "@/components/structure";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * What publishing would change, per scope.
 *
 * `Preview on a query` tested one phrase. A weight change is a platform-wide
 * reorder, and the question before publishing is not what happens to one query
 * but which categories move and who falls. 128 listings moving in HVAC is a
 * statistic; Skyline Air Systems falling nine places is a phone call, which is
 * why the biggest faller is named.
 *
 * A category where nothing moves is not listed. Padding a table to fill a grid
 * is the one thing this project will not do, and an impact preview that listed
 * every category with three dashes against most of them would be worse than
 * shorter — it would read as an impact.
 */

export interface ImpactRowView {
  key: string;
  scopeLabel: string;
  moving: number;
  total: number;
  fallName: string | null;
  fallPlaces: number | null;
  gains: string;
}

export interface ImpactTableProps {
  rows: readonly ImpactRowView[];
  /** Listings past the sampling cap, named rather than dropped in silence. */
  unread: number;
}

export function ImpactTable({ rows, unread }: ImpactTableProps) {
  const columns: Column<ImpactRowView>[] = [
    {
      key: "category",
      header: t("ranking.impact.col.category"),
      render: (row) => row.scopeLabel,
    },
    {
      key: "moving",
      header: t("ranking.impact.col.moving"),
      numeric: true,
      width: "10rem",
      render: (row) =>
        t("ranking.impact.moving", {
          moving: formatCount(row.moving),
          total: formatCount(row.total),
        }),
    },
    {
      key: "fall",
      header: t("ranking.impact.col.fall"),
      width: "14rem",
      render: (row) =>
        row.fallName && row.fallPlaces
          ? t("ranking.impact.fall", { places: `↓${row.fallPlaces}`, name: row.fallName })
          : t("ranking.impact.no_fall"),
    },
    {
      key: "gains",
      header: t("ranking.impact.col.gains"),
      width: "13rem",
      render: (row) => row.gains,
    },
  ];

  return (
    <Panel title={t("ranking.impact")} description={t("ranking.impact_hint")}>
      <DataTable
        caption={t("ranking.impact.caption")}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.key}
        stickyHeader
        empty={
          <div className="text-center">
            <p className="text-body-sm text-body">{t("ranking.impact.empty")}</p>
          </div>
        }
      />

      <p className="mt-3 max-w-prose text-caption text-body">{t("ranking.impact.note")}</p>

      {unread > 0 && (
        <p className="mt-1.5 max-w-prose text-caption text-body">
          {t("ranking.impact.unread", { count: formatCount(unread) })}
        </p>
      )}
    </Panel>
  );
}
