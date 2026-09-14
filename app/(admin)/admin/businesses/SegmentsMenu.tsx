"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { Alert } from "@/components/display";
import { Button, Input } from "@/components/primitives";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { SegmentActionResult } from "./actions";

/**
 * Board 4f `B8` — saved segments, as a disclosure.
 *
 * Each entry is a link to its query, so opening a segment runs it (criterion
 * 8); the count beside it was run when the page rendered. Saving stores the
 * view on screen — the canonical query the page already built — under a name.
 * A disclosure rather than a menu widget, for the reason `DataTable`'s row menu
 * gives: `role="menu"` promises arrow-key navigation this does not implement.
 */

export interface SegmentItem {
  id: string;
  name: string;
  query: string;
  count: number;
  createdByName: string | null;
  mayDelete: boolean;
}

export function SegmentsMenu({
  segments,
  currentQuery,
  canSave,
  save,
  remove,
}: {
  segments: readonly SegmentItem[];
  /** The canonical query of the view on screen, without its page. */
  currentQuery: string;
  /** False when nothing is filtered: "everything" is not worth a name. */
  canSave: boolean;
  save: (form: FormData) => Promise<SegmentActionResult>;
  remove: (form: FormData) => Promise<SegmentActionResult>;
}) {
  const nameId = useId();
  const [name, setName] = useState("");
  const [result, setResult] = useState<SegmentActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: (form: FormData) => Promise<SegmentActionResult>, form: FormData) {
    startTransition(async () => {
      const outcome = await action(form);
      setResult(outcome);
      if (outcome.ok) setName("");
    });
  }

  return (
    <details className="relative">
      <summary className="inline-flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-ctl border border-line bg-card px-3.5 text-body-sm text-ink hover:border-line-strong focus-visible:shadow-focus focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        {t("admin.businesses.segments.title")}
        <span aria-hidden="true" className="text-caption text-body">
          ▾
        </span>
      </summary>
      <div className="absolute end-0 z-30 mt-1 w-[22rem] rounded-card border border-line bg-card p-3 shadow-overlay">
        {segments.length === 0 ? (
          <p className="text-body-sm text-body">{t("admin.businesses.segments.empty")}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {segments.map((segment) => (
              <li key={segment.id} className="flex items-center justify-between gap-2">
                <Link
                  href={`/admin/businesses?${segment.query}`}
                  className="min-w-0 flex-1 rounded-tag px-1 py-1 text-body-sm text-ink hover:bg-fill focus-visible:shadow-focus focus-visible:outline-none"
                >
                  <span className="block truncate">{segment.name}</span>
                  <span className="block text-caption text-body">
                    {segment.createdByName
                      ? t("admin.businesses.segments.count_by", { count: segment.count, n: formatCount(segment.count), by: segment.createdByName })
                      : t("admin.businesses.segments.count", { count: segment.count, n: formatCount(segment.count) })}
                  </span>
                </Link>
                {segment.mayDelete ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    aria-label={t("admin.businesses.segments.delete_named", { name: segment.name })}
                    onClick={() => {
                      const form = new FormData();
                      form.set("id", segment.id);
                      run(remove, form);
                    }}
                  >
                    {t("admin.businesses.segments.delete")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 border-t border-line pt-3">
          {canSave ? (
            <div className="flex flex-col gap-2">
              <label htmlFor={nameId} className="text-caption font-medium text-body">
                {t("admin.businesses.segments.save_label")}
              </label>
              <div className="flex gap-2">
                <Input id={nameId} value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
                <Button
                  variant="secondary"
                  disabled={pending || name.trim() === ""}
                  onClick={() => {
                    const form = new FormData();
                    form.set("name", name);
                    form.set("query", currentQuery);
                    run(save, form);
                  }}
                >
                  {t("admin.businesses.segments.save")}
                </Button>
              </div>
              <p className="text-caption text-body">{t("admin.businesses.segments.save_note")}</p>
            </div>
          ) : (
            <p className="text-caption text-body">{t("admin.businesses.segments.filter_first")}</p>
          )}
        </div>

        {result ? (
          <div className="mt-2">
            <Alert tone={result.ok ? "ok" : "bad"} live={result.ok ? "polite" : "assertive"}>
              {result.ok ? result.message : result.error}
            </Alert>
          </div>
        ) : null}
      </div>
    </details>
  );
}
