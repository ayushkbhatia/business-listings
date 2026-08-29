"use client";

import { DataTable, type Column } from "@/components/structure";
import { t } from "@/lib/i18n";

/** Criterion 9, as a screen. Counts and dates; never a buyer. */

export interface AttributionRowView {
  key: string;
  campaign: string;
  source: string;
  medium: string;
  enquiries: string;
  first: string;
  last: string;
  /** Untagged — rendered plainly rather than left blank. */
  direct: boolean;
}

export function AttributionTable({ rows }: { rows: readonly AttributionRowView[] }) {
  const columns: Column<AttributionRowView>[] = [
    {
      key: "campaign",
      header: t("attribution.col.campaign"),
      render: (row) => (row.direct ? t("attribution.direct") : row.campaign),
    },
    { key: "source", header: t("attribution.col.source"), render: (row) => row.source },
    { key: "medium", header: t("attribution.col.medium"), render: (row) => row.medium },
    {
      key: "enquiries",
      header: t("attribution.col.enquiries"),
      numeric: true,
      render: (row) => row.enquiries,
    },
    { key: "first", header: t("attribution.col.first"), render: (row) => row.first },
    { key: "last", header: t("attribution.col.last"), render: (row) => row.last },
  ];

  return (
    <DataTable
      caption={t("attribution.caption")}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.key}
      empty={t("attribution.empty")}
    />
  );
}
