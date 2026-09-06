"use client";

import Link from "next/link";
import { Checkbox } from "@/components/primitives";
import { ImagePlaceholder, StatusBadge, type StatusTone } from "@/components/display";
import { formatCount, formatRelative } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { CatalogueRow } from "@/lib/products/catalogue-query";

/**
 * Board 3f — the catalogue table.
 *
 * ## `SPECS` names the consequence, not the ratio
 *
 * The board rendered `18 / 22`, which tells the seller how much of a form they
 * have filled in and nothing about what the gap costs. The ratio stays as
 * context; beneath it sits what it means, and the two meanings are different
 * enough that they cannot share a line:
 *
 * - `MISSING 2 FILTERS` — absent from two buyer filters on 1b/1c. Not ranked
 *   lower; not in the result set.
 * - `2 REQUIRED · SAVE BLOCKED` — the next save in the editor is refused. The
 *   product stays live, in search, ranked as before.
 *
 * A row can carry both, and the gate valve in the render is the case that
 * proves the model reads: **`Live` and `SAVE BLOCKED` at once**, which is
 * exactly what board 3h §5 intends and what the board had no way to express. If
 * that reads as a bug, the model needs restating in the UI rather than
 * changing.
 *
 * ## Selection scope is stated, always
 *
 * `3 selected` above a 125-page list does not say whether an action applies to
 * three products or to the filtered set. Page-scoped by default, with an
 * explicit route to the whole filtered set and the filter's own count in its
 * label — board 3f's open question 5, answered as recommended.
 *
 * ## No price column
 *
 * The board draws one, with values. `Product` has no price field and cannot
 * gain one: it is the first of the project's non-negotiables, `check:schema-invariants`
 * fails the build on such a column, and the CSV importer refuses a price by
 * name. Prices live on a quote line, private to one buyer and one seller.
 */

const STATUS_LABEL: Record<string, string> = {
  draft: t("catalogue.status.draft"),
  live: t("catalogue.status.live"),
  out_of_stock: t("catalogue.status.out_of_stock"),
};

const AVAILABILITY_LABEL: Record<string, string> = {
  in_stock: t("catalogue.availability.in_stock"),
  made_to_order: t("catalogue.availability.made_to_order"),
  indent: t("catalogue.availability.indent"),
  out_of_stock: t("catalogue.availability.out_of_stock"),
};

const STATUS_TONE: Record<string, StatusTone> = {
  live: "ok",
  draft: "neutral",
  out_of_stock: "warn",
};

export interface CatalogueTableProps {
  rows: readonly CatalogueRow[];
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  /** Every row on this page is selected. Drives the header checkbox. */
  allOnPage: boolean;
}

