"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button, Checkbox } from "@/components/primitives";
import { StatusBadge, type StatusTone } from "@/components/display";
import { CompletenessMeter } from "@/components/domain";
import { formatCount, formatRelative } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { CatalogueRow } from "@/lib/db/queries/catalogue";
import type { BulkResult } from "./actions";

/**
 * Board 3f — the catalogue, with bulk actions.
 *
 * Selection lives here because a checkbox column that reloads the page on every
 * tick is unusable at the two hundred rows a real supplier has. The mutation is
 * still a server action, and it re-scopes every id to the seller's own business
 * rather than trusting what the form posts.
 *
 * The filterable-spec count is the column that earns its place. A product with
 * none is listed and not found, and this is where a seller sees which of theirs
 * are in that state — board 11e's "fix the free stuff first" argument reads off
 * the same number.
 */

export interface CatalogueTableProps {
  rows: readonly CatalogueRow[];
  action: (formData: FormData) => Promise<BulkResult>;
}

/*
 * Resolved here, not passed in. A labels object with function members is a
 * function prop however it is spelled, and a server component cannot hand one
 * across the boundary. Handoff 2 hit this in three components; this file made
 * it four and the import wizard next door made it five, both in the same hour.
 * `t` has no server-only marker, so a client component calls it directly and
 * there is nothing to pass. tests/unit/client-labels.test.ts now fails the
 * build rather than the page.
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

export function CatalogueTable({ rows, action }: CatalogueTableProps) {
  const now = new Date();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const allSelected = rows.length > 0 && selected.size === rows.length;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }

  function run(kind: "publish" | "draft" | "out_of_stock" | "delete") {
    if (selected.size === 0) return;
    if (kind === "delete" && !window.confirm(t("catalogue.bulk.confirm_delete", { count: formatCount(selected.size) }))) return;

    const form = new FormData();
    form.set("action", kind);
    for (const id of selected) form.append("id", id);

    startTransition(async () => {
      const result = await action(form);
      if (!result.ok) {
        setNotice(result.error);
        return;
      }
      setNotice(t("catalogue.bulk.done", { count: formatCount(result.changed) }));
      setSelected(new Set());
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {/*
        A live region, so the count reaches a screen reader without stealing
        focus from the table the seller is still working through.
      */}
      <div aria-live="polite" className="min-h-[1.5rem]">
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-ctl border border-line bg-paper-sunk px-3 py-2">
            <span className="text-body-sm text-ink">{t("catalogue.selected", { count: formatCount(selected.size) })}</span>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => run("publish")}>
                {t("catalogue.bulk.publish")}
              </Button>
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => run("draft")}>
                {t("catalogue.bulk.draft")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() => run("out_of_stock")}
              >
                {t("catalogue.bulk.out_of_stock")}
              </Button>
              <Button size="sm" variant="danger" disabled={pending} onClick={() => run("delete")}>
                {t("catalogue.bulk.delete")}
              </Button>
            </div>
          </div>
        )}
        {notice && selected.size === 0 && (
          <p className="text-body-sm text-muted">{notice}</p>
        )}
      </div>

      <div className="overflow-hidden rounded-card border border-line bg-card">
        <div className="overflow-x-auto contain-paint">
          <table className="w-full min-w-[58rem] border-collapse text-left">
            <caption className="sr-only">{t("catalogue.caption")}</caption>
            <thead>
              <tr className="bg-paper-sunk">
                <th scope="col" className="w-10 px-3 py-2">
                  <Checkbox
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label={t("catalogue.select_all")}
                  />
                </th>
                <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">
                  {t("catalogue.col.product")}
                </th>
                <th scope="col" className="w-40 px-3 py-2 text-caption font-normal text-muted">
                  {t("catalogue.col.specs")}
                </th>
                <th scope="col" className="w-32 px-3 py-2 text-caption font-normal text-muted">
                  {t("catalogue.col.availability")}
                </th>
                <th scope="col" className="w-20 px-3 py-2 text-caption font-normal text-muted">
                  {t("catalogue.col.photos")}
                </th>
                <th scope="col" className="w-28 px-3 py-2 text-caption font-normal text-muted">
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
                      onChange={() => toggle(row.id)}
                      aria-label={t("catalogue.select_one", { name: row.name })}
                    />
                  </td>
                  <th scope="row" className="px-3 py-3 text-left font-normal">
                    <Link
                      href={`/dashboard/products/${row.id}`}
                      className="rounded-tag text-body-sm text-ink underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                    >
                      {row.name}
                    </Link>
                    <span className="mt-0.5 block font-mono text-caption text-faint">
                      {row.sku ?? "—"}
                      {row.fromImport ? ` · ${t("catalogue.from_import")}` : ""}
                    </span>
                  </th>
                  <td className="px-3 py-3">
                    {row.filterableTotal === 0 ? (
                      <span className="text-caption text-muted">{t("catalogue.no_template")}</span>
                    ) : row.filterableFilled === 0 ? (
                      <span className="text-caption text-warn-ink">{t("catalogue.no_specs")}</span>
                    ) : (
                      <CompletenessMeter
                        filled={row.filterableFilled}
                        total={row.filterableTotal}
                        valueLabel={t("catalogue.of_specs", {
                          filled: String(row.filterableFilled),
                          total: String(row.filterableTotal),
                        })}
                        label={t("catalogue.col.specs")}
                        size="sm"
                      />
                    )}
                  </td>
                  <td className="px-3 py-3 text-body-sm text-ink">
                    {AVAILABILITY_LABEL[row.availability] ?? row.availability}
                    {/*
                       Board 1e's "Notify me", met where the seller can act on
                       it: on the row they would edit to fix it, rather than on
                       a screen they have to remember to visit.

                       Only on an out-of-stock line, and only when somebody is
                       actually waiting — a zero here would be a column of
                       zeroes teaching nobody anything.
                    */}
                    {row.availability === "out_of_stock" && row.watchers > 0 && (
                      <span className="ms-2 inline-block rounded-pill bg-warn-wash px-1.5 py-px font-mono text-eyebrow tabular-nums text-ink">
                        {t("catalogue.watchers", { count: row.watchers })}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 font-mono tabular-nums text-body-sm text-ink">
                    {row.photoCount}
                  </td>
                  <td className="px-3 py-3">
                    <StatusBadge tone={STATUS_TONE[row.status] ?? "neutral"} shape="chip" size="sm">
                      {STATUS_LABEL[row.status] ?? row.status}
                    </StatusBadge>
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
    </div>
  );
}
