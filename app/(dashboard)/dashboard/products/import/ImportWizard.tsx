"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button, FileDrop, Input, Select, Toggle } from "@/components/primitives";
import { Alert, StatusBadge, Tag, type StatusTone } from "@/components/display";
import { Card, Panel, StepHeader } from "@/components/structure";
import type { ColumnPlan, ColumnStatus, ColumnTarget, TargetKind } from "@/lib/import/columns";
import type { ColumnView, ImportPreview } from "@/lib/import/service";
import { formatCount } from "@/lib/format";
import { runHeadline } from "@/lib/import/labels";
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
 * ## Every column, and a tally that sums
 *
 * The board's table listed seven of the nine columns it counted, and printed
 * `Auto-matched 7 of 9` over statuses showing four matched. Both halves of that
 * are fixed here by construction: the table renders `preview.columns`, which is
 * one entry per column in the file, and the tally is computed from the same
 * array rather than beside it.
 *
 * ## The rail is a consequence of the mapping
 *
 * `Listed immediately 386` changes the moment a `Category` column is mapped, so
 * every change re-posts the plan and the rail comes back with it. A rail that
 * only updated on upload would be stating the outcome of a mapping nobody
 * chose.
 *
 * Strings are resolved here rather than passed in. A server component cannot
 * hand a function across the boundary — `{ apply: (n) => ... }` in a labels
 * object is a function prop however it is spelled — and handoff 2 hit this in
 * three separate components before the pattern stuck. `t` has no server-only
 * marker, so a client component calls it directly and there is nothing to pass.
 */

export interface ImportWizardProps {
  categoryId: string;
  /** The sentence about the plan, resolved on the server. */
  roomLabel: string;
  previewAction: (formData: FormData) => Promise<PreviewResult>;
  runAction: (formData: FormData) => Promise<RunImportResult>;
  undoAction: (formData: FormData) => Promise<UndoResult>;
}

type Stage = "upload" | "map" | "done";

const STATUS_TONE: Record<ColumnStatus, StatusTone> = {
  matched: "ok",
  needs_you: "warn",
  blocked: "bad",
  ignored: "neutral",
};

const STATUS_LABEL: Record<ColumnStatus, string> = {
  matched: t("import.status.matched"),
  needs_you: t("import.status.needs_you"),
  blocked: t("import.status.blocked"),
  ignored: t("import.status.ignored"),
};

/** The targets a seller can choose. `blocked` is not among them, by design. */
const CHOOSABLE: { kind: TargetKind; label: string }[] = [
  { kind: "ignore", label: t("import.target.ignore") },
  { kind: "name", label: t("import.target.name") },
  { kind: "sku", label: t("import.target.sku") },
  { kind: "subcategory", label: t("import.target.subcategory") },
  { kind: "description", label: t("import.target.description") },
  { kind: "availability", label: t("import.target.availability") },
  { kind: "stock_qty", label: t("import.target.stock_qty") },
  { kind: "lead_time_days", label: t("import.target.lead_time_days") },
  { kind: "min_order_qty", label: t("import.target.min_order_qty") },
  { kind: "photo", label: t("import.target.photo") },
];

/** `spec:nominal_size` in the select, so one control offers both kinds. */
const SPEC_PREFIX = "spec:";

function valueOf(target: ColumnTarget): string {
  if (target.kind === "spec" && target.specFieldKey) return `${SPEC_PREFIX}${target.specFieldKey}`;
  return target.kind;
}

function targetFrom(value: string): ColumnTarget {
  if (value.startsWith(SPEC_PREFIX)) {
    return { kind: "spec", specFieldKey: value.slice(SPEC_PREFIX.length) };
  }
  return { kind: value as TargetKind };
}

