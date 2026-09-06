"use client";

import { useMemo, useState, useTransition } from "react";
import { Alert } from "@/components/display";
import { Button, Label, Select, Textarea } from "@/components/primitives";
import { Modal, Panel } from "@/components/structure";
import type { LibraryFile } from "@/lib/media/library";
import type { DeletePreview } from "@/lib/media/service";
import { formatBytes, formatCount, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Board 3i §4–§6 — the grid, the detail panel and the bulk bar.
 *
 * ## The board could attach and move files but never show you one
 *
 * Selecting a file offered only bulk actions: there was nowhere to see or edit
 * alt text, check dimensions or weight, see what references a file, or replace
 * it. Every other screen in the wave has a rail scoped to the selection (`3h`
 * §7, `3g` §5, `4e` §5). Without one, the `14 missing alt text` chip counted a
 * problem the screen had no way to fix.
 *
 * ## Everything the panel needs is already loaded
 *
 * References come down with the files, so selecting one costs no round trip and
 * the blast radius is on screen before the seller reaches for `Delete…`. The
 * delete preview is the one action that asks the server, because the refusal
 * has to be computed against the database rather than against a snapshot the
 * page has been holding since it rendered.
 *
 * Labels arrive pre-resolved as strings: `t()` cannot cross into a client
 * component, and this repo's most repeated defect is trying.
 */

export interface ProductOption {
  id: string;
  label: string;
}

export interface FolderOption {
  id: string | null;
  name: string;
}

export interface MediaBoardProps {
  files: readonly LibraryFile[];
  folders: readonly FolderOption[];
  products: readonly ProductOption[];
  /** The folder being viewed, for the bulk bar's scope line. */
  scopeName: string;
  totalBytes: number;
  previewDelete: (fileId: string) => Promise<
    { ok: true; value: DeletePreview } | { ok: false; message: string }
  >;
  deleteFile: (formData: FormData) => Promise<void>;
  saveAlt: (formData: FormData) => Promise<void>;
  attachToProduct: (formData: FormData) => Promise<void>;
  detachFromProduct: (formData: FormData) => Promise<void>;
  setPrimary: (formData: FormData) => Promise<void>;
  moveToFolder: (formData: FormData) => Promise<void>;
}

export function MediaBoard(props: MediaBoardProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<DeletePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const focused = useMemo(
    () => props.files.find((file) => file.id === selected[0]) ?? null,
    [props.files, selected],
  );

  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );

  async function openDelete(fileId: string) {
    setError(null);
    const result = await props.previewDelete(fileId);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setPreview(result.value);
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[var(--gutter)] xl:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {error && (
          <Alert tone="bad" live="assertive" fix={t("media.delete.refused_fix")}>
            {error}
          </Alert>
        )}

        <ul
          aria-label={t("media.grid_label")}
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 board:grid-cols-4"
        >
          {props.files.map((file) => (
            <Tile
              key={file.id}
              file={file}
              checked={selected.includes(file.id)}
              onToggle={() => toggle(file.id)}
            />
          ))}
        </ul>

        {selected.length > 0 && (
          <BulkBar
            count={selected.length}
            scopeName={props.scopeName}
            folders={props.folders}
            products={props.products}
            selected={selected}
            attachToProduct={props.attachToProduct}
            moveToFolder={props.moveToFolder}
            onClear={() => setSelected([])}
            onDelete={() => selected[0] && openDelete(selected[0])}
          />
        )}
      </div>

      <div className="w-full shrink-0 xl:w-[268px]">
        <DetailPanel
          file={focused}
          index={focused ? props.files.findIndex((f) => f.id === focused.id) + 1 : 0}
          total={props.files.length}
          totalBytes={props.totalBytes}
          saveAlt={props.saveAlt}
          detachFromProduct={props.detachFromProduct}
          setPrimary={props.setPrimary}
          onDelete={() => focused && openDelete(focused.id)}
        />
      </div>

      {preview && (
        <DeleteModal
          preview={preview}
          pending={pending}
          onClose={() => setPreview(null)}
          onConfirm={() => {
            const form = new FormData();
            form.set("fileId", preview.fileId);
            start(async () => {
              await props.deleteFile(form);
              setPreview(null);
              setSelected([]);
            });
          }}
        />
      )}
    </div>
  );
}

