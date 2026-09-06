"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Button, Input, Select } from "@/components/primitives";
import { Alert } from "@/components/display";
import { Modal, Pagination } from "@/components/structure";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
/*
   `./catalogue-query`, not `./catalogue`. The latter is `server-only`, and a
   client component importing a value from it pulls Prisma into the browser
   bundle — allowed by typecheck and by lint, caught only by the build.
*/
import {
  CATALOGUE_SORTS,
  PAGE_SIZES,
  type CatalogueSort,
  type CatalogueView,
} from "@/lib/products/catalogue-query";
import type { MovePreview } from "@/lib/products/move-category";
import { CatalogueTable } from "./CatalogueTable";
import type { BulkResult, CreateProductResult, MovePreviewResult } from "./actions";

/**
 * Board 3f's working surface — the filters, the selection and the bulk actions.
 *
 * ## An action ending in `…` opens a preview
 *
 * Two of the four change something a repeat click cannot undo, and the board
 * offered both as one-click bulk buttons on a selection extendable to the whole
 * catalogue:
 *
 * - **`Move category…`** is board 3g's template reassignment, in bulk. A
 *   product's template comes from its category, so moving it changes which
 *   fields it has — and every value whose field the target does not carry stops
 *   being readable. The preview names them, aggregated, before it runs.
 * - **`Unpublish…`** changes what a buyer at that URL sees. Board 6f settled
 *   that we 301 rather than 404, and the confirmation says so with the count.
 *
 * **`Change availability` needs no preview.** It is reversible, it destroys
 * nothing, and every value is visible in the list afterwards. Gating it would
 * teach the seller to click through the ones that matter — which is the whole
 * reason the other two have previews.
 *
 * The board's fourth action was `Change price`, and it was the one deliberately
 * without a confirmation. There is no price on a product here and cannot be, so
 * availability takes that role: the safe, frequent, reversible bulk edit that
 * makes the two guarded ones legible by contrast.
 */

export interface CatalogueWorkspaceProps {
  view: CatalogueView;
  query: {
    q: string;
    categoryId: string;
    status: string;
    template: string;
    gap: string;
    sort: CatalogueSort;
  };
  /** Categories a product may be filed under. Board 6c owns the tree. */
  moveTargets: readonly { id: string; name: string }[];
  bulkAction: (formData: FormData) => Promise<BulkResult>;
  moveAction: (formData: FormData) => Promise<BulkResult>;
  previewAction: (formData: FormData) => Promise<MovePreviewResult>;
  createAction: (formData: FormData) => Promise<CreateProductResult>;
}

type Dialog = "none" | "unpublish" | "move" | "new";

const STATUSES = ["live", "draft", "out_of_stock"] as const;

