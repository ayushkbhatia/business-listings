"use client";

import { useId, useState, useTransition } from "react";
import { Alert } from "@/components/display";
import { Button, IconButton, Icons, Input, Label, Textarea } from "@/components/primitives";
import { chipLabelProblem, normaliseChipQuery } from "@/lib/content/homepage-rules";
import { t, type MessageKey } from "@/lib/i18n";
import { addChipAction, removeChipAction, type ActionResult } from "./actions";
import type { ChipView } from "./present";

/**
 * Board 6h — the popular-search chips.
 *
 * A chip is a label and the search it runs (`B8`). The "Runs" field takes plain
 * words, or a `/search?…` address copied from the results page with its facets
 * set, and it runs `normaliseChipQuery` — the function the save runs — as it is
 * typed, so the preview under the field is the address the chip will link to.
 */

const MIN_REASON = 4;

export function ChipList({ chips, full, canWrite }: { chips: readonly ChipView[]; full: boolean; canWrite: boolean }) {
  const ids = { label: useId(), query: useId(), reason: useId(), removeReason: useId(), preview: useId() };
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeReason, setRemoveReason] = useState("");
  const [label, setLabel] = useState("");
  const [query, setQuery] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const normalised = query.trim() ? normaliseChipQuery(query) : null;
  const labelProblem = label.trim() ? chipLabelProblem(label) : null;
  const ready = canWrite && !full && !pending && label.trim() !== "" && !labelProblem && normalised?.ok === true && reason.trim().length >= MIN_REASON;
  const removingChip = chips.find((chip) => chip.id === removing) ?? null;

  function run(action: (form: FormData) => Promise<ActionResult>, form: FormData, after: () => void) {
    startTransition(async () => {
      const outcome = await action(form);
      setResult(outcome);
      if (outcome.ok) after();
    });
  }

  return (
    <div>
      {chips.length === 0 ? (
        <p className="text-body-sm text-body">{t("curation.chips.empty")}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <li key={chip.id} className="inline-flex items-center gap-0.5 rounded-chip border border-line bg-paper-sunk py-0.5 ps-3 pe-0.5">
              <a href={chip.href} className="text-body-sm text-ink underline-offset-2 hover:underline focus-visible:rounded-tag focus-visible:shadow-focus focus-visible:outline-none">
                {chip.label}
              </a>
              {canWrite ? (
                <IconButton
                  label={chip.removeLabel}
                  icon={<Icons.Close />}
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  aria-expanded={removing === chip.id}
                  onClick={() => {
                    setRemoving(removing === chip.id ? null : chip.id);
                    setRemoveReason("");
                    setResult(null);
                  }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {removingChip ? (
        <div className="mt-3 rounded-card border border-line bg-card p-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor={ids.removeReason} requirement="required" requirementLabel={t("field.required")}>
              {t("curation.chips.remove_reason", { label: removingChip.label })}
            </Label>
            <Textarea id={ids.removeReason} rows={2} value={removeReason} onChange={(event) => setRemoveReason(event.target.value)} />
          </div>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button
              variant="danger"
              size="sm"
              disabled={pending || removeReason.trim().length < MIN_REASON}
              loading={pending}
              onClick={() => {
                const form = new FormData();
                form.set("id", removingChip.id);
                form.set("reason", removeReason);
                run(removeChipAction, form, () => {
                  setRemoving(null);
                  setRemoveReason("");
                });
              }}
            >
              {t("curation.chips.remove_confirm")}
            </Button>
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => setRemoving(null)}>
              {t("curation.cancel")}
            </Button>
          </div>
        </div>
      ) : null}

      {canWrite && full ? <p className="mt-3 text-caption text-body">{t("curation.chips.full")}</p> : null}

      {canWrite && !full ? (
        <details className="mt-3">
          <summary className="inline-flex h-8 cursor-pointer list-none items-center rounded-ctl border border-dashed border-line-strong bg-card px-3 text-body-sm text-ink hover:bg-paper-sunk focus-visible:shadow-focus focus-visible:outline-none [&::-webkit-details-marker]:hidden">
            {t("curation.chips.add")}
          </summary>
          <div className="mt-2.5 flex flex-col gap-2.5 rounded-card border border-line bg-card p-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor={ids.label} requirement="required" requirementLabel={t("field.required")}>
                {t("curation.chips.label")}
              </Label>
              <Input id={ids.label} value={label} maxLength={60} onChange={(event) => setLabel(event.target.value)} aria-invalid={labelProblem ? true : undefined} />
              {labelProblem ? <p className="text-caption text-bad-ink">{t(`curation.problem.${labelProblem}` as MessageKey)}</p> : null}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={ids.query} requirement="required" requirementLabel={t("field.required")}>
                {t("curation.chips.query")}
              </Label>
              <Input
                id={ids.query}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-describedby={ids.preview}
                aria-invalid={normalised && !normalised.ok ? true : undefined}
              />
              <p id={ids.preview} className={normalised && !normalised.ok ? "text-caption text-bad-ink" : "break-all text-caption text-body"}>
                {normalised === null
                  ? t("curation.chips.query_hint")
                  : normalised.ok
                    ? t("curation.chips.query_preview", { href: `/search?${normalised.query}` })
                    : t(`curation.problem.${normalised.error}` as MessageKey)}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={ids.reason} requirement="required" requirementLabel={t("field.required")}>
                {t("curation.chips.reason")}
              </Label>
              <Textarea id={ids.reason} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
            </div>
            <div>
              <Button
                size="sm"
                disabled={!ready}
                loading={pending}
                onClick={() => {
                  const form = new FormData();
                  form.set("label", label);
                  form.set("query", query);
                  form.set("reason", reason);
                  run(addChipAction, form, () => {
                    setLabel("");
                    setQuery("");
                    setReason("");
                  });
                }}
              >
                {t("curation.chips.add_submit")}
              </Button>
            </div>
          </div>
        </details>
      ) : null}

      {result ? (
        <div className="mt-3">
          <Alert tone={result.ok ? "ok" : "bad"} live={result.ok ? "polite" : "assertive"}>
            {result.ok ? result.message : result.error}
          </Alert>
        </div>
      ) : null}
    </div>
  );
}
