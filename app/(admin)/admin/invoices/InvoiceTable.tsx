"use client";

import { StatusBadge, Tag } from "@/components/display";
import { DataTable, type Column } from "@/components/structure";
import { t } from "@/lib/i18n";

/**
 * Invoices, newest first.
 *
 * The credit tag is on the row rather than in its own column: a credit is a
 * line on an invoice, and giving it a column would imply a credit is a separate
 * document. It is not — there is no refund here to document.
 */

export interface InvoiceRowView {
  id: string;
  ref: string;
  businessName: string;
  issued: string;
  status: string;
  lines: string;
  total: string;
  hasCredit: boolean;
}

const TONE: Record<string, "ok" | "warn" | "bad" | "neutral"> = {
  draft: "neutral",
  issued: "warn",
  paid: "ok",
  overdue: "bad",
  void: "neutral",
};

export function InvoiceTable({ rows }: { rows: readonly InvoiceRowView[] }) {
  const columns: Column<InvoiceRowView>[] = [
    { key: "ref", header: t("admin.invoices.col.ref"), mono: true, render: (row) => row.ref },
    {
      key: "business",
      header: t("admin.invoices.col.business"),
      render: (row) => (
        <span className="flex items-center gap-2">
          {row.businessName}
          {row.hasCredit && <Tag>{t("admin.invoices.credit")}</Tag>}
        </span>
      ),
    },
    {
      key: "issued",
      header: t("admin.invoices.col.issued"),
      mono: true,
      width: "8rem",
      hideBelow: "md",
      render: (row) => row.issued,
    },
    {
      key: "status",
      header: t("admin.invoices.col.status"),
      width: "8rem",
      render: (row) => (
        <StatusBadge tone={TONE[row.status] ?? "neutral"}>
          {t(`billing.status.${row.status}` as never)}
        </StatusBadge>
      ),
    },
    {
      key: "lines",
      header: t("admin.invoices.col.lines"),
      numeric: true,
      width: "6rem",
      hideBelow: "lg",
      render: (row) => row.lines,
    },
    {
      key: "total",
      header: t("admin.invoices.col.total"),
      numeric: true,
      width: "9rem",
      render: (row) => row.total,
    },
  ];

  return (
    <DataTable
      caption={t("admin.invoices.caption")}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      stickyHeader
      empty={
        <div className="text-center">
          <p className="text-body-sm text-body">{t("admin.invoices.empty.title")}</p>
          <p className="mx-auto mt-1 max-w-prose text-caption text-muted">
            {t("admin.invoices.empty.body")}
          </p>
        </div>
      }
    />
  );
}
