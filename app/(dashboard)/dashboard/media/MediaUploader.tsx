"use client";

import { useState } from "react";
import { Alert } from "@/components/display";
import { FileDrop, Select } from "@/components/primitives";
import { formatCount } from "@/lib/format";
import { downscaleImage, MIN_EDGE, storedName } from "@/lib/images/downscale";
import { t } from "@/lib/i18n";
import type { RecordResult, SignResult } from "./actions";

/**
 * The upload half of board 3i, kept whole.
 *
 * Bytes go straight from the browser to Storage using a signed URL the server
 * issued for one object. An eight-megabyte photograph posted through a server
 * action is eight megabytes of base64 in a request body, and a supplier
 * uploading twenty of them would do that twenty times.
 *
 * Split out of the old `MediaLibrary` because the board replaced everything
 * around it — the grid, the tile, the alt field and the delete button all moved
 * into `MediaBoard` — and this loop did not need correcting. It resizes before
 * anything leaves the browser, because the stored ceiling is one megabyte and a
 * photograph off any current phone is several.
 *
 * `disabled` is the storage cap. Per board 3f §6 the limit is stated before it
 * bites and never destroys a record: the control is off with the reason beside
 * it, and every file already uploaded keeps rendering.
 */

const KINDS = ["gallery", "cover", "logo", "storefront"] as const;

export interface MediaUploaderProps {
  signAction: (formData: FormData) => Promise<SignResult>;
  recordAction: (formData: FormData) => Promise<RecordResult>;
  disabled?: boolean;
}

export function MediaUploader({ signAction, recordAction, disabled }: MediaUploaderProps) {
  const [kind, setKind] = useState<string>("gallery");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  async function upload(files: FileList) {
    setError(null);
    const list = [...files];
    setProgress({ done: 0, total: list.length });

    for (const [index, file] of list.entries()) {
      /*
         Resize before anything leaves the browser.

         The stored ceiling is one megabyte and a photograph off any current
         phone is several, so without this the library would refuse exactly the
         files it exists to accept. Board 8b added `downscaleImage` for its own
         screen; the library uploads into the same bucket and has to obey the
         same rule, or the two screens disagree about what a photograph is.
      */
      const shrunk = await downscaleImage(file);
      if (!shrunk.ok) {
        setError(
          shrunk.error === "too_small"
            ? t("photos.error.too_small", {
                edge: String(shrunk.longEdge ?? 0),
                min: String(MIN_EDGE),
              })
            : shrunk.error === "too_large"
              ? t("photos.error.too_large", { mb: "1" })
              : t("photos.error.unreadable"),
        );
        setProgress(null);
        return;
      }
      const { blob, type, width, height, bytes } = shrunk.image;

      const signForm = new FormData();
      signForm.set("filename", storedName(file.name, type));
      signForm.set("type", type);
      signForm.set("bytes", String(bytes));
      signForm.set("kind", kind);

      const signed = await signAction(signForm);
      if (!signed.ok) {
        setError(signed.error);
        setProgress(null);
        return;
      }

      const response = await fetch(signed.url, {
        method: "PUT",
        headers: { "content-type": type },
        body: blob,
      });
      if (!response.ok) {
        setError(t("media.storage_off"));
        setProgress(null);
        return;
      }

      const recordForm = new FormData();
      recordForm.set("path", signed.path);
      recordForm.set("kind", kind);
      recordForm.set("bytes", String(bytes));
      recordForm.set("width", String(width));
      recordForm.set("height", String(height));
      await recordAction(recordForm);

      setProgress({ done: index + 1, total: list.length });
    }

    setProgress(null);
    // The list is server-rendered, so a reload is what shows the new rows.
    window.location.reload();
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <Alert tone="bad" live="assertive">
          {error}
        </Alert>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex max-w-xs flex-1 flex-col gap-1">
          <span className="text-body-sm text-ink">{t("media.kind_label")}</span>
          <Select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            options={KINDS.map((k) => ({ value: k, label: t(`media.kind.${k}` as never) }))}
          />
        </label>
      </div>

      <FileDrop
        idleLabel={t("media.upload_label")}
        idleHint={t("media.upload_hint")}
        accept="image/jpeg,image/png,image/webp,image/avif"
        multiple
        disabled={disabled}
        state={progress ? "uploading" : "idle"}
        uploadingLabel={
          progress
            ? t("media.uploading", {
                done: formatCount(progress.done),
                total: formatCount(progress.total),
              })
            : undefined
        }
        progress={progress ? Math.round((progress.done / progress.total) * 100) : 0}
        onSelect={upload}
      />
    </div>
  );
}
