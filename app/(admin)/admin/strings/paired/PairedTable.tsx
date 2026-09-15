"use client";

import { Fragment, useId, useState, useTransition } from "react";
import { Alert } from "@/components/display";
import { Button, Label, Textarea } from "@/components/primitives";
import { cn } from "@/lib/cn";
import { valueProblem } from "@/lib/i18n/paired-value";
import { t, type MessageKey } from "@/lib/i18n";
import { restoreHalfAction, suppressHalfAction, writeHalfAction, type ActionResult } from "./actions";
import type { HalfCellView, HalfEditorView, PairedRowView } from "./present";

/**
 * Board `12g-s` — the paired keys, with a way to write the half that is missing.
 *
 * The board draws the table; the writes are what make a count of unwritten
 * twins a list somebody can close. Each half has its own editor because each half is
 * its own decision and its own audit row. The value runs `valueProblem` — the
 * check the save runs — as it is typed, so a placeholder the screen does not
 * supply or a banned word is a line under the box rather than a refusal.
 */

const MIN_REASON = 4;

const CELL_TONE: Record<HalfCellView["tone"], string> = {
  written: "text-ink",
  missing: "text-bad-ink",
  suppressed: "text-body",
};

function Cell({ view }: { view: HalfCellView }) {
  return (
    <td className="px-3 py-3 align-top">
      <span className={cn("block text-body-sm", CELL_TONE[view.tone])}>{view.text}</span>
      {view.caption ? <span className="mt-0.5 block text-caption text-body">{view.caption}</span> : null}
    </td>
  );
}

function problemText(problem: NonNullable<ReturnType<typeof valueProblem>>): string {
  if (problem.error === "unknown_placeholder") {
    return t("strings.paired.error.unknown_placeholder", {
      names: (problem.detail?.placeholders ?? []).map((name) => `{${name}}`).join(", "),
    });
  }
  if (problem.error === "vocabulary") return t("strings.paired.error.vocabulary", { match: problem.detail?.match ?? "" });
  return t(`strings.paired.error.${problem.error}` as MessageKey);
}

function HalfEditor({ rowKey, params, view }: { rowKey: string; params: readonly string[]; view: HalfEditorView }) {
  const ids = { value: useId(), reason: useId(), hint: useId(), problem: useId() };
  const [basedOn, setBasedOn] = useState(view.version);
  const [value, setValue] = useState(view.seed);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  // A write here or in another tab re-renders the page with a new version. Adopt its words, keep the message.
  if (view.version !== basedOn) {
    setBasedOn(view.version);
    setValue(view.seed);
  }

  const edited = value.trim() !== view.seed.trim();
  const problem = edited ? valueProblem({ params }, value) : null;
  const reasoned = reason.trim().length >= MIN_REASON;

  function run(action: (form: FormData) => Promise<ActionResult>, withValue: boolean) {
    const form = new FormData();
    form.set("key", rowKey);
    form.set("half", view.half);
    form.set("reason", reason);
    form.set("basedOn", view.version ?? "");
    if (withValue) form.set("value", value);
    startTransition(async () => {
      const outcome = await action(form);
      setResult(outcome);
      if (outcome.ok) setReason("");
    });
  }

  return (
    <fieldset className="flex min-w-0 flex-col gap-2.5 rounded-card border border-line bg-card p-3">
      <legend className="px-1 font-mono text-eyebrow uppercase text-body">{view.label}</legend>
      {view.suppressedNow ? <p className="text-caption text-body">{t("strings.paired.editor.suppressed_now")}</p> : null}

      <div className="flex flex-col gap-1">
        <Label htmlFor={ids.value}>{t("strings.paired.editor.value")}</Label>
        <Textarea
          id={ids.value}
          rows={3}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setResult(null);
          }}
          aria-describedby={problem ? `${ids.hint} ${ids.problem}` : ids.hint}
          aria-invalid={problem ? true : undefined}
        />
        <p id={ids.hint} className="text-caption text-body">
          {params.length > 0 ? (
            <>
              {t("strings.paired.placeholders")}:{" "}
              {params.map((name) => (
                <code key={name} className="me-1 rounded-tag border border-line bg-paper-sunk px-1 font-mono text-caption text-ink">
                  {`{${name}}`}
                </code>
              ))}
              {t("strings.paired.editor.value_hint")}
            </>
          ) : (
            <>
              {t("strings.paired.editor.no_placeholders")} {t("strings.paired.editor.value_hint")}
            </>
          )}
        </p>
        {problem ? (
          <p id={ids.problem} className="text-caption text-bad-ink">
            {problemText(problem)}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor={ids.reason} requirement="required" requirementLabel={t("field.required")}>
          {t("strings.paired.editor.reason")}
        </Label>
        <Textarea id={ids.reason} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={pending || !edited || problem !== null || !value.trim() || !reasoned}
          loading={pending}
          onClick={() => run(writeHalfAction, true)}
        >
          {t("strings.paired.editor.save", { half: view.label.toLowerCase() })}
        </Button>
        {view.canSuppress ? (
          <Button size="sm" variant="secondary" disabled={pending || !reasoned} onClick={() => run(suppressHalfAction, false)}>
            {t("strings.paired.editor.suppress")}
          </Button>
        ) : null}
        {view.canRestore ? (
          <Button size="sm" variant="ghost" disabled={pending || !reasoned} onClick={() => run(restoreHalfAction, false)}>
            {t("strings.paired.editor.restore")}
          </Button>
        ) : null}
      </div>
      {view.canRestore && view.restoreNote ? <p className="text-caption text-body">{view.restoreNote}</p> : null}

      {result ? (
        <Alert tone={result.ok ? "ok" : "bad"} live={result.ok ? "polite" : "assertive"}>
          {result.ok ? result.message : result.error}
        </Alert>
      ) : null}
    </fieldset>
  );
}

