"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Alert } from "@/components/display";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { ActionResult } from "./actions";

/**
 * Board 3b §Photos — **references into `3i`, and the label says so.**
 *
 * The board this replaces read `28 uploaded, first 6 shown on the storefront`,
 * which said the editor stores files. It does not: the media library owns them,
 * one file can serve a product and a storefront at once, and this grid decides
 * which of them lead the public page and in what order.
 *
 * Two consequences that are code, not copy:
 *
 *   · the seventh tile is **`Choose from library`**, not `+ 22`. An overflow
 *     count implied the other twenty-two were also somehow published.
 *   · removing **unpicks** — criterion 7. The file, its alt text and its folder
 *     are untouched and `3i` still lists it. Deleting is `3i`'s action, behind
 *     `3i`'s blast-radius warning, because a file may be cited by a quote a
 *     buyer already holds.
 */
export interface PhotoPickerProps {
  picked: { id: string; url: string; alt: string | null; isCover: boolean; sortOrder: number }[];
  libraryCount: number;
  library: { id: string; url: string; alt: string | null }[];
  editable: boolean;
  open: boolean;
  setOpen: (value: boolean) => void;
  unpickAction: (formData: FormData) => Promise<ActionResult>;
  pickAction: (formData: FormData) => Promise<ActionResult>;
  coverAction: (formData: FormData) => Promise<ActionResult>;
}

export function PhotoPicker(props: PhotoPickerProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: (formData: FormData) => Promise<ActionResult>, id: string) {
    const form = new FormData();
    form.set("id", id);
    setError(null);
    startTransition(async () => {
      const result = await action(form);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="flex flex-wrap items-baseline gap-2">
        <span className="text-body-sm text-ink">{t("listing.photos")}</span>
        {/*
           Both numbers, and both are queries. The picked count and the library
           count are different facts and the sentence only means something with
           each of them in it.
        */}
        <span className="text-caption text-body">
          {t("listing.photos_meta", {
            picked: formatCount(props.picked.length),
            total: formatCount(props.libraryCount),
          })}
        </span>
      </span>

      {error && <Alert tone="bad" live="assertive">{error}</Alert>}

      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 board:grid-cols-7">
        {props.picked.map((photo) => (
          <li key={photo.id} className="relative">
            <span className="block aspect-square overflow-hidden rounded-ctl border border-line bg-fill">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.url}
                alt={photo.alt ?? ""}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </span>
            {photo.isCover && (
              <span className="absolute bottom-1 left-1 rounded-chip bg-ink px-1.5 py-px font-mono text-eyebrow uppercase tracking-eyebrow text-on-ink">
                {t("listing.cover")}
              </span>
            )}
            {props.editable && (
              <span className="mt-1 flex items-center justify-between gap-1">
                {!photo.isCover && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(props.coverAction, photo.id)}
                    className="text-caption text-body underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                  >
                    {t("listing.make_cover")}
                  </button>
                )}
                <button
                  type="button"
                  disabled={pending}
                  aria-label={t("listing.remove_photo", { name: photo.alt ?? t("listing.photo") })}
                  onClick={() => run(props.unpickAction, photo.id)}
                  className="ml-auto text-caption text-body underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                >
                  {t("listing.remove")}
                </button>
              </span>
            )}
          </li>
        ))}

        {props.editable && (
          <li>
            <button
              type="button"
              onClick={() => props.setOpen(!props.open)}
              aria-expanded={props.open}
              className="flex aspect-square w-full items-center justify-center rounded-ctl border border-dashed border-line-strong bg-card px-2 text-center text-caption text-body hover:border-moss hover:text-ink focus-visible:outline-none focus-visible:shadow-focus"
            >
              {t("listing.choose_from_library")}
            </button>
          </li>
        )}
      </ul>

      {props.open && (
        <div className="rounded-card border border-line bg-paper-sunk p-3">
          {props.library.length === 0 ? (
            <p className="text-caption text-body">
              {t("listing.library_empty")}{" "}
              <Link
                href="/dashboard/media"
                className="text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
              >
                {t("listing.open_library")}
              </Link>
            </p>
          ) : (
            <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6 board:grid-cols-8">
              {props.library.map((file) => (
                <li key={file.id}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(props.pickAction, file.id)}
                    aria-label={t("listing.add_photo", { name: file.alt ?? t("listing.photo") })}
                    className="block aspect-square w-full overflow-hidden rounded-ctl border border-line bg-fill focus-visible:outline-none focus-visible:shadow-focus"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={file.url}
                      alt={file.alt ?? ""}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-caption text-body">{t("listing.picker_note")}</p>
        </div>
      )}
    </div>
  );
}