/* ── Tile ────────────────────────────────────────────────────────────────── */

function Tile({
  file,
  checked,
  onToggle,
}: {
  file: LibraryFile;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="min-w-0">
      <label
        className={`relative flex cursor-pointer flex-col overflow-hidden rounded-card border bg-card focus-within:shadow-focus ${
          checked ? "border-[1.5px] border-ink" : "border-line"
        }`}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          aria-label={t("media.select_file", { name: file.filename })}
          className="absolute left-2 top-2 z-10 h-4 w-4 accent-[color:var(--ink)]"
        />

        <span className="relative block h-[7.5rem] w-full bg-paper-sunk">
          {file.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={file.url} alt="" className="h-full w-full object-cover" />
          ) : (
            /*
               A document renders its type rather than a fake preview. A generic
               placeholder that looks like a broken image is the one thing the
               spec rules out here.
            */
            <span className="flex h-full w-full items-center justify-center font-mono text-caption uppercase text-muted">
              {file.format}
            </span>
          )}
        </span>

        <Badges file={file} />

        <span className="flex flex-col gap-0.5 px-2 py-1.5">
          <span className="truncate text-body-sm text-ink">{file.filename}</span>
          <span className="truncate font-mono text-eyebrow uppercase text-muted">
            {file.productCount > 0
              ? t("media.tile_products", {
                  count: file.productCount,
                  n: formatCount(file.productCount),
                })
              : (file.references[0]?.label ?? t("media.tile_unattached"))}
          </span>
        </span>
      </label>
    </li>
  );
}

/**
 * Every state as a word. Never colour alone — acceptance criterion 15.
 *
 * `NO ALT` names the page it is failing on, because the board's unscoped chip
 * counted a problem and pointed at nothing.
 */
function Badges({ file }: { file: LibraryFile }) {
  if (file.badges.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1 px-2 pt-1.5">
      {file.badges.map((badge) => (
        <span
          key={badge}
          className={`rounded-chip px-1.5 py-px font-mono text-eyebrow uppercase ${TONE[badge]}`}
        >
          {badge === "no_alt"
            ? file.liveSurface
              ? t("media.badge.no_alt", { where: file.liveSurface })
              : t("media.badge.no_alt_plain")
            : badge === "quote_held"
              ? t("media.badge.quote_held")
              : badge === "unreferenced"
                ? t("media.badge.unreferenced")
                : t("media.badge.primary")}
        </span>
      ))}
    </span>
  );
}

const TONE: Record<string, string> = {
  no_alt: "bg-warn-surface text-warn-ink",
  quote_held: "bg-paper-sunk text-body",
  unreferenced: "bg-bad-surface text-bad-ink",
  primary: "bg-ok-surface text-ok-ink",
};

/* ── Detail panel ────────────────────────────────────────────────────────── */