export function ImportWizard({
  categoryId,
  roomLabel,
  previewAction,
  runAction,
  undoAction,
}: ImportWizardProps) {
  const [stage, setStage] = useState<Stage>("upload");
  const [pending, startTransition] = useTransition();

  const [text, setText] = useState("");
  const [filename, setFilename] = useState("");
  const [headerRow, setHeaderRow] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [saveAs, setSaveAs] = useState("");
  const [done, setDone] = useState<RunImportResult & { ok: true } | null>(null);
  const [undone, setUndone] = useState<{ unlisted: number; restored: number } | null>(null);

  const steps = [
    { key: "upload", label: t("import.step_upload") },
    { key: "map", label: t("import.step_map") },
    { key: "done", label: t("import.step_done") },
  ];
  const current = stage === "upload" ? 0 : stage === "map" ? 1 : 2;

  /** Re-read the file with the plan as it stands. Writes nothing. */
  function reanalyse(nextPlan: ColumnPlan | null, nextHeaderRow: boolean, content = text) {
    const form = new FormData();
    form.set("text", content);
    form.set("categoryId", categoryId);
    form.set("headerRow", nextHeaderRow ? "1" : "0");
    if (nextPlan) form.set("plan", JSON.stringify(nextPlan));

    startTransition(async () => {
      const result = await previewAction(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      setPreview(result.preview);
      setStage("map");
    });
  }

  async function onFile(files: FileList) {
    const file = files[0];
    if (!file) return;
    setError(null);
    const content = await file.text();
    setText(content);
    setFilename(file.name);
    reanalyse(null, headerRow, content);
  }

  /** One column changed. The whole analysis comes back, because the rail did. */
  function setTarget(header: string, value: string) {
    if (!preview) return;
    const plan: ColumnPlan = {
      columns: preview.plan.columns.map((column) =>
        column.header === header ? { header, target: targetFrom(value) } : column,
      ),
    };
    reanalyse(plan, headerRow);
  }

  function toggleHeaderRow(next: boolean) {
    setHeaderRow(next);
    // The plan is dropped, not carried: with the header row switched off the
    // columns are called `Column 1…N` and a plan keyed by the old names would
    // match nothing. Criterion 9 — changing it re-parses.
    reanalyse(null, next);
  }

  function apply() {
    if (!preview) return;
    const form = new FormData();
    form.set("text", text);
    form.set("filename", filename);
    form.set("categoryId", categoryId);
    form.set("headerRow", headerRow ? "1" : "0");
    form.set("plan", JSON.stringify(preview.plan));
    if (saveAs.trim()) form.set("saveAs", saveAs.trim());

    startTransition(async () => {
      const result = await runAction(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      setDone(result);
      setStage("done");
    });
  }

  function undo() {
    if (!done) return;
    const form = new FormData();
    form.set("importRunId", done.importRunId);
    startTransition(async () => {
      const result = await undoAction(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setUndone({ unlisted: result.unlisted, restored: result.restored });
    });
  }

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
          <Alert tone="bad" live="assertive" fix={t("import.upload_hint")}>
            {error}
          </Alert>
        )}

        {stage === "upload" && (
          <div className="flex flex-col gap-3">
            {/*
               Said before the upload, not after the mapping. An import is the
               fastest way to hit a cap, and a seller who learns about one after
               mapping nine columns has been told at the least useful moment.
            */}
            <p className="text-body-sm text-muted">{roomLabel}</p>
            <FileDrop
              accept=".csv,text/csv"
              idleLabel={t("import.upload_label")}
              idleHint={t("import.upload_hint")}
              state={pending ? "uploading" : "idle"}
              onSelect={(files) => void onFile(files)}
            />
          </div>
        )}

        {stage === "map" && preview && (
          <MapStep
            preview={preview}
            filename={filename}
            headerRow={headerRow}
            pending={pending}
            saveAs={saveAs}
            onSaveAs={setSaveAs}
            onHeaderRow={toggleHeaderRow}
            onTarget={setTarget}
            onBack={() => {
              setPreview(null);
              setStage("upload");
            }}
            onApply={apply}
          />
        )}

        {stage === "done" && done && (
          <DoneStep done={done} undone={undone} pending={pending} onUndo={undo} />
        )}
      </div>
    </div>
  );
}

/* ── Step 2 ───────────────────────────────────────────────────────────────── */

