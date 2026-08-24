"use client";

import { useState, useTransition } from "react";
import { Button, FileDrop, Input, Select } from "@/components/primitives";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { MediaResult, RecordResult, SignResult } from "./actions";

/**
 * Board 3i — the media library.
 *
 * Bytes go straight from the browser to Storage using a signed URL the server
 * issued for one object. An eight-megabyte photograph posted through a server
 * action is eight megabytes of base64 in a request body, and a supplier
 * uploading twenty of them would do that twenty times.
 *
 * The description field is not optional decoration. It is what a buyer using a
 * screen reader hears, and the hint says so — "photo" as alt text is worse than
 * nothing, because it passes a checker and tells a person nothing.
 */

export interface MediaItem {
  id: string;
  url: string;
  kind: string;
  alt: string | null;
  attachedTo: string | null;
}

export interface MediaLibraryProps {
  items: readonly MediaItem[];
  signAction: (formData: FormData) => Promise<SignResult>;
  recordAction: (formData: FormData) => Promise<RecordResult>;
  saveAltAction: (formData: FormData) => Promise<MediaResult>;
  deleteAction: (formData: FormData) => Promise<MediaResult>;
}

const KINDS = ["gallery", "cover", "logo", "storefront"] as const;

export function MediaLibrary({
  items,
  signAction,
  recordAction,
  saveAltAction,
  deleteAction,
}: MediaLibraryProps) {
  const [kind, setKind] = useState<string>("gallery");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [pending] = useTransition();

  async function upload(files: FileList) {
    setError(null);
    const list = [...files];
    setProgress({ done: 0, total: list.length });

    for (const [index, file] of list.entries()) {
      const signForm = new FormData();
      signForm.set("filename", file.name);
      signForm.set("type", file.type);
      signForm.set("bytes", String(file.size));
      signForm.set("kind", kind);

      const signed = await signAction(signForm);
      if (!signed.ok) {
        setError(signed.error);
        setProgress(null);
        return;
      }

      const response = await fetch(signed.url, {
        method: "PUT",
        headers: { "content-type": file.type },
        body: file,
      });
      if (!response.ok) {
        setError(t("media.storage_off"));
        setProgress(null);
        return;
      }

      const recordForm = new FormData();
      recordForm.set("path", signed.path);
      recordForm.set("kind", kind);
      recordForm.set("bytes", String(file.size));
      await recordAction(recordForm);

      setProgress({ done: index + 1, total: list.length });
    }

    setProgress(null);
    // The list is server-rendered, so a reload is what shows the new rows.
    window.location.reload();
  }

  return (
    <div className="flex flex-col gap-5">
      {error && (
        <div
          role="alert"
          className="rounded-ctl border border-bad-line bg-bad-surface px-3 py-2 text-body-sm text-bad-ink"
        >
          {error}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <label className="flex max-w-xs flex-col gap-1">
          <span className="text-body-sm text-ink">{t("media.kind_label")}</span>
          <Select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            options={KINDS.map((k) => ({ value: k, label: t(`media.kind.${k}` as never) }))}
          />
        </label>

        <FileDrop
          idleLabel={t("media.upload_label")}
          idleHint={t("media.upload_hint")}
          accept="image/jpeg,image/png,image/webp,image/avif"
          multiple
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

      {items.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-2 overflow-hidden rounded-card border border-line bg-card"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.url}
                alt={item.alt ?? ""}
                className="aspect-[4/3] w-full object-cover"
                loading="lazy"
              />
              <div className="flex flex-col gap-2 p-3">
                <span className="font-mono text-eyebrow uppercase text-faint">
                  {t(`media.kind.${item.kind}` as never)}
                  {item.attachedTo
                    ? ` · ${t("media.attached_to", { name: item.attachedTo })}`
                    : ` · ${t("media.unattached")}`}
                </span>
                <AltField id={item.id} alt={item.alt} action={saveAltAction} />
                {/* A stretch item in a flex column fills the row; delete is not
                    a primary action and must not look like one. */}
                <div className="self-start">
                  <DeleteButton id={item.id} action={deleteAction} disabled={pending} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AltField({
  id,
  alt,
  action,
}: {
  id: string;
  alt: string | null;
  action: (formData: FormData) => Promise<MediaResult>;
}) {
  const [value, setValue] = useState(alt ?? "");
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1">
        <span className="text-caption text-muted">{t("media.alt_label")}</span>
        <Input
          size="sm"
          value={value}
          placeholder={t("media.alt_missing")}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
        />
      </label>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() => {
            const form = new FormData();
            form.set("id", id);
            form.set("alt", value);
            startTransition(async () => {
              const result = await action(form);
              if (result.ok) setSaved(true);
            });
          }}
        >
          {t("media.save_alt")}
        </Button>
        <span aria-live="polite" className="text-caption text-muted">
          {saved ? t("product.saved") : ""}
        </span>
      </div>
    </div>
  );
}

function DeleteButton({
  id,
  action,
  disabled,
}: {
  id: string;
  action: (formData: FormData) => Promise<MediaResult>;
  disabled: boolean;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="danger"
      disabled={disabled || pending}
      onClick={() => {
        if (!window.confirm(t("media.confirm_delete"))) return;
        const form = new FormData();
        form.set("id", id);
        startTransition(async () => {
          await action(form);
          window.location.reload();
        });
      }}
    >
      {t("media.delete")}
    </Button>
  );
}
