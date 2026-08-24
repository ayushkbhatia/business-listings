"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button, FileDrop, Input, Select } from "@/components/primitives";
import { StatusBadge, Tag } from "@/components/display";
import { Card, Panel, StepHeader } from "@/components/structure";
import type { ColumnPlan, ColumnSuggestion, TargetKind } from "@/lib/import/columns";
import type { ImportPreview } from "@/lib/import/service";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { PreviewResult, RunImportResult, UndoResult } from "../actions";

/**
 * Board 11d — the CSV mapper.
 *
 * The screen exists to make one refusal legible. A supplier's export almost
 * always carries a price column, because it was written for their accounting
 * system, and this is the one path into the product table wide enough to let a
 * price through. So the blocked state is not an error banner tucked at the top:
 * it is a row in the same table as every other column, with the reason in the
 * same place the reasons for the accepted columns are.
 *
 * A blocked column has no target to change it to. The select for that row is
 * absent rather than disabled — a disabled control invites the seller to look
 * for the permission to enable it, and there is none.
 *
 * Strings are resolved here rather than passed in. A server component cannot
 * hand a function across the boundary — `{ apply: (n) => ... }` in a labels
 * object is a function prop however it is spelled — and handoff 2 hit this in
 * three separate components before the pattern stuck. `t` has no server-only
 * marker, so a client component calls it directly and there is nothing to pass.
 */

export interface SpecFieldChoice {
  id: string;
  label: string;
  isFilterable: boolean;
}

export interface ImportWizardProps {
  categoryId: string;
  specFields: readonly SpecFieldChoice[];
  previewAction: (formData: FormData) => Promise<PreviewResult>;
  runAction: (formData: FormData) => Promise<RunImportResult>;
  undoAction: (formData: FormData) => Promise<UndoResult>;
}

type Stage = "upload" | "map" | "done";