function MapStep({
  preview,
  filename,
  headerRow,
  pending,
  saveAs,
  onSaveAs,
  onHeaderRow,
  onTarget,
  onBack,
  onApply,
}: {
  preview: ImportPreview;
  filename: string;
  headerRow: boolean;
  pending: boolean;
  saveAs: string;
  onSaveAs: (value: string) => void;
  onHeaderRow: (next: boolean) => void;
  onTarget: (header: string, value: string) => void;
  onBack: () => void;
  onApply: () => void;
}) {
  const specOptions = preview.fields.map((field) => ({
    value: `${SPEC_PREFIX}${field.key}`,
    label: field.isFilterable ? `${field.label} · ${t("import.filter_badge")}` : field.label,
  }));

  return (
    <div className="flex flex-col gap-[var(--gutter)] xl:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-[var(--gutter)]">
        <FileCard
          preview={preview}
          filename={filename}
          headerRow={headerRow}
          pending={pending}
          onHeaderRow={onHeaderRow}
          onBack={onBack}
        />

        {preview.roundTrip && (
          <Alert tone="ok">
            {t("import.round_trip.applied")}
            {preview.roundTrip.unknown.length > 0 && (
              <> {t("import.round_trip.unknown", {
                count: preview.roundTrip.unknown.length,
                n: formatCount(preview.roundTrip.unknown.length),
              })}</>
            )}
          </Alert>
        )}

        <MappingTable preview={preview} specOptions={specOptions} onTarget={onTarget} />

        {preview.outcome.errorRows.length > 0 && <ErrorRows preview={preview} />}
      </div>

      {/*
         The 330px rail, §4 and §Responsive.

         `xl` (1280), not `board` (1440). This is the one screen in the wave
         where the design width is not the breakpoint: the shell does not go
         below 1280 and the spec keeps the rail beside the table all the way
         down, with the `MAPS TO` column absorbing the difference while
         `YOUR COLUMN`, `SAMPLE VALUE` and `STATUS` stay fixed. At 1440 the
         select has room to spare; at 1300 it has about 270px, which still shows
         a field name.

         Below 1280 the rail moves under the table rather than compressing —
         it is a list of numbers and reads fine at full width, where a mapping
         row does not.
      */}
      <div className="flex w-full shrink-0 flex-col gap-[var(--gutter)] xl:w-[330px]">
        <OutcomeRail preview={preview} />

        <Panel title={t("import.saved_mappings")}>
          <div className="flex flex-col gap-2">
            {preview.roundTrip && (
              <div className="flex items-center justify-between gap-2 rounded-ctl border border-line px-3 py-2">
                <span className="text-body-sm text-ink">{preview.roundTrip.name}</span>
                <Tag mono size="sm">{t("import.round_trip.badge")}</Tag>
              </div>
            )}
            <label className="mt-1 flex flex-col gap-1">
              <span className="text-caption text-muted">{t("import.save_as_label")}</span>
              <Input
                value={saveAs}
                onChange={(event) => onSaveAs(event.target.value)}
                placeholder={t("import.save_as_hint")}
                maxLength={60}
              />
            </label>
          </div>
        </Panel>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={onBack} disabled={pending}>
            {t("import.back")}
          </Button>
          <Button onClick={onApply} disabled={pending || !preview.importable}>
            {t("import.preview_rows", {
              count: preview.outcome.created + preview.outcome.updated,
              n: formatCount(preview.outcome.created + preview.outcome.updated),
            })}
          </Button>
        </div>

        {!preview.importable && (
          <Alert tone="warn" fix={t("import.nothing_importable_hint")}>
            {t("import.nothing_importable")}
          </Alert>
        )}

        <ConciergeCard />
      </div>
    </div>
  );
}

function FileCard({
  preview,
  filename,
  headerRow,
  pending,
  onHeaderRow,
  onBack,
}: {
  preview: ImportPreview;
  filename: string;
  headerRow: boolean;
  pending: boolean;
  onHeaderRow: (next: boolean) => void;
  onBack: () => void;
}) {
  return (
    <Card padded>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-body-sm text-ink">{filename}</p>
          <p className="mt-1 text-caption text-muted">
            {t("import.file.summary", {
              rows: formatCount(preview.rowCount),
              columns: formatCount(preview.headers.length),
            })}
          </p>
          {/*
             §2's `3 subcategories · 3 templates apply`, and the reason the
             board's single `Template: Valves v3` chip could not work: templates
             attach to subcategories, and one file spans several.
          */}
          <p className="mt-0.5 text-caption text-muted">
            {t("import.file.templates", {
              count: preview.subcategories.matched,
              n: formatCount(preview.subcategories.matched),
              templates: t("import.file.templates_count", {
                count: preview.subcategories.templates,
                n: formatCount(preview.subcategories.templates),
              }),
            })}
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <Toggle
            checked={headerRow}
            onChange={onHeaderRow}
            disabled={pending}
            size="sm"
            label={t("import.file.header_row")}
            description={t("import.file.header_row_hint")}
          />
          <Button variant="secondary" size="sm" onClick={onBack} disabled={pending}>
            {t("import.file.replace")}
          </Button>
        </div>
      </div>

      {preview.truncated > 0 && (
        <div className="mt-3">
          <Alert tone="warn" fix={t("import.truncated_fix")}>
            {t("import.truncated", { count: formatCount(preview.truncated) })}
          </Alert>
        </div>
      )}
    </Card>
  );
}

