"use client";

import { DataTable, type Column } from "@/components/structure";
import { maskTRN } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * The invoices behind the return.
 *
 * A total row in a real `<tfoot>`, not a `<tr>` at the end of the body — a
 * total that sorts and paginates with the data is a total that ends up in the
 * middle of page two.
 */

export interface TaxRowView {
  invoiceRef: string;
  issued: string;
  supplier: string;
  trn: string | null;
  emirate: string;
  net: string;
  vat: string;
  gross: string;
}

export interface TaxTotals {
  net: string;
  vat: string;
  gross: string;
  count: string;
}

export function TaxTable({ rows, totals }: { rows: readonly TaxRowView[]; totals: TaxTotals }) {
  const columns: Column<TaxRowView>[] = [
    {
      key: "invoice",
      header: t("admin.tax.col.invoice"),
      mono: true,
      render: (row) => row.invoiceRef,
    },
    {
      key: "issued",
      header: t("admin.tax.col.issued"),
      mono: true,
      width: "8rem",
      render: (row) => row.issued,
    },
    { key: "supplier", header: t("admin.tax.col.supplier"), render: (row) => row.supplier },
    {
      key: "trn",
      header: t("admin.tax.col.trn"),
      mono: true,
      hideBelow: "md",
      render: (row) =>
        row.trn ? (
          maskTRN(row.trn)
        ) : (
          <span className="text-faint">{t("admin.tax.no_trn")}</span>
        ),
    },
    {
      key: "emirate",
      header: t("admin.tax.col.emirate"),
      hideBelow: "lg",
      render: (row) => row.emirate,
    },
    { key: "net", header: t("admin.tax.col.net"), numeric: true, render: (row) => row.net },
    { key: "vat", header: t("admin.tax.col.vat"), numeric: true, render: (row) => row.vat },
    { key: "gross", header: t("admin.tax.col.gross"), numeric: true, render: (row) => row.gross },
  ];

  return (
    <DataTable
      caption={t("admin.tax.caption")}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.invoiceRef}
      stickyHeader
      footer={
        <tr>
          <th scope="row" className="px-3 py-2 text-start text-caption text-ink">
            {totals.count}
          </th>
          <td className="px-3 py-2" />
          <td className="px-3 py-2" />
          <td className="hidden px-3 py-2 md:table-cell" />
          <td className="hidden px-3 py-2 lg:table-cell" />
          <td className="px-3 py-2 text-end tabular-nums text-ink">{totals.net}</td>
          <td className="px-3 py-2 text-end tabular-nums text-ink">{totals.vat}</td>
          <td className="px-3 py-2 text-end tabular-nums text-ink">{totals.gross}</td>
        </tr>
      }
      empty={
        <div className="text-center">
          <p className="text-body-sm text-body">{t("admin.tax.empty.title")}</p>
          <p className="mx-auto mt-1 max-w-prose text-caption text-muted">
            {t("admin.tax.empty.body")}
          </p>
        </div>
      }
    />
  );
}
