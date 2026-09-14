"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { Alert, StatusBadge } from "@/components/display";
import { Button, Input, Label, Textarea } from "@/components/primitives";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { featureAction, type ActionResult } from "./actions";
import type { BusinessView } from "./present";

/**
 * Board 6h — "+ Add a business".
 *
 * The search is a plain GET form, so the matches are server-rendered and a
 * copied link reopens the same list. A match that cannot be featured is shown,
 * not hidden, with the condition that failed and the account where it gets
 * fixed: the Marina Pumps row on the board. Only the pick and the reason are
 * client state.
 *
 * It fills the first slot nobody holds. A slot held by a business that lost its
 * tier is not free — it is removed first, on purpose (`B2`).
 */

const MIN_REASON = 4;

function Candidate({ business, name, checked, onPick, disabled }: { business: BusinessView; name: string; checked: boolean; onPick: () => void; disabled: boolean }) {
  const id = useId();
  return (
    <div className={cn("flex flex-wrap items-start gap-3 px-3 py-2.5", !business.eligible && "bg-bad-surface")}>
      <input
        id={id}
        type="radio"
        name={name}
        value={business.id}
        checked={checked}
        disabled={disabled || !business.eligible}
        onChange={onPick}
        className="mt-1 size-4 accent-moss focus-visible:shadow-focus focus-visible:outline-none"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={id} className={cn("text-body-sm font-medium", business.eligible ? "text-ink" : "text-bad-ink")}>
            {business.name}
          </label>
          <StatusBadge tone={business.eligible ? "ok" : "bad"} shape="chip" size="sm">
            {business.tierLabel}
          </StatusBadge>
        </div>
        <p className={cn("mt-0.5 text-caption", business.eligible ? "text-body" : "text-bad-ink")}>
          {business.block ?? business.signals}
        </p>
      </div>
      {business.action ? (
        <Link href={business.action.href} className="inline-flex h-8 items-center rounded-ctl border border-bad-line bg-card px-3 text-body-sm text-bad-ink hover:bg-bad-surface focus-visible:shadow-focus focus-visible:outline-none">
          {business.action.label}
        </Link>
      ) : null}
    </div>
  );
}

export function AddBusiness({
  find,
  candidates,
  suggestions,
  firstFree,
  canWrite,
  landmark = true,
}: {
  find: string;
  candidates: readonly BusinessView[];
  suggestions: readonly BusinessView[];
  firstFree: number | null;
  canWrite: boolean;
  /**
   * Off in the gallery. A `<form>` is a landmark, and four specimens of this
   * panel on one page would be four unnamed forms — `landmarks.spec.ts`
   * refuses a page holding two. A specimen's search goes nowhere anyway.
   */
  landmark?: boolean;
}) {
  const Search = landmark ? "form" : "div";
  const ids = { find: useId(), reason: useId(), group: useId(), heading: useId() };
  const [picked, setPicked] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const searched = find.trim().length > 0;
  const list = searched ? candidates : suggestions;
  const ready = canWrite && firstFree !== null && picked !== null && reason.trim().length >= MIN_REASON && !pending;

  function feature() {
    if (!picked) return;
    const form = new FormData();
    form.set("businessId", picked);
    form.set("reason", reason);
    startTransition(async () => {
      const outcome = await featureAction(form);
      setResult(outcome);
      if (outcome.ok) {
        setPicked(null);
        setReason("");
      }
    });
  }

  return (
    <details open={searched || undefined} className="group w-full">
      <summary className="inline-flex h-9 cursor-pointer list-none items-center rounded-ctl border border-dashed border-line-strong bg-card px-4 text-body-sm text-ink hover:bg-paper-sunk focus-visible:shadow-focus focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        {t("curation.add")}
      </summary>

      <div className="mt-3 rounded-card border border-line bg-card p-3 sm:p-4">
        <Search {...(landmark ? { method: "get", action: "/admin/content/home" } : {})} className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
            <Label htmlFor={ids.find}>{t("curation.find_label")}</Label>
            <Input id={ids.find} name="find" defaultValue={find} minLength={2} autoComplete="off" />
          </div>
          <Button type={landmark ? "submit" : "button"} variant="secondary">
            {t("curation.find_submit")}
          </Button>
        </Search>

        <h3 id={ids.heading} className="mt-4 font-mono text-eyebrow uppercase text-muted">
          {searched ? t("curation.find_results", { find: find.trim() }) : t("curation.suggestions")}
        </h3>
        {list.length === 0 ? (
          <p className="mt-1.5 text-body-sm text-body">{searched ? t("curation.find_none") : t("curation.suggestions_none")}</p>
        ) : (
          <div aria-labelledby={ids.heading} role="radiogroup" className="mt-1.5 divide-y divide-line rounded-card border border-line">
            {list.map((business) => (
              <Candidate
                key={business.id}
                business={business}
                name={ids.group}
                checked={picked === business.id}
                onPick={() => {
                  setPicked(business.id);
                  setResult(null);
                }}
                disabled={!canWrite || pending}
              />
            ))}
          </div>
        )}

        {canWrite ? (
          firstFree === null ? (
            <p className="mt-3 text-body-sm text-warn-ink">{t("curation.full")}</p>
          ) : (
            <div className="mt-3 flex flex-col gap-2.5">
              <div className="flex max-w-lg flex-col gap-1">
                <Label htmlFor={ids.reason} requirement="required" requirementLabel={t("field.required")}>
                  {t("curation.feature_reason")}
                </Label>
                <Textarea id={ids.reason} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
              </div>
              <div>
                <Button disabled={!ready} loading={pending} onClick={feature}>
                  {t("curation.feature_submit", { position: String(firstFree) })}
                </Button>
              </div>
            </div>
          )
        ) : null}

        {result ? (
          <div className="mt-3">
            <Alert tone={result.ok ? "ok" : "bad"} live={result.ok ? "polite" : "assertive"}>
              {result.ok ? result.message : result.error}
            </Alert>
          </div>
        ) : null}
      </div>
    </details>
  );
}
