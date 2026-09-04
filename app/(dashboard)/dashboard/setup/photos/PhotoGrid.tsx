"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { downscaleImage, storedName } from "@/lib/images/downscale";
import type { PhotoActionResult, SignResult } from "./actions";

/**
 * The grid on board 8b.
 *
 * Every label arrives already translated and every number already formatted.
 * This component calls no `t()` and formats nothing — a client component that
 * formatted a count would render one string on the server and another in the
 * browser, which is the single most repeated defect in this codebase.
 *
 * ## What the browser does before a byte leaves it
 *
 * Decode, measure, resize to fit under a megabyte, re-encode. See
 * `lib/images/downscale.ts` for why that is here and not on the server: the
 * seller is on a phone in a warehouse, and uploading eight megabytes so the
 * server can throw seven away is the slowest possible version of this.
 *
 * The only hard refusal is a photograph under 800px on its long edge, which is
 * a thumbnail or a logo in the wrong place. Everything else is resized and
 * accepted.
 *
 * ## What it does not do
 *
 * No blur or darkness check. Board 8b §4 specifies one and it is cut from this
 * phase along with the amber tile it drives — those thresholds need calibrating
 * against real UAE warehouse photographs, and a wrong one nags a seller about a
 * picture they chose, which §4 says is how the task gets abandoned. The green
 * line under a tile is the **slot's** own copy and is never a claim about
 * pixels.
 */

export interface PhotoTile {
  id: string;
  url: string;
  /** The slot's name where it has one, else the seller's own filename. */
  label: string;
  /** The slot's static description. Absent for a photograph filed nowhere. */
  hint?: string;
  isCover: boolean;
  isLogo: boolean;
}

export interface SlotTile {
  key: string;
  label: string;
}

export interface PhotoGridLabels {
  cover: string;
  makeCover: string;
  remove: string;
  moveUp: string;
  moveDown: string;
  logo: string;
  suggested: string;
  add: string;
  reorderHint: string;
  /** Keyed by the refusal `downscaleImage` returns, already interpolated. */
  errorUnreadable: string;
  errorTooSmall: string;
  errorTooLarge: string;
  errorUploadFailed: string;
}

export interface PhotoGridProps {
  tiles: readonly PhotoTile[];
  slots: readonly SlotTile[];
  labels: PhotoGridLabels;
  /** False when the plan's photograph cap is reached. Tiles stay, adding stops. */
  canAdd: boolean;
  accept: string;
  sign: (formData: FormData) => Promise<SignResult>;
  attach: (formData: FormData) => Promise<PhotoActionResult>;
  makeCover: (formData: FormData) => Promise<PhotoActionResult>;
  remove: (formData: FormData) => Promise<PhotoActionResult>;
  reorder: (ids: string[]) => Promise<PhotoActionResult>;
}