function MappingTable({
  preview,
  specOptions,
  onTarget,
}: {
  preview: ImportPreview;
  specOptions: { value: string; label: string }[];
  onTarget: (header: string, value: string) => void;
}) {
  const { tally } = preview;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="text-h3 text-ink">{t("import.map_caption")}</h2>
        {/*
           The tally sums to the column count because it is computed from the
           same array the rows are. The board printed `Auto-matched 7 of 9` over
           statuses showing four.
        */}
        <p className="font-mono text-caption text-muted">
          {t("import.tally", {
            matched: String(tally.matched),
            needs: String(tally.needs_you),
            blocked: String(tally.blocked),
            ignored: String(tally.ignored),
          })}
        </p>
      </div>

      <div className="overflow-x-auto">
        {/*
           `table-fixed`, and it is load-bearing rather than cosmetic.

           §Responsive: *"The mapping table's `MAPS TO` column absorbs the
           difference; `YOUR COLUMN`, `SAMPLE VALUE` and `STATUS` are fixed."*
           Under automatic layout the browser sizes columns by content, and at
           1300 the three "fixed" ones took more than their widths while
           `MAPS TO` — the only column with a control in it — collapsed to
           138px, which is narrower than the field names it has to show. Fixed
           layout makes the declared widths hold and gives the remainder to the
           one column that has no declared width.

           `min-w-[680px]` is the floor under that remainder. At 1440 there is
           room to spare; at 1300 the wizard's own panel padding leaves the
           table 596px, and 596 minus the three fixed columns is 138 — narrower
           than the field names the select has to show. So the table keeps a
           width at which `MAPS TO` stays readable and **its own container**
           scrolls, which is the house rule for wide content. The page itself
           never scrolls sideways at either width.
        */}
        <table className="w-full min-w-[680px] table-fixed border-collapse text-body-sm">
          <caption className="sr-only">{t("import.map_caption")}</caption>
          <thead>
            <tr className="border-b border-line text-left">
              <th scope="col" className="w-[196px] px-4 py-2 font-mono text-eyebrow uppercase text-muted">
                {t("import.col_header")}
              </th>
              <th scope="col" className="w-[150px] px-4 py-2 font-mono text-eyebrow uppercase text-muted">
                {t("import.col_sample")}
              </th>
              <th scope="col" className="px-4 py-2 font-mono text-eyebrow uppercase text-muted">
                {t("import.col_target")}
              </th>
              <th scope="col" className="w-[112px] px-4 py-2 font-mono text-eyebrow uppercase text-muted">
                {t("import.col_status")}
              </th>
            </tr>
          </thead>
          <tbody>
            {preview.columns.map((column) => (
              <MappingRow
                key={column.header}
                column={column}
                preview={preview}
                specOptions={specOptions}
                onTarget={onTarget}
              />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function MappingRow({
  column,
  preview,
  specOptions,
  onTarget,
}: {
  column: ColumnView;
  preview: ImportPreview;
  specOptions: { value: string; label: string }[];
  onTarget: (header: string, value: string) => void;
}) {
  const target = column.suggestion.target;
  const blocked = target.kind === "blocked";

  return (
    <tr className="border-b border-line align-top last:border-0">
      {/* `break-words`: a fixed column cannot widen for a long header. */}
      <th scope="row" className="break-words px-4 py-3 text-left font-normal text-ink">
        {column.header}
      </th>
      <td className="break-words px-4 py-3 font-mono text-caption text-muted">
        {column.sample || "—"}
      </td>
      <td className="px-4 py-3">
        {blocked ? (
          /*
             No select at all. A disabled control invites the seller to look for
             the permission to enable it, and there is none — the board offered
             to move the column into a private quote list, which is a screen
             that does not exist. `3k` owns sent quotes and has no import path.
          */
          <p className="text-body-sm text-ink">{t("import.target.blocked")}</p>
        ) : (
          <Select
            aria-label={t("import.col_target")}
            value={valueOf(target)}
            onChange={(event) => onTarget(column.header, event.target.value)}
            options={[
              ...CHOOSABLE.map((choice) => ({ value: choice.kind, label: choice.label })),
              ...specOptions,
            ]}
          />
        )}
        <Note column={column} preview={preview} />
      </td>
      <td className="px-4 py-3">
        <StatusBadge tone={STATUS_TONE[column.status]}>{STATUS_LABEL[column.status]}</StatusBadge>
      </td>
    </tr>
  );
}

/** What the import will do with this column, in words. §3. */
function Note({ column, preview }: { column: ColumnView; preview: ImportPreview }) {
  const kind = column.suggestion.target.kind;

  if (kind === "blocked") {
    return <p className="mt-1 max-w-prose text-caption text-muted">{column.suggestion.reason}</p>;
  }

  if (kind === "photo") {
    const total = preview.photos.matched + preview.photos.unmatched + preview.photos.ambiguous;
    if (total === 0 || preview.photos.matched === 0) {
      return <p className="mt-1 max-w-prose text-caption text-muted">{t("import.note.photo_none")}</p>;
    }
    return (
      <p className="mt-1 max-w-prose text-caption text-muted">
        {t("import.note.photo", {
          matched: formatCount(preview.photos.matched),
          total: formatCount(total),
          missing: formatCount(preview.photos.unmatched),
        })}
        {preview.photos.ambiguous > 0 && (
          <>
            {" "}
            {t("import.note.photo_ambiguous", {
              count: preview.photos.ambiguous,
              n: formatCount(preview.photos.ambiguous),
            })}
          </>
        )}
      </p>
    );
  }

  if (kind === "subcategory") {
    return (
      <p className="mt-1 max-w-prose text-caption text-muted">
        {t("import.note.subcategory", {
          count: preview.subcategories.matched,
          n: formatCount(preview.subcategories.matched),
        })}
        {preview.subcategories.unknown.length > 0 && (
          <>
            {" "}
            {t("import.note.subcategory_unknown", {
              count: column.unresolved,
              n: formatCount(column.unresolved),
            })}
          </>
        )}
      </p>
    );
  }

  if (kind === "sku" && preview.outcome.updated > 0) {
    return (
      <p className="mt-1 max-w-prose text-caption text-muted">
        {t("import.note.sku", {
          count: preview.outcome.updated,
          n: formatCount(preview.outcome.updated),
        })}
      </p>
    );
  }

  if (kind === "spec" && column.suggestion.reason) {
    return <p className="mt-1 max-w-prose text-caption text-muted">{column.suggestion.reason}</p>;
  }

  return column.suggestion.reason ? (
    <p className="mt-1 max-w-prose text-caption text-muted">{column.suggestion.reason}</p>
  ) : null;
}

/* ── §4, the rail ─────────────────────────────────────────────────────────── */

function OutcomeRail({ preview }: { preview: ImportPreview }) {
  const { outcome } = preview;
  const photoTotal = preview.photos.matched + preview.photos.unmatched + preview.photos.ambiguous;

  return (
    <Panel title={t("import.rail.title")}>
      <dl className="flex flex-col gap-2">
        <Figure label={t("import.rail.new")} value={formatCount(outcome.created)} />
        <Figure label={t("import.rail.updated")} value={formatCount(outcome.updated)} />
        <Figure label={t("import.rail.errors")} value={formatCount(outcome.errors)} />
        {photoTotal > 0 && (
          <Figure
            label={t("import.rail.photos")}
            value={t("import.rail.photos_value", {
              matched: formatCount(preview.photos.matched),
              total: formatCount(photoTotal),
            })}
          />
        )}
        <Figure label={t("import.rail.listed")} value={formatCount(outcome.listed)} strong />
      </dl>

      {/*
         The cap outcome. The import is never refused and no row is dropped —
         criterion 10, and the correction to a service that rejected an over-cap
         file whole.
      */}
      <p className="mt-3 border-t border-line pt-2 text-caption text-body">
        {outcome.created === 0
          ? /*
               A file that only rewrites existing products creates nothing for
               the cap to apply to. `All 0 new products list` is a sentence
               about nothing, and it appeared on every round trip.
            */
            t("import.rail.cap_updates_only")
          : outcome.cap === null
          ? outcome.incomplete > 0
            ? /*
                 `All 2 new products list` under `Listed immediately 0` is two
                 numbers on one card disagreeing. When something other than the
                 plan is holding products back, the cap sentence says only what
                 the cap is doing, and the line below says what is.
              */
              t("import.rail.cap_unlimited_held", { plan: outcome.planName })
            : t("import.rail.cap_unlimited", {
                count: outcome.created,
                n: formatCount(outcome.created),
                plan: outcome.planName,
              })
          : t("import.rail.cap_limited", {
              listed: formatCount(outcome.listed),
              created: formatCount(outcome.created),
              plan: outcome.planName,
              cap: formatCount(outcome.cap),
            })}
      </p>

      {outcome.incomplete > 0 && (
        <p className="mt-2 text-caption text-body">
          {t("import.rail.incomplete", {
            count: outcome.incomplete,
            n: formatCount(outcome.incomplete),
          })}
        </p>
      )}

      {/* The board promised 24 hours and never said what it restored. */}
      <p className="mt-2 border-t border-line pt-2 text-caption text-muted">
        {t("import.rail.rollback")}
      </p>
    </Panel>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-caption text-muted">{label}</dt>
      <dd className={`font-mono ${strong ? "text-body text-ink" : "text-body-sm text-body"}`}>
        {value}
      </dd>
    </div>
  );
}

function ErrorRows({ preview }: { preview: ImportPreview }) {
  return (
    <Card padded>
      <h2 className="text-h3 text-ink">{t("import.errors_heading")}</h2>
      <p className="mt-1 max-w-prose text-body-sm text-muted">
        {t("import.errors_intro", {
          count: preview.outcome.errors,
          n: formatCount(preview.outcome.errors),
        })}
      </p>
      <ul className="mt-3 flex flex-col gap-1">
        {preview.outcome.errorRows.map((row) => (
          <li key={row.row} className="text-caption text-body">
            <span className="font-mono text-muted">{t("import.errors_row", { row: String(row.row) })}</span>{" "}
            {row.reason}
            {row.detail && <span className="font-mono text-muted"> {row.detail}</span>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * §6. A real queue rather than a promise on a screen.
 *
 * The spec asks whether the concierge offer has an owner before it ships as
 * copy. It does: `/admin/catalogue-imports` is board `12i`, built, with
 * statuses, a fee and a due date, and `lib/catalogue-import/service.ts` is the
 * path in. So the card links to the request flow it already has instead of
 * making an offer nobody is on the other end of.
 */
function ConciergeCard() {
  return (
    <Panel eyebrow={t("import.concierge.title")}>
      <p className="text-caption text-muted">{t("import.concierge.body")}</p>
      <Link
        href="/dashboard/setup/products"
        className="mt-2 inline-block rounded-tag text-body-sm text-ink underline underline-offset-2 focus-visible:outline-none focus-visible:shadow-focus"
      >
        {t("import.concierge.action")}
      </Link>
    </Panel>
  );
}

/* ── Step 3 ───────────────────────────────────────────────────────────────── */

function DoneStep({
  done,
  undone,
  pending,
  onUndo,
}: {
  done: RunImportResult & { ok: true };
  undone: { unlisted: number; restored: number } | null;
  pending: boolean;
  onUndo: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {/*
         Not `created + updated`. A run that only rewrote existing products
         imported nothing, and `64 products imported` over `0 new · 64 updated`
         is the screen getting a number wrong about itself. Shared with the
         catalogue's undo banner, which said the same thing and was fixed alone
         the first time.
      */}
      <h2 className="text-h3 text-ink">
        {runHeadline({ createdCount: done.created, updatedCount: done.updated })}
      </h2>
      <p className="font-mono text-caption text-muted">
        {t("import.done_counts", {
          created: formatCount(done.created),
          updated: formatCount(done.updated),
          listed: formatCount(done.listed),
        })}
      </p>

      {undone ? (
        <Alert tone="ok">
          {t("import.undo_result", {
            unlisted: formatCount(undone.unlisted),
            restored: formatCount(undone.restored),
          })}
        </Alert>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={onUndo} disabled={pending}>
            {t("import.undo")}
          </Button>
          {/* Not the rail's sentence: this one has already run. */}
          <span className="text-caption text-muted">{t("import.rollback_done")}</span>
        </div>
      )}

      <div>
        <Link
          href="/dashboard/products"
          className="rounded-tag text-body-sm text-ink underline underline-offset-2 focus-visible:outline-none focus-visible:shadow-focus"
        >
          {t("import.review")}
        </Link>
      </div>
    </div>
  );
}