export function ImportWizard({
  categoryId,
  specFields,
  previewAction,
  runAction,
  undoAction,
}: ImportWizardProps) {
  const [stage, setStage] = useState<Stage>("upload");
  const [pending, startTransition] = useTransition();

  const [text, setText] = useState("");
  const [filename, setFilename] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [targets, setTargets] = useState<Record<string, ColumnTargetValue>>({});
  const [saveAs, setSaveAs] = useState("");
  const [done, setDone] = useState<{ runId: string; created: number; skipped: number } | null>(null);
  const [undone, setUndone] = useState<number | null>(null);

  const steps = [
    { key: "upload", label: t("import.step_upload") },
    { key: "map", label: t("import.step_map") },
    { key: "done", label: t("import.step_done") },
  ];
  const current = stage === "upload" ? 0 : stage === "map" ? 1 : 2;

  async function onFile(files: FileList) {
    const file = files[0];
    if (!file) return;
    setError(null);
    const content = await file.text();
    setText(content);
    setFilename(file.name);

    const form = new FormData();
    form.set("text", content);
    form.set("categoryId", categoryId);

    startTransition(async () => {
      const result = await previewAction(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPreview(result.preview);
      setTargets(initialTargets(result.preview.suggestions));
      setStage("map");
    });
  }

  function apply() {
    if (!preview) return;
    const plan = toPlan(preview.suggestions, targets);
    if (!plan.columns.some((c) => c.target.kind === "name")) {
      setError(t("import.needs_name"));
      return;
    }
    setError(null);

    const form = new FormData();
    form.set("text", text);
    form.set("filename", filename);
    form.set("categoryId", categoryId);
    form.set("plan", JSON.stringify(plan));
    if (saveAs.trim()) form.set("saveAs", saveAs.trim());

    startTransition(async () => {
      const result = await runAction(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone({ runId: result.importRunId, created: result.created, skipped: result.skipped });
      setStage("done");
    });
  }

  function undo() {
    if (!done) return;
    const form = new FormData();
    form.set("importRunId", done.runId);
    startTransition(async () => {
      const result = await undoAction(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setUndone(result.deleted);
    });
  }

  const blocked = preview?.suggestions.filter((s) => s.target.kind === "blocked") ?? [];

  return (
    <div className="overflow-hidden rounded-panel border border-line bg-card">
      <StepHeader
        steps={steps}
        current={current}
        label={t("import.title")}
        progressLabel={(current, total) =>
          t("rfq.step_of", { current: String(current), total: String(total) })
        }
      />

      <div className="p-5">
        {error && (
          <div
            role="alert"
            className="mb-4 rounded-ctl border border-bad-line bg-bad-surface px-3 py-2 text-body-sm text-bad-ink"
          >
            {error}
          </div>
        )}

        {stage === "upload" && (
          <FileDrop
            idleLabel={t("import.upload_label")}
            idleHint={t("import.upload_hint")}
            accept=".csv,text/csv"
            state={pending ? "uploading" : "idle"}
            uploadingLabel={t("import.upload_action")}
            onSelect={onFile}
          />
        )}

        {stage === "map" && preview && (
          <div className="flex flex-col gap-4">
            <p className="text-body-sm text-muted">
              {t("import.rows_found", {
                rows: formatCount(preview.rowCount),
                columns: formatCount(preview.headers.length),
              })}
              {preview.raggedRows.length > 0 ? ` ${t("import.ragged", { count: formatCount(preview.raggedRows.length) })}` : ""}
            </p>

            {blocked.length > 0 && (
              <Panel title={t("import.blocked_heading")} eyebrow={t("import.blocked_badge")}>
                <p className="max-w-prose text-body-sm text-ink">
                  {blocked.length === 1
                    ? t("import.blocked_intro", { count: "1" })
                    : t("import.blocked_intro_plural", { count: formatCount(blocked.length) })}
                </p>
                <ul className="mt-2 space-y-2">
                  {blocked.map((column) => (
                    <li key={column.header} className="text-body-sm">
                      <span className="font-mono text-caption text-ink">{column.header}</span>
                      <span className="mt-0.5 block max-w-prose text-caption text-muted">
                        {column.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            <div className="overflow-x-auto contain-paint">
              <table className="w-full min-w-[52rem] border-collapse text-left">
                <caption className="sr-only">{t("import.map_caption")}</caption>
                <thead>
                  <tr className="bg-paper-sunk">
                    <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">
                      {t("import.col_header")}
                    </th>
                    <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">
                      {t("import.col_sample")}
                    </th>
                    <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">
                      {t("import.col_target")}
                    </th>
                    <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">
                      {t("import.col_why")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {preview.suggestions.map((suggestion, index) => {
                    const isBlocked = suggestion.target.kind === "blocked";
                    const value = targets[suggestion.header] ?? "ignore";
                    const sample = preview.sample[0]?.[index] ?? "";

                    return (
                      <tr key={suggestion.header} className="border-t border-line align-top">
                        <th scope="row" className="px-3 py-3 text-left font-normal">
                          <span className="font-mono text-body-sm text-ink">
                            {suggestion.header}
                          </span>
                          {isBlocked && (
                            <span className="mt-1 block">
                              <StatusBadge tone="bad" shape="chip" size="sm">
                                {t("import.blocked_badge")}
                              </StatusBadge>
                            </span>
                          )}
                        </th>
                        <td className="px-3 py-3 font-mono text-caption text-muted">
                          {sample || "—"}
                        </td>
                        <td className="px-3 py-3">
                          {isBlocked ? (
                            /*
                             * No control at all. A disabled select invites the
                             * seller to look for the permission to enable it,
                             * and there is none — this column cannot be
                             * imported under any setting.
                             */
                            <span className="text-body-sm text-muted">
                              {t("import.target.blocked")}
                            </span>
                          ) : (
                            <Select
                              size="sm"
                              aria-label={`${t("import.col_target")}: ${suggestion.header}`}
                              value={value}
                              onChange={(e) =>
                                setTargets((t) => ({
                                  ...t,
                                  [suggestion.header]: e.target.value as ColumnTargetValue,
                                }))
                              }
                              options={[
                                { value: "ignore", label: t("import.target.ignore") },
                                { value: "name", label: t("import.target.name") },
                                { value: "sku", label: t("import.target.sku") },
                                { value: "description", label: t("import.target.description") },
                                { value: "availability", label: t("import.target.availability") },
                                { value: "stock_qty", label: t("import.target.stock_qty") },
                                { value: "lead_time_days", label: t("import.target.lead_time_days") },
                                { value: "min_order_qty", label: t("import.target.min_order_qty") },
                                ...specFields.map((field) => ({
                                  value: `spec:${field.id}`,
                                  label: field.isFilterable
                                    ? `${field.label} · ${t("import.filter_badge")}`
                                    : field.label,
                                })),
                              ]}
                            />
                          )}
                        </td>
                        <td className="px-3 py-3 max-w-[24rem] text-caption text-muted">
                          {suggestion.reason}
                          {suggestion.splittable && !isBlocked && (
                            <span className="mt-1 block text-caption text-muted">
                              {t("import.split_offer", { on: suggestion.splittable.on.trim() || "/" })}
                            </span>
                          )}
                          {isFilterTarget(value, specFields) && (
                            <span className="mt-1 inline-block">
                              <Tag mono size="sm">
                                {t("import.filter_badge")}
                              </Tag>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-end justify-between gap-4 border-t border-line pt-4">
              <label className="flex min-w-0 flex-col gap-1">
                <span className="text-caption text-muted">{t("import.save_as_label")}</span>
                <Input
                  size="sm"
                  value={saveAs}
                  onChange={(e) => setSaveAs(e.target.value)}
                  aria-describedby="save-as-hint"
                />
                <span id="save-as-hint" className="text-caption text-faint">
                  {t("import.save_as_hint")}
                </span>
              </label>
              <Button onClick={apply} disabled={pending}>
                {t("import.apply", { rows: formatCount(preview.rowCount) })}
              </Button>
            </div>
          </div>
        )}

        {stage === "done" && done && (
          <Card padded>
            {undone === null ? (
              <>
                <h2 className="text-h3 text-ink">{t("import.done_title", { count: formatCount(done.created) })}</h2>
                <p className="mt-2 max-w-prose text-body-sm text-muted">{t("import.done_body")}</p>
                {done.skipped > 0 && (
                  <p className="mt-1 text-caption text-muted">{t("import.done_skipped", { count: formatCount(done.skipped) })}</p>
                )}
                <p className="mt-3 text-caption text-muted">{t("import.undo_window")}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={undo} disabled={pending}>
                    {t("import.undo")}
                  </Button>
                  <Link
                    href="/dashboard/products"
                    className="inline-flex items-center rounded-ctl px-3 py-1.5 text-body-sm text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                  >
                    {t("import.review")}
                  </Link>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-h3 text-ink">{t("import.undo_done", { count: formatCount(undone) })}</h2>
                <Link
                  href="/dashboard/products"
                  className="mt-3 inline-flex items-center rounded-ctl text-body-sm text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                >
                  {t("import.review")}
                </Link>
              </>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

/* ── Plan plumbing ────────────────────────────────────────────────────────── */

type ColumnTargetValue = TargetKind | `spec:${string}`;

function initialTargets(suggestions: readonly ColumnSuggestion[]): Record<string, ColumnTargetValue> {
  const out: Record<string, ColumnTargetValue> = {};
  for (const suggestion of suggestions) {
    out[suggestion.header] =
      suggestion.target.kind === "spec" && suggestion.target.specFieldId
        ? `spec:${suggestion.target.specFieldId}`
        : suggestion.target.kind;
  }
  return out;
}

function isFilterTarget(value: ColumnTargetValue, fields: readonly SpecFieldChoice[]): boolean {
  if (!value.startsWith("spec:")) return false;
  const id = value.slice("spec:".length);
  return fields.find((f) => f.id === id)?.isFilterable ?? false;
}

/**
 * Build the plan that is posted.
 *
 * A blocked column stays in it. The service re-checks the plan against the
 * price fence, and a saved mapping reused next month has to refuse the same
 * column again without re-deriving why.
 */
function toPlan(
  suggestions: readonly ColumnSuggestion[],
  targets: Record<string, ColumnTargetValue>,
): ColumnPlan {
  return {
    columns: suggestions.map((suggestion) => {
      if (suggestion.target.kind === "blocked") {
        return {
          header: suggestion.header,
          target: { kind: "blocked" as const },
          ...(suggestion.reason ? { reason: suggestion.reason } : {}),
        };
      }
      const value = targets[suggestion.header] ?? "ignore";
      if (value.startsWith("spec:")) {
        return {
          header: suggestion.header,
          target: { kind: "spec" as const, specFieldId: value.slice("spec:".length) },
        };
      }
      return { header: suggestion.header, target: { kind: value as TargetKind } };
    }),
  };
}