export function CatalogueWorkspace(props: CatalogueWorkspaceProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** True once the seller has explicitly taken the whole filtered set. */
  const [wholeSet, setWholeSet] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>("none");
  const [preview, setPreview] = useState<MovePreview | null>(null);
  const [moveTarget, setMoveTarget] = useState("");
  const [newName, setNewName] = useState("");

  const { view } = props;
  const pageIds = useMemo(() => view.rows.map((row) => row.id), [view.rows]);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  /** What a bulk action would actually touch, and what the label must say. */
  const targetIds = wholeSet ? view.filteredIds : [...selected];

  function navigate(next: Record<string, string | undefined>) {
    const params = new URLSearchParams();
    const merged = { ...props.query, ...next };
    for (const [key, value] of Object.entries(merged)) {
      if (value && value !== "gaps") params.set(key, value);
    }
    // A filter change resets to the first page: page 7 of a narrower result set
    // is usually empty, and an empty table the seller did not ask for reads as
    // a broken filter.
    if (next.page) params.set("page", next.page);
    if (next.rows) params.set("rows", next.rows);
    else if (view.pageSize !== 50) params.set("rows", String(view.pageSize));
    setSelected(new Set());
    setWholeSet(false);
    startTransition(() => router.push(`/dashboard/products?${params.toString()}`));
  }

  function toggle(id: string) {
    setWholeSet(false);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setWholeSet(false);
    setSelected(allOnPage ? new Set() : new Set(pageIds));
  }

  function clearSelection() {
    setSelected(new Set());
    setWholeSet(false);
  }

  function post(action: (form: FormData) => Promise<BulkResult>, extra: Record<string, string>) {
    const form = new FormData();
    for (const [key, value] of Object.entries(extra)) form.set(key, value);
    for (const id of targetIds) form.append("id", id);

    setError(null);
    startTransition(async () => {
      const result = await action(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice(t("catalogue.bulk.done", { count: formatCount(result.changed) }));
      clearSelection();
      setDialog("none");
      router.refresh();
    });
  }

  function openMove() {
    setDialog("move");
    setPreview(null);
    setMoveTarget("");
  }

  function loadPreview(categoryId: string) {
    setMoveTarget(categoryId);
    setPreview(null);
    if (!categoryId) return;
    const form = new FormData();
    form.set("categoryId", categoryId);
    for (const id of targetIds) form.append("id", id);
    startTransition(async () => {
      const result = await props.previewAction(form);
      if (result.ok) setPreview(result.preview);
      else setError(result.error);
    });
  }

  const summary = view.summary;
  const filtersOn =
    Boolean(props.query.q || props.query.categoryId || props.query.status || props.query.template || props.query.gap);

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert tone="bad" live="assertive" fix={t("catalogue.cap.at")}>
          {error}
        </Alert>
      )}

      {summary.approximate && (
        <p className="text-caption text-muted">
          {t("catalogue.approximate", { scanned: formatCount(summary.total) })}
        </p>
      )}

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[16rem] flex-1 flex-col gap-1">
          <span className="text-caption text-muted">{t("catalogue.search_label")}</span>
          <Input
            defaultValue={props.query.q}
            placeholder={t("catalogue.search_hint")}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              navigate({ q: (event.target as HTMLInputElement).value, page: "1" });
            }}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-caption text-muted">{t("catalogue.filter.category")}</span>
          <Select
            value={props.query.categoryId}
            onChange={(event) => navigate({ categoryId: event.target.value, page: "1" })}
            options={[
              { value: "", label: t("catalogue.filter.any") },
              ...view.categories.map((entry) => ({
                value: entry.id,
                label: t("catalogue.filter.option", { name: entry.name, count: entry.count }),
              })),
            ]}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-caption text-muted">{t("catalogue.filter.status")}</span>
          <Select
            value={props.query.status}
            onChange={(event) => navigate({ status: event.target.value, page: "1" })}
            options={[
              { value: "", label: t("catalogue.filter.any") },
              ...STATUSES.map((status) => ({
                value: status,
                label: t(`catalogue.status.${status}` as "catalogue.status.live"),
              })),
            ]}
          />
        </label>

        {view.templates.length > 1 && (
          <label className="flex flex-col gap-1">
            <span className="text-caption text-muted">{t("catalogue.filter.template")}</span>
            <Select
              value={props.query.template}
              onChange={(event) => navigate({ template: event.target.value, page: "1" })}
              options={[
                { value: "", label: t("catalogue.filter.any") },
                ...view.templates.map((entry) => ({
                  value: entry.id,
                  label: t("catalogue.filter.option", { name: entry.name, count: entry.count }),
                })),
              ]}
            />
          </label>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-caption text-muted">{t("catalogue.sort_by")}</span>
          <Select
            value={props.query.sort}
            onChange={(event) => navigate({ sort: event.target.value, page: "1" })}
            options={CATALOGUE_SORTS.map((sort) => ({
              value: sort,
              label: SORT_LABEL[sort],
            }))}
          />
        </label>
      </div>

      {/* ── The two gap chips ───────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <GapChip
          active={props.query.gap === "blocked"}
          tone="bad"
          count={summary.blockedOnSave}
          label={t("catalogue.chip.blocked", { count: summary.blockedOnSave })}
          onClick={() =>
            navigate({ gap: props.query.gap === "blocked" ? "" : "blocked", page: "1" })
          }
        />
        <GapChip
          active={props.query.gap === "filter"}
          tone="warn"
          count={summary.missingFilterValue}
          label={t("catalogue.chip.filter", { count: summary.missingFilterValue })}
          onClick={() =>
            navigate({ gap: props.query.gap === "filter" ? "" : "filter", page: "1" })
          }
        />
        {summary.untemplated > 0 && (
          <span className="rounded-chip border border-bad-line bg-bad-wash px-2 py-0.5 text-caption text-bad-ink">
            {t("catalogue.chip.untemplated", { count: summary.untemplated })}
          </span>
        )}
        {filtersOn && (
          <button
            type="button"
            onClick={() =>
              navigate({ q: "", categoryId: "", status: "", template: "", gap: "", page: "1" })
            }
            className="rounded-tag text-caption text-moss underline underline-offset-2 focus-visible:shadow-focus focus-visible:outline-none"
          >
            {t("catalogue.filter.clear")}
          </button>
        )}
      </div>

      {/* ── Selection and bulk actions ──────────────────────────────────── */}
      <div aria-live="polite" className="min-h-[1.5rem]">
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-ctl border border-line bg-paper-sunk px-3 py-2">
            <span className="text-body-sm text-ink">
              {wholeSet
                ? t("catalogue.selected_all", { count: targetIds.length })
                : t("catalogue.selected_here", { count: selected.size })}
            </span>
            {/*
              The explicit route to the whole filtered set, with the filter's
              own count in the label. Offered only when there is more to take
              than this page holds — otherwise it is a control that does nothing.
            */}
            {!wholeSet && view.filtered > pageIds.length && (
              <button
                type="button"
                onClick={() => {
                  setWholeSet(true);
                  setSelected(new Set(view.filteredIds));
                }}
                className="rounded-tag text-body-sm text-moss underline underline-offset-2 focus-visible:shadow-focus focus-visible:outline-none"
              >
                {t("catalogue.select_filtered", { count: view.filtered })}
              </button>
            )}

            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => post(props.bulkAction, { action: "publish" })}>
                {t("catalogue.bulk.publish")}
              </Button>
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => setDialog("unpublish")}>
                {t("catalogue.bulk.unpublish")}
              </Button>
              <Button size="sm" variant="secondary" disabled={pending} onClick={openMove}>
                {t("catalogue.bulk.move")}
              </Button>
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => post(props.bulkAction, { action: "out_of_stock" })}>
                {t("catalogue.bulk.out_of_stock")}
              </Button>
            </div>

            <button
              type="button"
              onClick={clearSelection}
              className="rounded-tag text-body-sm text-moss underline underline-offset-2 focus-visible:shadow-focus focus-visible:outline-none"
            >
              {t("catalogue.clear_selection")}
            </button>
            <p className="basis-full text-caption text-muted">{t("catalogue.bulk.hint")}</p>
          </div>
        )}
        {notice && selected.size === 0 && <p className="text-body-sm text-muted">{notice}</p>}
      </div>

      {view.rows.length === 0 ? (
        <Alert
          tone="info"
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                navigate({ q: "", categoryId: "", status: "", template: "", gap: "", page: "1" })
              }
            >
              {t("catalogue.filter.clear")}
            </Button>
          }
        >
          {t("catalogue.empty_filtered_title")}{" "}
          {t("catalogue.empty_filtered_body", { count: formatCount(summary.total) })}
        </Alert>
      ) : (
        <CatalogueTable
          rows={view.rows}
          selected={selected}
          onToggle={toggle}
          onToggleAll={toggleAll}
          allOnPage={allOnPage}
        />
      )}

      <Pagination
        page={view.page}
        pageSize={view.pageSize}
        total={view.filtered}
        onPageChange={(page) => navigate({ page: String(page) })}
        onPageSizeChange={(size) => navigate({ rows: String(size), page: "1" })}
        pageSizeOptions={PAGE_SIZES}
        rangeLabel={(from, to, total) =>
          t("catalogue.range", {
            from: formatCount(from),
            to: formatCount(to),
            total: formatCount(total),
          })
        }
        previousLabel={t("catalogue.previous")}
        nextLabel={t("catalogue.next")}
        pageLabel={(page) => t("catalogue.page", { page: String(page) })}
        threshold={0}
      />

      <UnpublishDialog
        open={dialog === "unpublish"}
        count={targetIds.length}
        live={view.rows.filter((row) => targetIds.includes(row.id) && row.status === "live").length}
        pending={pending}
        onClose={() => setDialog("none")}
        onConfirm={() => post(props.bulkAction, { action: "draft" })}
      />

      <MoveDialog
        open={dialog === "move"}
        count={targetIds.length}
        targets={props.moveTargets}
        value={moveTarget}
        preview={preview}
        pending={pending}
        onChange={loadPreview}
        onClose={() => setDialog("none")}
        onConfirm={() => post(props.moveAction, { categoryId: moveTarget })}
      />

      <NewProductDialog
        open={dialog === "new"}
        name={newName}
        pending={pending}
        onName={setNewName}
        onClose={() => setDialog("none")}
        onCreate={() => {
          const form = new FormData();
          form.set("name", newName);
          setError(null);
          startTransition(async () => {
            const result = await props.createAction(form);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            router.push(`/dashboard/products/${result.id}`);
          });
        }}
      />

      {/*
        The header's `New product` lives in the shell, which is a server
        component and cannot hold this dialog's state — so the control is here,
        under the table, where a seller who has scrolled the list is standing.
      */}
      <div>
        <Button size="sm" onClick={() => setDialog("new")}>
          {t("catalogue.new_product")}
        </Button>
      </div>
    </div>
  );
}

