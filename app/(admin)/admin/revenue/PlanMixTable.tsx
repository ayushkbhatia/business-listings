"use client";

import { DataTable, type Column } from "@/components/structure";
import { t } from "@/lib/i18n";

/**
 * Where the MRR comes from, plan by plan, at the end of the month.
 *
 * Free is absent by construction — the ledger gives a Free account no monthly
 * value, and a row of zeros on a revenue screen is noise a reader has to skip
 * past every time they read it.
 *
 * ARPA per plan beside the share, because Q4 is right that one ARPA across
 * three tiers moves when the mix moves: a month of Basic signups lowers it with
 * no change in what anybody pays. The per-plan column is the figure that moves
 * only when prices or terms do.
 */

export interface PlanMixRow {
  planId: string;
  planName: string;
  accounts: string;
  mrr: string;
  share: string;
  arpa: string;
}

export function PlanMixTable({ rows, caption }: { rows: readonly PlanMixRow[]; caption: string }) {
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
    {
      key: "arpa",
      header: t("admin.revenue.col.arpa"),
      numeric: true,
      width: "8rem",
      render: (row) => row.arpa,
    },
  ];

  return (
    <DataTable
      caption={caption}
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