export function CatalogueTable({
  rows,
  selected,
  onToggle,
  onToggleAll,
  allOnPage,
}: CatalogueTableProps) {
  const now = new Date();

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-card border border-line bg-card">
        <div className="overflow-x-auto contain-paint">
          <table className="w-full min-w-[62rem] border-collapse text-left">
            <caption className="sr-only">{t("catalogue.caption")}</caption>
            <thead>
              <tr className="bg-paper-sunk">
                <th scope="col" className="w-10 px-3 py-2">
                  <Checkbox
                    checked={allOnPage}
                    onChange={onToggleAll}
                    aria-label={t("catalogue.select_all")}
                  />
                </th>
                <th scope="col" className="w-12 px-3 py-2 text-caption font-normal text-muted">
                  <span className="sr-only">{t("catalogue.col.photos")}</span>
                </th>
                <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">
                  {t("catalogue.col.product")}
                </th>
                <th scope="col" className="w-36 px-3 py-2 text-caption font-normal text-muted">
                  {t("catalogue.col.template")}
                </th>
                <th scope="col" className="w-24 px-3 py-2 text-caption font-normal text-muted">
                  {t("catalogue.col.stock")}
                </th>
                <th scope="col" className="w-56 px-3 py-2 text-caption font-normal text-muted">
                  {t("catalogue.col.specs")}
                </th>
                <th scope="col" className="w-32 px-3 py-2 text-caption font-normal text-muted">
                  {t("catalogue.col.status")}
                </th>
                <th scope="col" className="w-28 px-3 py-2 text-caption font-normal text-muted">
                  {t("catalogue.col.updated")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-line align-top">
                  <td className="px-3 py-3">
                    <Checkbox
                      checked={selected.has(row.id)}
                      onChange={() => onToggle(row.id)}
                      aria-label={t("catalogue.select_one", { name: row.name })}
                    />
                  </td>
                  <td className="px-3 py-3">
                    {/*
                      Thumbnails are board 3i's, wave 2 step 4. A product with no
                      photo renders the placeholder and says so — it is not a gap
                      and is not counted as one.
                    */}
                    <ImagePlaceholder
                      kind="empty"
                      ratio="1 / 1"
                      rounded="chip"
                      className="w-9"
                      {...(row.photoCount > 0 ? {} : { label: t("catalogue.no_photo") })}
                    />
                  </td>
                  <th scope="row" className="px-3 py-3 text-left font-normal">
                    <Link
                      href={`/dashboard/products/${row.id}`}
                      className="rounded-tag text-body-sm text-ink underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                    >
                      {row.name}
                    </Link>
                    {/*
                      SKU folds into the product cell rather than taking a
                      column of its own. Below 1440 that is the only way the two
                      columns the screen exists for — SPECS and STATUS — keep
                      their widths.
                    */}
                    <span className="mt-0.5 block font-mono text-caption text-muted">
                      {row.sku ?? "—"}
                      {row.fromImport ? ` · ${t("catalogue.from_import")}` : ""}
                    </span>
                  </th>
                  <td className="px-3 py-3 text-caption text-muted">
                    {row.templateName ?? (
                      <span className="text-bad-ink">{t("catalogue.no_template")}</span>
                    )}
                    <span className="mt-0.5 block text-caption text-faint">{row.categoryName}</span>
                  </td>
                  <td className="px-3 py-3 font-mono tabular-nums text-body-sm text-ink">
                    {stockCell(row)}
                    {row.availability === "out_of_stock" && row.watchers > 0 && (
                      <span className="ms-2 inline-block rounded-pill bg-warn-wash px-1.5 py-px font-mono text-eyebrow tabular-nums text-ink">
                        {t("catalogue.watchers", { count: row.watchers })}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <SpecsCell row={row} />
                  </td>
                  <td className="px-3 py-3">
                    <span className="flex flex-col items-start gap-1">
                      <StatusBadge
                        tone={STATUS_TONE[row.status] ?? "neutral"}
                        shape="chip"
                        size="sm"
                      >
                        {STATUS_LABEL[row.status] ?? row.status}
                      </StatusBadge>
                      {/*
                        A plan drop hid this, not the seller. Both are `draft`,
                        because every public surface already excludes a draft —
                        but the seller has to be able to tell one from the other,
                        and nothing was deleted.
                      */}
                      {row.storedNotListed && (
                        <span
                          className="font-mono text-eyebrow uppercase text-warn-ink"
                          title={t("catalogue.stored_reason")}
                        >
                          {t("catalogue.stored_not_listed")}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-caption text-muted">
                    {formatRelative(row.updatedAt, { now })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/*
        The legend, because the gate valve row is deliberately surprising. A
        product that is live and unsaveable at once is what board 3h §5 asks
        for, and a reviewer meeting it with no explanation reads it as a bug.
      */}
      <p className="max-w-prose text-caption text-muted">{t("catalogue.specs.legend")}</p>
    </div>
  );
}

/** Made to order is a value, not a missing number. */
function stockCell(row: CatalogueRow): React.ReactNode {
  if (row.availability === "made_to_order" || row.availability === "indent") {
    return (
      <span className="text-caption text-muted">
        {AVAILABILITY_LABEL[row.availability]}
      </span>
    );
  }
  if (row.stockQty === null) return <span className="text-faint">—</span>;
  return formatCount(row.stockQty);
}

/**
 * The SPECS cell, exported for the gallery.
 *
 * Four documented states, and the two consequences are not alternatives: a
 * field can be required and a facet, so a row can carry both markers at once.
 */
export function SpecsCell({ row }: { row: CatalogueRow }) {
  if (row.untemplated) {
    return (
      <span className="flex flex-col gap-0.5">
        <span className="text-body-sm text-bad-ink">{t("catalogue.no_template")}</span>
        <span className="font-mono text-eyebrow uppercase text-bad-ink">
          {t("catalogue.specs.cannot_publish")}
        </span>
      </span>
    );
  }

  const { filled, total, requiredMissing, filterGaps } = row.gaps;

  return (
    <span className="flex flex-col gap-0.5">
      <span className="font-mono tabular-nums text-body-sm text-ink">
        {t("catalogue.specs.ratio", { filled: String(filled), total: String(total) })}
      </span>
      {/*
        Both consequences where both apply. They are not alternatives and one
        does not imply the other: a field can be required and a facet, and a
        product can be blocked on save while missing no filter at all.
      */}
      {requiredMissing > 0 && (
        <span className="font-mono text-eyebrow uppercase text-bad-ink">
          {t("catalogue.specs.required", { count: requiredMissing })}
        </span>
      )}
      {filterGaps > 0 && (
        <span className="font-mono text-eyebrow uppercase text-warn-ink">
          {t("catalogue.specs.missing_filters", { count: filterGaps })}
        </span>
      )}
      {requiredMissing === 0 && filterGaps === 0 && (
        <span className="text-caption text-muted">
          {filled === total ? t("catalogue.specs.complete") : t("catalogue.specs.no_gaps")}
        </span>
      )}
    </span>
  );
}