function DetailPanel({
  file,
  index,
  total,
  totalBytes,
  saveAlt,
  detachFromProduct,
  setPrimary,
  onDelete,
}: {
  file: LibraryFile | null;
  index: number;
  total: number;
  totalBytes: number;
  saveAlt: (formData: FormData) => Promise<void>;
  detachFromProduct: (formData: FormData) => Promise<void>;
  setPrimary: (formData: FormData) => Promise<void>;
  onDelete: () => void;
}) {
  if (!file) {
    /*
       Folder totals rather than an empty rail — board 3i's `Nothing selected`
       state. A panel that renders nothing is 268px of dead column, which is the
       defect `6d`'s stranded rail was corrected for.
    */
    return (
      <Panel eyebrow={t("media.panel.none")}>
        <p className="text-caption text-muted">
          {t("media.panel.none_body", {
            count: total,
            n: formatCount(total),
            size: formatBytes(totalBytes),
          })}
        </p>
      </Panel>
    );
  }

  const products = file.references.filter((reference) => reference.kind === "product");

  return (
    <Panel
      eyebrow={`${t("media.panel.title")} · ${t("media.panel.of", { index: String(index), total: formatCount(total) })}`}
    >
      <div className="flex flex-col gap-3">
        <span className="block h-[7.5rem] w-full overflow-hidden rounded-ctl bg-paper-sunk">
          {file.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={file.url} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center font-mono text-caption uppercase text-muted">
              {file.format}
            </span>
          )}
        </span>

        <p className="break-all text-body-sm text-ink">{file.filename}</p>

        <dl className="flex flex-col gap-1">
          <Row label={t("media.panel.dimensions")}>
            {file.width && file.height ? `${file.width} × ${file.height}` : "—"}
          </Row>
          <Row label={t("media.panel.size")}>
            {file.bytes > 0 ? `${formatBytes(file.bytes)} · ${file.format}` : file.format}
          </Row>
          <Row label={t("media.panel.uploaded")}>{formatDate(file.createdAt)}</Row>
        </dl>

        {file.kind === "image" ? (
          <form action={saveAlt} className="flex flex-col gap-1">
            <input type="hidden" name="fileId" value={file.id} />
            <Label htmlFor={`alt-${file.id}`}>{t("media.panel.alt")}</Label>
            <Textarea id={`alt-${file.id}`} name="alt" rows={2} defaultValue={file.alt ?? ""} />
            <p className="text-caption text-muted">{t("media.panel.alt_hint")}</p>
            <Button type="submit" variant="secondary" size="sm">
              {t("media.save_alt")}
            </Button>
          </form>
        ) : (
          <p className="text-caption text-muted">{t("media.panel.alt_document")}</p>
        )}

        <div className="flex flex-col gap-1">
          <p className="font-mono text-eyebrow uppercase text-muted">{t("media.panel.used_in")}</p>
          {file.references.length === 0 ? (
            <p className="text-caption text-muted">{t("media.panel.used_nowhere")}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {file.references.map((reference, i) => (
                <li
                  key={`${reference.kind}-${reference.label}-${i}`}
                  className="flex items-baseline justify-between gap-2"
                >
                  <span className="min-w-0 truncate text-body-sm text-body">{reference.label}</span>
                  {reference.primary && (
                    <span className="shrink-0 rounded-chip bg-ok-surface px-1.5 py-px font-mono text-eyebrow uppercase text-ok-ink">
                      {t("media.badge.primary")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Making a file primary is setting it to position zero on that
            product; there is no flag, so 1g's gallery cannot disagree. */}
        {file.kind === "image" &&
          products
            .filter((reference) => !reference.primary)
            .map((reference) => (
              <form key={reference.href} action={setPrimary}>
                <input type="hidden" name="fileId" value={file.id} />
                <input type="hidden" name="productId" value={idFromHref(reference.href)} />
                <Button type="submit" variant="ghost" size="sm">
                  {t("media.panel.make_primary", { product: reference.label })}
                </Button>
              </form>
            ))}

        {products.length > 0 && (
          <form action={detachFromProduct} className="flex flex-col gap-1">
            <input type="hidden" name="fileId" value={file.id} />
            <Label htmlFor={`detach-${file.id}`}>{t("media.panel.detach_which")}</Label>
            <Select
              id={`detach-${file.id}`}
              name="productId"
              options={products.map((reference) => ({
                value: idFromHref(reference.href),
                label: reference.label,
              }))}
            />
            <Button type="submit" variant="secondary" size="sm">
              {t("media.panel.detach")}
            </Button>
          </form>
        )}

        <Button type="button" variant="danger" size="sm" onClick={onDelete}>
          {t("media.panel.delete")}
        </Button>

        {file.productCount > 0 && (
          <p className="text-caption text-muted">
            {t("media.panel.shared_note", {
              count: file.productCount,
              n: formatCount(file.productCount),
            })}
          </p>
        )}
      </div>
    </Panel>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="font-mono text-eyebrow uppercase text-muted">{label}</dt>
      <dd className="font-mono tabular-nums text-caption text-body">{children}</dd>
    </div>
  );
}

const idFromHref = (href: string | undefined): string => href?.split("/").pop() ?? "";

/* ── Bulk bar ────────────────────────────────────────────────────────────── */

function BulkBar({
  count,
  scopeName,
  folders,
  products,
  selected,
  attachToProduct,
  moveToFolder,
  onClear,
  onDelete,
}: {
  count: number;
  scopeName: string;
  folders: readonly FolderOption[];
  products: readonly ProductOption[];
  selected: readonly string[];
  attachToProduct: (formData: FormData) => Promise<void>;
  moveToFolder: (formData: FormData) => Promise<void>;
  onClear: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-card bg-ink px-3 py-2 text-on-ink">
      {/* Scope stated, per 3f §3: "2 selected" is ambiguous across a filtered
          grid, and a bulk delete is the wrong place to be ambiguous. */}
      <span className="text-body-sm">
        {t("media.bulk.scope", { count, n: formatCount(count), folder: scopeName })}
      </span>

      <form action={attachToProduct} className="flex items-center gap-1.5">
        {selected.map((id) => (
          <input key={id} type="hidden" name="fileId" value={id} />
        ))}
        <Select
          name="productId"
          aria-label={t("media.bulk.attach")}
          options={products.map((product) => ({ value: product.id, label: product.label }))}
        />
        <Button type="submit" variant="secondary" size="sm">
          {t("media.bulk.attach")}
        </Button>
      </form>

      <form action={moveToFolder} className="flex items-center gap-1.5">
        {selected.map((id) => (
          <input key={id} type="hidden" name="fileId" value={id} />
        ))}
        <Select
          name="folderId"
          aria-label={t("media.bulk.move")}
          options={folders.map((folder) => ({
            value: folder.id ?? "",
            label: folder.name,
          }))}
        />
        <Button type="submit" variant="secondary" size="sm">
          {t("media.bulk.move")}
        </Button>
      </form>

      <Button type="button" variant="danger" size="sm" onClick={onDelete}>
        {t("media.bulk.delete")}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onClear}>
        {t("media.bulk.clear")}
      </Button>
    </div>
  );
}

/* ── Delete preview ──────────────────────────────────────────────────────── */

/**
 * The preview that names what changes, and the refusal that is not a warning.
 *
 * `3f` §3's convention: an action ending in `…` opens a preview. For a shared
 * file it names every product affected and calls out any where the file is
 * primary, because `1g` falls back to the next image and `3f`'s row will read
 * *no photo*. Where a buyer holds a quote citing the file there is no confirm
 * button at all — the control is absent, not disabled with a warning beside it.
 */
function DeleteModal({
  preview,
  pending,
  onClose,
  onConfirm,
}: {
  preview: DeletePreview;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const refused = preview.holders.length > 0;

  return (
    <Modal
      open
      onClose={onClose}
      title={refused ? t("media.delete.refused") : t("media.delete.title", { name: preview.filename })}
      closeLabel={t("media.delete.cancel")}
    >
      <div className="flex flex-col gap-3">
        {refused ? (
          /*
             `fix` rather than `action`: there is no control to offer here —
             the way out is a different action on a different panel, so the
             answer is a sentence. The design system refuses a `bad` notice
             without one, and it caught this the first time the modal rendered.
          */
          <Alert tone="bad" fix={t("media.delete.refused_fix")}>
            {t("media.delete.refused_body", {
              count: preview.holders.length,
              quotes: preview.holders.join(", "),
            })}
          </Alert>
        ) : (
          <>
            {preview.products.length === 0 && preview.otherReferences.length === 0 ? (
              <p className="text-body-sm text-body">{t("media.delete.nothing")}</p>
            ) : (
              <>
                {preview.products.length > 0 && (
                  <p className="text-body-sm text-body">
                    {t("media.delete.products", {
                      count: preview.products.length,
                      n: formatCount(preview.products.length),
                      names: preview.products.join(", "),
                    })}
                  </p>
                )}
                {preview.otherReferences.length > 0 && (
                  <p className="text-body-sm text-body">
                    {t("media.delete.elsewhere", {
                      count: preview.otherReferences.length,
                      names: preview.otherReferences.join(", "),
                    })}
                  </p>
                )}
              </>
            )}
            {preview.primaryFor.length > 0 && (
              <Alert tone="warn" fix={t("media.delete.primary_fix")}>
                {t("media.delete.primary", {
                  count: preview.primaryFor.length,
                  names: preview.primaryFor.join(", "),
                })}
              </Alert>
            )}
          </>
        )}

        <div className="flex flex-wrap gap-2">
          {!refused && (
            <Button type="button" variant="danger" onClick={onConfirm} disabled={pending}>
              {t("media.delete.confirm")}
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("media.delete.cancel")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
