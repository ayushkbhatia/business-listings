"use client";

import { DataTable, type Column } from "@/components/structure";
import { t } from "@/lib/i18n";

/**
 * Where the MRR comes from, plan by plan.
 *
 * Free is absent by construction — `mrrNow` filters plans with no revenue, and
 * a row of zeros on a revenue screen is noise a reader has to skip past every
 * time they read it.
 */

export interface PlanMixRow {
  planId: string;
  planName: string;
  accounts: string;
  mrr: string;
  share: string;
}

export function PlanMixTable({ rows }: { rows: readonly PlanMixRow[] }) {
  const columns: Column<PlanMixRow>[] = [
    { key: "plan", header: t("admin.revenue.col.plan"), render: (row) => row.planName },
    {
      key: "accounts",
      header: t("admin.revenue.col.accounts"),
      numeric: true,
      width: "7rem",
      render: (row) => row.accounts,
    },
    {
      key: "mrr",
      header: t("admin.revenue.col.mrr"),
      numeric: true,
      width: "9rem",
      render: (row) => row.mrr,
    },
    {
      key: "share",
      header: t("admin.revenue.col.share"),
      numeric: true,
      width: "7rem",
      render: (row) => <span className="text-muted">{row.share}</span>,
    },
  ];

  return (
    <DataTable
      caption={t("admin.revenue.by_plan")}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.planId}
      empty={
        <div className="text-center">
          <p className="text-body-sm text-body">{t("admin.revenue.empty.title")}</p>
          <p className="mx-auto mt-1 max-w-prose text-caption text-muted">
            {t("admin.revenue.empty.body")}
          </p>
        </div>
      }
    />
  );
}
