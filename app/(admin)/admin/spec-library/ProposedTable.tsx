"use client";

import { DataTable, type Column } from "@/components/structure";
import type { ProposedField } from "@/lib/spec/library";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Board 4e §7 — what sellers keep inventing, and why there is no `Promote`.
 *
 * A client component because `Column.render` is a function and a server
 * component cannot pass one — the repo's most repeated defect, and the reason
 * `tests/unit/client-labels.test.ts` exists.
 *
 * The spread is the column that matters. The board's one-click `Promote` wrote
 * into a definition 412 sellers already had their own version of — 7 labels, 3
 * types, 2 unit conventions between them — so there was no single value for the
 * button to write. Promotion is a **merge** into an attribute in the
 * dictionary; the dictionary has a nav item, a header button and no board, so
 * per the handoff's Q2 both are deferred, together, and the footer says so
 * rather than the screen offering an action that cannot complete.
 */

export function ProposedTable({ rows }: { rows: readonly ProposedField[] }) {
  const columns: Column<ProposedField>[] = [
    {
      key: "field",
      header: t("admin.spec.proposed.col.field"),
      render: (row) => row.sampleLabel,
    },
    {
      key: "category",
      header: t("admin.spec.proposed.col.category"),
      width: "14rem",
      render: (row) => row.categoryName,
    },
    {
      key: "spread",
      header: t("admin.spec.proposed.col.spread"),
      width: "18rem",
      mono: true,
      render: (row) =>
        t("admin.spec.proposed.spread", {
          count: row.businesses,
          n: formatCount(row.businesses),
          labels: formatCount(row.labels),
          types: formatCount(row.types),
        }),
    },
  ];

  return (
    <DataTable
      caption={t("admin.spec.proposed.caption")}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      footer={
        <span className="text-caption text-muted">{t("admin.spec.proposed.no_merge")}</span>
      }
      empty={
        <p className="text-center text-body-sm text-body">{t("admin.spec.proposed.empty")}</p>
      }
    />
  );
}