const SORT_LABEL: Record<CatalogueSort, string> = {
  gaps: t("catalogue.sort.gaps"),
  name: t("catalogue.sort.product"),
  sku: t("catalogue.sort.sku"),
  template: t("catalogue.sort.template"),
  stock: t("catalogue.sort.stock"),
  specs: t("catalogue.sort.specs"),
  status: t("catalogue.sort.status"),
  updated: t("catalogue.sort.updated"),
};

function GapChip({
  active,
  tone,
  count,
  label,
  onClick,
}: {
  active: boolean;
  tone: "bad" | "warn";
  count: number;
  label: string;
  onClick: () => void;
}) {
  // Zero renders as a plain fact rather than a clickable filter that would
  // return an empty table — and never as a hidden chip, because "none blocked"
  // is the answer a seller wants when they come looking.
  const palette =
    tone === "bad"
      ? "border-bad-line bg-bad-wash text-bad-ink"
      : "border-warn-line bg-warn-wash text-warn-ink";

  if (count === 0) {
    return (
      <span className="rounded-chip border border-line bg-fill px-2 py-0.5 text-caption text-muted">
        {label}
      </span>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-chip border px-2 py-0.5 text-caption transition-colors duration-120 ease-out focus-visible:outline-none focus-visible:shadow-focus ${palette} ${
        active ? "border-[1.5px] font-medium" : ""
      }`}
    >
      {label}
    </button>
  );
}

function UnpublishDialog({
  open,
  count,
  live,
  pending,
  onClose,
  onConfirm,
}: {
  open: boolean;
  count: number;
  live: number;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("catalogue.unpublish.title", { count })}
      description={t("catalogue.unpublish.body", { count })}
      closeLabel={t("catalogue.cancel")}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t("catalogue.cancel")}
          </Button>
          {/* The confirm repeats the verb. Never "OK". */}
          <Button size="sm" disabled={pending} onClick={onConfirm}>
            {t("catalogue.unpublish.confirm", { count })}
          </Button>
        </>
      }
    >
      {live > 0 && (
        <p className="text-body-sm text-body">{t("catalogue.unpublish.live_note", { count: live })}</p>
      )}
    </Modal>
  );
}

function MoveDialog({
  open,
  count,
  targets,
  value,
  preview,
  pending,
  onChange,
  onClose,
  onConfirm,
}: {
  open: boolean;
  count: number;
  targets: readonly { id: string; name: string }[];
  value: string;
  preview: MovePreview | null;
  pending: boolean;
  onChange: (id: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("catalogue.move.title")}
      description={t("catalogue.move.body")}
      closeLabel={t("catalogue.cancel")}
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t("catalogue.cancel")}
          </Button>
          <Button size="sm" disabled={pending || !preview || preview.products === 0} onClick={onConfirm}>
            {t("catalogue.move.confirm", { count: preview?.products ?? count })}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-body-sm text-ink">{t("catalogue.move.target")}</span>
          <Select
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={t("catalogue.move.choose")}
            options={targets.map((target) => ({ value: target.id, label: target.name }))}
          />
        </label>

        {preview && (
          <div className="flex flex-col gap-2 rounded-ctl border border-line bg-paper-sunk px-3 py-3">
            <p className="text-body-sm text-ink">
              {t("catalogue.move.summary", {
                count: preview.products,
                category: preview.targetCategoryName,
              })}
            </p>
            {preview.alreadyThere > 0 && (
              <p className="text-caption text-muted">
                {t("catalogue.move.already", { count: preview.alreadyThere })}
              </p>
            )}

            {preview.targetUntemplated && (
              <p className="text-body-sm text-bad-ink">{t("catalogue.move.untemplated")}</p>
            )}

            {/*
              The safe case, said plainly. Two subcategories of one trade share
              a template and lose nothing — and a dialog that warned anyway would
              teach the seller to click through the one that matters.
            */}
            {preview.sameTemplate && !preview.targetUntemplated ? (
              <p className="text-body-sm text-ok-ink">{t("catalogue.move.same_template")}</p>
            ) : null}

            {preview.droppedValues > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-body-sm text-warn-ink">
                  {t("catalogue.move.dropped_heading", { count: preview.droppedValues })}
                </p>
                <p className="max-w-prose text-caption text-muted">
                  {t("catalogue.move.dropped_body")}
                </p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {preview.dropped.map((entry) => (
                    <li key={entry.label} className="text-caption text-body">
                      {t("catalogue.move.dropped_row", {
                        label: entry.label,
                        count: entry.products,
                        sample: entry.sample,
                      })}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {preview.facetsGained.length > 0 && (
              <p className="text-caption text-muted">
                {t("catalogue.move.facets_gained", { list: preview.facetsGained.join(", ") })}
              </p>
            )}
            {preview.facetsLost.length > 0 && (
              <p className="text-caption text-warn-ink">
                {t("catalogue.move.facets_lost", { list: preview.facetsLost.join(", ") })}
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function NewProductDialog({
  open,
  name,
  pending,
  onName,
  onClose,
  onCreate,
}: {
  open: boolean;
  name: string;
  pending: boolean;
  onName: (value: string) => void;
  onClose: () => void;
  onCreate: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("catalogue.new_product")}
      description={t("catalogue.new_product_hint")}
      closeLabel={t("catalogue.cancel")}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t("catalogue.cancel")}
          </Button>
          <Button size="sm" disabled={pending || name.trim() === ""} onClick={onCreate}>
            {t("catalogue.new_product_create")}
          </Button>
        </>
      }
    >
      <label className="flex flex-col gap-1">
        <span className="text-body-sm text-ink">{t("catalogue.new_product_named")}</span>
        <Input value={name} onChange={(event) => onName(event.target.value)} />
      </label>
    </Modal>
  );
}
