"use client";

import { DataTable, type Column } from "@/components/structure";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Board 12d — the call list.
 *
 * There is no "add" control, and that absence is the feature. Criterion 7 asks
 * that the list be generated with no manual entry, and the way to make that
 * true rather than intended is to give it nowhere to type.
 *
 * "How much" is the first number on the call. Ordered by it rather than by
 * account value: a Free seller who lost eleven enquiries is a better call than
 * a Pro seller who lost one, and sorting by what we would earn is how a CRM
 * stops being about the customer.
 */

export interface ProspectRow {
  businessId: string;
  displayName: string;
  signal: string;
  value: number;
  plan: string;
  claimStatus: string;
}

export function CallListTable({ rows }: { rows: readonly ProspectRow[] }) {
  const columns: Column<ProspectRow>[] = [
    {
      key: "business",
      header: t("admin.crm.col.business"),
      render: (row) => row.displayName,
    },
    {
      key: "signal",
      header: t("admin.crm.col.signal"),
      render: (row) => (
        <span className="text-muted">{t(`admin.crm.signal.${row.signal}` as never)}</span>
      ),
    },
    {
      key: "value",
      header: t("admin.crm.col.value"),
      numeric: true,
      width: "7rem",
      render: (row) => <span className="text-ink">{formatCount(row.value)}</span>,
    },
    {
      key: "plan",
      header: t("admin.crm.col.plan"),
      width: "8rem",
      mono: true,
      hideBelow: "md",
      render: (row) => row.plan,
    },
  ];

  return (
    <DataTable
      caption={t("admin.crm.caption")}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.businessId}
      stickyHeader
      empty={
        <div className="text-center">
          <p className="text-body-sm text-body">{t("admin.crm.empty.title")}</p>
          <p className="mx-auto mt-1 max-w-prose text-caption text-muted">
            {t("admin.crm.empty.body")}
          </p>
        </div>
      }
    />
  );
}
