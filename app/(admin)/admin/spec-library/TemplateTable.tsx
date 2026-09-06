"use client";

import Link from "next/link";
import { DataTable, type Column } from "@/components/structure";
import type { LibraryRow } from "@/lib/spec/library";
import { formatCount, formatPercent } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Board 4e §4 — the templates table.
 *
 * A client component for the same reason board 4d's is: `Column.render` is a
 * function, and a server component cannot pass one.
 *
 * Three things the board got wrong and this fixes:
 *
 *   - **Rows are anchors.** They were spans, the `FIELDS` count linked nowhere,
 *     and the only affordance on the screen was `+ New template` — a library
 *     you cannot open anything in. Same defect as `10b`'s index rows before
 *     that handoff. One anchor per row rather than one per cell: it covers the
 *     row through a stretched `::after`, so the whole row is the hit area and
 *     the accessibility tree still holds a single link.
 *   - **Fields is one cell, not three.** `22` over `8 FACET · 5 VARY`. Facet
 *     count and variant-flag count are two properties of the same field set and
 *     they read together; as separate columns the row does not fit. Same
 *     measurement `3h` §4 made when it folded unit into type.
 *   - **Version and draft state are never colour alone.** Every row says `Live`
 *     or `v4 draft` in words — criterion 15.
 */

export function TemplateTable({ rows }: { rows: readonly LibraryRow[] }) {
  const columns: Column<LibraryRow>[] = [
    {
      key: "template",
      header: t("admin.spec.col.template"),
      render: (row) => (
        <span className="relative flex flex-col gap-0.5">
          <Link
            href={`/admin/spec-library/${row.id}`}
            className="text-body-sm text-ink after:absolute after:-inset-y-2 after:-inset-x-3 after:content-[''] hover:underline focus-visible:outline-none focus-visible:shadow-focus"
          >
            {row.name}
          </Link>
          <span className="font-mono text-eyebrow uppercase text-muted">
            {row.code}
          </span>
        </span>
      ),
    },
    {
      key: "subcategories",
      header: t("admin.spec.col.subcategories"),
      width: "13rem",
      render: (row) => (
        /*
           Two names and a count above that. More than about twenty templates in
           one subcategory is a sign the subcategory should be split on 4d, and
           more than two names in this cell is a row that no longer fits.
        */
        <span className="flex flex-col gap-0.5 text-body-sm text-body">
          {row.subcategories.slice(0, 2).map((category) => (
            <span key={category.id}>{category.name}</span>
          ))}
          {row.subcategories.length > 2 && (
            <span className="font-mono text-eyebrow uppercase text-muted">
              {t("admin.spec.more_subcategories", {
                n: formatCount(row.subcategories.length - 2),
              })}
            </span>
          )}
        </span>
      ),
    },
    {
      key: "fields",
      header: t("admin.spec.col.fields"),
      width: "9rem",
      render: (row) => (
        <span className="flex flex-col gap-0.5">
          <span className="tabular-nums text-body-sm text-body">{formatCount(row.fields)}</span>
          <span className="font-mono text-eyebrow uppercase tabular-nums text-muted">
            {t("admin.spec.fields_facets", {
              facets: formatCount(row.facets),
              varies: formatCount(row.varies),
            })}
          </span>
        </span>
      ),
    },
    {
      key: "products",
      header: t("admin.spec.col.products"),
      numeric: true,
      width: "9rem",
      render: (row) => (
        <span className="flex flex-col gap-0.5">
          <span className="tabular-nums text-body-sm text-body">{formatCount(row.products)}</span>
          <span className="font-mono text-eyebrow uppercase tabular-nums text-muted">
            {t("admin.spec.copies", { count: row.clones, n: formatCount(row.clones) })}
          </span>
        </span>
      ),
    },
    {
      key: "filled",
      header: t("admin.spec.col.filled"),
      numeric: true,
      width: "6rem",
      mono: true,
      /*
         An em dash, not 0%. Zero of zero is not a fill rate, and 0% next to a
         healthy 94% reads as a failing template rather than an unused one.
      */
      render: (row) => (row.filled === null ? "—" : formatPercent(row.filled)),
    },
    {
      key: "version",
      header: t("admin.spec.col.version"),
      width: "8rem",
      mono: true,
      render: (row) => (
        /*
           `v1 · LIVE`. The version keeps its lower-case `v` — it is part of the
           number, not a label — while the state is a mono eyebrow and shouts
           like every other one. Never colour alone: both states are words.
        */
        <span className="flex flex-col gap-0.5 font-mono text-eyebrow tabular-nums">
          <span className="text-body">
            {t("admin.spec.version_of", { version: String(row.version) })}
            <span className="uppercase"> · {t("admin.spec.live")}</span>
          </span>
          {row.draftVersion !== null && (
            <span className="text-warn-ink">
              {t("admin.spec.version_of", { version: String(row.draftVersion) })}
              <span className="uppercase"> · {t("admin.spec.tab.drafts")}</span>
            </span>
          )}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      caption={t("admin.spec.caption")}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      stickyHeader
      footer={<span className="text-caption text-muted">{t("admin.spec.note")}</span>}
      empty={
        <div className="text-center">
          <p className="text-body-sm text-body">{t("admin.spec.empty.title")}</p>
          <p className="mx-auto mt-1 max-w-prose text-caption text-muted">
            {t("admin.spec.empty.body")}
          </p>
        </div>
      }
    />
  );
}