export function PairedTable({
  rows,
  caption,
  empty,
  canWrite,
}: {
  rows: readonly PairedRowView[];
  caption: string;
  empty: string | null;
  canWrite: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const columns = canWrite ? (["key", "goods", "services", "board", "edit"] as const) : (["key", "goods", "services", "board"] as const);

  return (
    <div tabIndex={0} className="overflow-x-auto focus-visible:shadow-focus focus-visible:outline-none">
      <table className="w-full min-w-[48rem] border-collapse text-body-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-paper-sunk">
          <tr>
            {columns.map((col) => (
              <th
                key={col}
                scope="col"
                className={cn(
                  "px-3 py-2.5 text-left font-mono text-colhead font-medium uppercase text-muted first:ps-4 sm:first:ps-5",
                  col === "edit" && "text-right last:pe-4 sm:last:pe-5",
                )}
              >
                {col === "edit" ? <span className="sr-only">{t("strings.paired.col.edit")}</span> : t(`strings.paired.col.${col}` as MessageKey)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const editing = open === row.key;
            return (
              <Fragment key={row.key}>
                <tr className="border-t border-line">
                  <th scope="row" className="py-3 ps-4 pe-3 text-left align-top font-mono text-caption font-normal text-ink sm:ps-5">
                    {row.key}
                  </th>
                  <Cell view={row.goods} />
                  <Cell view={row.services} />
                  <td className="whitespace-nowrap px-3 py-3 align-top font-mono text-caption text-body">{row.boards}</td>
                  {canWrite ? (
                    <td className="py-3 ps-3 pe-4 text-right align-top sm:pe-5">
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-expanded={editing}
                        aria-controls={`paired-editor-${row.key}`}
                        aria-label={editing ? t("strings.paired.close") : row.editLabel}
                        onClick={() => setOpen(editing ? null : row.key)}
                      >
                        {editing ? t("strings.paired.close") : t("strings.paired.col.edit")}
                      </Button>
                    </td>
                  ) : null}
                </tr>
                {editing ? (
                  <tr id={`paired-editor-${row.key}`} className="bg-paper-sunk">
                    <td colSpan={columns.length} className="px-4 py-3 sm:px-5">
                      <div className="grid gap-3 lg:grid-cols-2">
                        {row.editors.map((editor) => (
                          <HalfEditor key={editor.half} rowKey={row.key} params={row.params} view={editor} />
                        ))}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {empty ? <p className="border-t border-line px-4 py-6 text-center text-body-sm text-body">{empty}</p> : null}
    </div>
  );
}
