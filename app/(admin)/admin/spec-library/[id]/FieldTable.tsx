"use client";

import { DataTable, type Column } from "@/components/structure";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * One template's fields — the screen the board had no way to reach.
 *
 * Rows on the index were spans, the `FIELDS` count linked nowhere, and the only
 * affordance was `+ New template`: a library you cannot open anything in. This
 * is what its rows now point at.
 *
 * Read-only on the field's own definition. Editing a platform label, its
 * options and its order is the admin twin of `3h` §4 and §7 and needs its own
 * pass; what this carries is the two actions the 4e handoff splits apart, and
 * the counts each of their reviews has to name.
 *
 * Every state is in words as well as tone — criterion 15.
 */

export interface FieldRow {
  id: string;
  key: string;
  label: string;
  unit: string | null;
  type: string;
  required: boolean;
  isFilterable: boolean;
  variesByVariant: boolean;
  detached: number;
  missing: number;
  /** Staged for removal in the current draft. Nothing is deleted by it. */
  removing: boolean;
}

export function FieldTable({ rows, prefix }: { rows: readonly FieldRow[]; prefix: string }) {
  const columns: Column<FieldRow>[] = [
    {
      key: "field",
      header: t("admin.spec.detail.col.field"),
      render: (row) => (
        <span className="flex flex-col gap-0.5">
          <span className="text-body-sm text-ink">{row.label}</span>
          {/* Lower case, and not uppercased by CSS: it is an identifier, and
              it is the same one board 3h shows the seller as `MAPPED TO`. */}
          <span className="font-mono text-eyebrow text-muted">
            {prefix}.{row.key}
          </span>
        </span>
      ),
    },
    {
      key: "type",
      header: t("admin.spec.detail.col.type"),
      width: "9rem",
      mono: true,
      render: (row) => (row.unit ? `${row.type} · ${row.unit}` : row.type),
    },
    {
      key: "facet",
      header: t("admin.spec.detail.col.facet"),
      width: "6rem",
      render: (row) => (
        <span className="font-mono text-eyebrow uppercase text-muted">
          {row.isFilterable ? t("admin.spec.detail.facet_yes") : "—"}
        </span>
      ),
    },
    {
      key: "varies",
      header: t("admin.spec.detail.col.varies"),
      width: "6rem",
      render: (row) => (
        <span className="font-mono text-eyebrow uppercase text-muted">
          {row.variesByVariant ? t("admin.spec.detail.varies_yes") : "—"}
        </span>
      ),
    },
    {
      key: "required",
      header: t("admin.spec.detail.col.required"),
      width: "7rem",
      render: (row) => (
        <span className="font-mono text-eyebrow uppercase text-muted">
          {row.required ? t("admin.spec.detail.required_yes") : t("admin.spec.detail.required_no")}
        </span>
      ),
    },
    {
      key: "gaps",
      header: t("admin.spec.detail.col.gaps"),
      numeric: true,
      width: "12rem",
      render: (row) => (
        <span className="flex flex-col items-end gap-0.5">
          <span className="font-mono text-eyebrow uppercase tabular-nums text-muted">
            {t("admin.spec.detail.missing", { count: row.missing, n: formatCount(row.missing) })}
          </span>
          {row.detached > 0 && (
            <span className="font-mono text-eyebrow uppercase tabular-nums text-muted">
              {t("admin.spec.detail.detached", { count: row.detached, n: formatCount(row.detached) })}
            </span>
          )}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      caption={t("admin.spec.detail.caption")}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      rowTone={(row) => (row.removing ? "attention" : "default")}
      empty={<p className="text-center text-body-sm text-body">{t("admin.spec.detail.empty")}</p>}
    />
  );
}