export function PhotoGrid({
  tiles,
  slots,
  labels,
  canAdd,
  accept,
  sign,
  attach,
  makeCover,
  remove,
  reorder,
}: PhotoGridProps) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const slotForPick = useRef<string | null>(null);
  const [busy, startTransition] = useTransition();
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  function pick(slotKey: string | null): void {
    slotForPick.current = slotKey;
    input.current?.click();
  }

  async function uploadOne(file: File, slotKey: string | null): Promise<string | null> {
    const shrunk = await downscaleImage(file);
    if (!shrunk.ok) {
      if (shrunk.error === "too_small") return labels.errorTooSmall;
      if (shrunk.error === "too_large") return labels.errorTooLarge;
      return labels.errorUnreadable;
    }

    const { blob, type, width, height, bytes } = shrunk.image;
    const filename = storedName(file.name, type);

    const signForm = new FormData();
    signForm.set("filename", filename);
    signForm.set("type", type);
    signForm.set("bytes", String(bytes));
    const signed = await sign(signForm);
    if (!signed.ok) return signed.error;

    /*
       Straight to Storage. The signed URL is scoped to this one object, so
       there is no bucket-wide write policy and no request body through a
       server action — the shape every other upload here uses.
    */
    const put = await fetch(signed.url, {
      method: "PUT",
      headers: { "content-type": type },
      body: blob,
    });
    if (!put.ok) return labels.errorUploadFailed;

    const attachForm = new FormData();
    attachForm.set("path", signed.path);
    attachForm.set("bytes", String(bytes));
    attachForm.set("width", String(width));
    attachForm.set("height", String(height));
    attachForm.set("filename", file.name);
    if (slotKey) attachForm.set("slotKey", slotKey);
    const written = await attach(attachForm);
    return written.ok ? null : written.error;
  }

  async function onFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;
    const slotKey = slotForPick.current;
    slotForPick.current = null;
    setError(null);

    /*
       One file at a time, and the row is written as each lands. Board 8b calls
       this commit-per-file for a reason: a dropped connection halfway through
       five photographs on a warehouse Wi-Fi loses the one in flight, not the
       four already up.
    */
    const list = Array.from(files);
    for (let index = 0; index < list.length; index += 1) {
      setUploading(list.length - index);
      const failure = await uploadOne(list[index] as File, slotKey);
      if (failure) {
        setError(failure);
        break;
      }
    }
    setUploading(0);
    router.refresh();
  }

  function run(action: () => Promise<PhotoActionResult>): void {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  }

  function move(id: string, by: number): void {
    const order = tiles.map((tile) => tile.id);
    const from = order.indexOf(id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= order.length) return;
    order.splice(to, 0, ...order.splice(from, 1));
    run(() => reorder(order));
  }

  function drop(onto: string): void {
    if (!dragging || dragging === onto) return;
    const order = tiles.map((tile) => tile.id);
    const from = order.indexOf(dragging);
    const to = order.indexOf(onto);
    if (from < 0 || to < 0) return;
    order.splice(to, 0, ...order.splice(from, 1));
    setDragging(null);
    run(() => reorder(order));
  }

  return (
    <div>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple
        /*
           Out of the tab order and out of the accessibility tree. It is driven
           by the buttons below, and an `sr-only` file input with no label is a
           control a screen-reader user meets, cannot name, and did not ask for.
        */
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={(event) => {
          void onFiles(event.target.files);
          event.target.value = "";
        }}
      />

      {error && (
        <p role="alert" className="mb-3 text-body-sm text-bad-ink">
          {error}
        </p>
      )}

      <ul className="grid list-none grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((tile, index) => (
          <li
            key={tile.id}
            draggable={!tile.isLogo}
            onDragStart={() => setDragging(tile.id)}
            onDragEnd={() => setDragging(null)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => drop(tile.id)}
            className={cn(
              "group overflow-hidden rounded-card border border-line bg-card",
              dragging === tile.id && "opacity-50",
            )}
          >
            <div className="relative h-[132px] bg-fill">
              {/*
                A plain img: these are Supabase public URLs on a remote host,
                and next/image would need that host allowlisted in a config this
                project keeps empty. The dimensions are known and written, so
                nothing here shifts as it loads.
              */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={tile.url} alt={tile.label} className="size-full object-cover" />

              {tile.isCover && (
                <span className="absolute start-2 top-2 rounded-tag bg-ink/80 px-2 py-1 font-mono text-eyebrow uppercase text-on-ink">
                  {labels.cover}
                </span>
              )}
              {tile.isLogo && (
                <span className="absolute start-2 top-2 rounded-tag bg-fill px-2 py-1 font-mono text-eyebrow uppercase text-muted">
                  {labels.logo}
                </span>
              )}

              {/*
                Revealed on hover AND on focus-within, so the controls are
                reachable by keyboard. Hover alone would put every action on
                this screen behind a mouse.
              */}
              <div className="absolute inset-x-0 bottom-0 flex flex-wrap gap-1 bg-ink/70 p-1.5 opacity-0 transition-opacity duration-120 ease-out group-focus-within:opacity-100 group-hover:opacity-100">
                {!tile.isCover && !tile.isLogo && (
                  <TileButton
                    label={labels.makeCover}
                    disabled={busy}
                    onClick={() => {
                      const form = new FormData();
                      form.set("id", tile.id);
                      run(() => makeCover(form));
                    }}
                  />
                )}
                <TileButton
                  label={labels.moveUp}
                  disabled={busy || index === 0}
                  onClick={() => move(tile.id, -1)}
                />
                <TileButton
                  label={labels.moveDown}
                  disabled={busy || index === tiles.length - 1}
                  onClick={() => move(tile.id, 1)}
                />
                <TileButton
                  label={labels.remove}
                  disabled={busy}
                  onClick={() => {
                    const form = new FormData();
                    form.set("id", tile.id);
                    run(() => remove(form));
                  }}
                />
              </div>
            </div>

            <div className="px-3.5 py-3">
              <p className="truncate text-body-sm text-ink">{tile.label}</p>
              {tile.hint && <p className="mt-1.5 text-caption text-ok-ink">{tile.hint}</p>}
            </div>
          </li>
        ))}

        {canAdd &&
          slots.map((slot) => (
            <li key={slot.key}>
              <button
                type="button"
                disabled={busy || uploading > 0}
                onClick={() => pick(slot.key)}
                className="flex min-h-[180px] w-full flex-col items-center justify-center gap-2 rounded-card border border-dashed border-line-strong bg-card px-4 text-center transition-colors duration-120 ease-out hover:bg-fill focus-visible:outline-none focus-visible:shadow-focus disabled:cursor-not-allowed"
              >
                <span aria-hidden="true" className="text-h2 text-line-strong">
                  +
                </span>
                <span className="text-body-sm font-medium text-ink">{slot.label}</span>
                <span className="text-caption text-muted">{labels.suggested}</span>
              </button>
            </li>
          ))}
      </ul>

      <div className="mt-3.5 flex flex-wrap items-center gap-3">
        {canAdd && (
          <button
            type="button"
            disabled={busy || uploading > 0}
            onClick={() => pick(null)}
            className="text-body-sm font-medium text-moss underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus disabled:text-disabled-text"
          >
            {labels.add}
          </button>
        )}
        {tiles.length > 1 && <p className="text-caption text-muted">{labels.reorderHint}</p>}
        {uploading > 0 && (
          <p role="status" className="text-caption text-muted">
            {labels.add}
          </p>
        )}
      </div>
    </div>
  );
}

function TileButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-tag px-2 py-1 font-mono text-eyebrow uppercase text-on-ink transition-colors duration-120 ease-out hover:bg-ink-raised focus-visible:outline-none focus-visible:shadow-focus-on-ink disabled:text-on-ink-faint"
    >
      {label}
    </button>
  );
}
