"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/primitives";
import { Modal } from "@/components/structure";
import { cn } from "@/lib/cn";
import type { PasteResult, RowResult } from "./actions";

/**
 * Step 2 — the row editor. Board 8c §3.
 *
 * Autosave per row on blur. No draft-versus-submit split and no
 * unsaved-changes warning: §1 says the buttons in the chrome are navigation
 * rather than submission, and a seller who types a name and closes the tab
 * should find the name there.
 *
 * ## The three colours are one rule, not a mood
 *
 * A row's spec count is green at 80%, amber at 60–79% and red below 60%. Red
 * does not mean broken — the product is live, findable and enquirable — it
 * means the row does not count towards the ten. §3 is explicit that it must not
 * be hidden, must not be unpublished, and must not be counted, and the footer
 * says two different numbers from this one table for exactly that reason.
 *
 * Every string arrives translated and every number formatted. Nothing here
 * calls `t()`.
 */

export interface EditableRow {
  id: string;
  name: string;
  size: string;
  availability: string | null;
  live: boolean;
  hasImage: boolean;
  /** "6 / 9", or a dash where the sheet requires nothing. */
  specsLabel: string;
  tone: "strong" | "thin" | "short";
}

export interface RowTableLabels {
  colImg: string;
  colName: string;
  colSize: string;
  colAvailability: string;
  colSpecs: string;
  colActions: string;
  caption: string;
  namePlaceholder: string;
  addLine: string;
  remove: string;
  notLive: string;
  paste: string;
  pasteHint: string;
  pasteApply: string;
  pasteClose: string;
  previewEyebrow: string;
  previewPrice: string;
  previewEnquire: string;
  previewEmpty: string;
  saveFailed: string;
  /** value → label, already translated. */
  availability: Readonly<Record<string, string>>;
}

export interface RowTableProps {
  rows: readonly EditableRow[];
  labels: RowTableLabels;
  availabilityOptions: readonly string[];
  /** False at the plan's cap: existing rows stay editable, new ones stop. §5. */
  canAdd: boolean;
  /** Board 8c §7: with no sheet, step 2 renders disabled rather than hidden. */
  disabled: boolean;
  save: (formData: FormData) => Promise<RowResult>;
  remove: (formData: FormData) => Promise<RowResult>;
  paste: (text: string) => Promise<PasteResult>;
}

interface Draft {
  name: string;
  size: string;
  availability: string;
}

const BLANK: Draft = { name: "", size: "", availability: "" };

export function RowTable({
  rows,
  labels,
  availabilityOptions,
  canAdd,
  disabled,
  save,
  remove,
  paste,
}: RowTableProps) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [pasteText, setPasteText] = useState("");
  /*
     One draft, for the always-present empty line at the bottom. §3: it is not a
     record until the name is typed, so it lives here rather than in the
     database — and the live preview reads it, which is what makes the preview
     move while a seller types rather than after they blur.
  */
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [focused, setFocused] = useState<string | null>(null);

  /*
     Extra blank lines, so a table with no products shows three rather than one.
     §7: an empty table with a single line reads as broken.

     Derived rather than stored. Keeping it in an effect meant a render, an
     effect, and a second render every time the row count changed — and React
     flags the pattern for exactly that reason. `added` is what the seller asked
     for; the floor is what the empty state needs.
  */
  const [added, setAdded] = useState(0);
  const spare = Math.max(added, rows.length === 0 ? 2 : 0);

  function commit(id: string | null, next: Draft): void {
    if (next.name.trim().length < 3) return;
    const form = new FormData();
    if (id) form.set("id", id);
    form.set("name", next.name);
    form.set("size", next.size);
    if (next.availability) form.set("availability", next.availability);

    startTransition(async () => {
      const result = await save(form);
      if (!result.ok) {
        setError(result.error || labels.saveFailed);
        return;
      }
      setError(null);
      if (!id) setDraft(BLANK);
      router.refresh();
    });
  }

  const previewRow =
    focused === "draft" && draft.name.trim() !== ""
      ? { name: draft.name, size: draft.size, availability: draft.availability }
      : rows.find((row) => row.id === focused) ?? rows[0] ?? null;

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1">
        <div className="mb-3 flex flex-wrap justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled || busy || !canAdd}
            onClick={() => setPasting(true)}
          >
            {labels.paste}
          </Button>
        </div>

        {error && (
          <p role="alert" className="mb-2 text-body-sm text-bad-ink">
            {error}
          </p>
        )}

        <div
          className={cn(
            "overflow-hidden rounded-card border border-line bg-card",
            disabled && "opacity-60",
          )}
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-body-sm">
              <caption className="sr-only">{labels.caption}</caption>
              <thead>
                <tr className="border-b border-line bg-paper-sunk">
                  <Th className="w-[64px]">{labels.colImg}</Th>
                  <Th>{labels.colName}</Th>
                  <Th className="w-[140px]">{labels.colSize}</Th>
                  <Th className="w-[160px]">{labels.colAvailability}</Th>
                  <Th className="w-[110px] text-end">{labels.colSpecs}</Th>
                  <th scope="col" className="w-[80px] px-3 py-2">
                    <span className="sr-only">{labels.colActions}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <SavedRow
                    key={row.id}
                    row={row}
                    labels={labels}
                    availabilityOptions={availabilityOptions}
                    disabled={disabled || busy}
                    onFocus={() => setFocused(row.id)}
                    onCommit={(next) => commit(row.id, next)}
                    onRemove={() => {
                      const form = new FormData();
                      form.set("id", row.id);
                      startTransition(async () => {
                        await remove(form);
                        router.refresh();
                      });
                    }}
                  />
                ))}

                {canAdd && (
                  <DraftRow
                    draft={draft}
                    labels={labels}
                    availabilityOptions={availabilityOptions}
                    disabled={disabled || busy}
                    onFocus={() => setFocused("draft")}
                    onChange={setDraft}
                    onCommit={() => commit(null, draft)}
                  />
                )}

                {Array.from({ length: spare }).map((_, index) => (
                  <tr key={`spare-${index}`} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-2.5">
                      <span
                        aria-hidden="true"
                        className="block size-9 rounded-tag border border-dashed border-line-strong"
                      />
                    </td>
                    <td colSpan={5} className="px-3 py-2.5 text-caption text-faint">
                      —
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3">
            <button
              type="button"
              disabled={disabled || busy || !canAdd}
              onClick={() => setAdded((count) => count + 1)}
              className="text-body-sm font-medium text-moss underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus disabled:text-disabled-text disabled:no-underline"
            >
              {labels.addLine}
            </button>
          </div>
        </div>
      </div>

      <aside className="w-full shrink-0 lg:w-[300px]">
        <div className="rounded-card border border-line bg-card px-5 py-4">
          <p className="font-mono text-eyebrow uppercase text-muted">{labels.previewEyebrow}</p>
          <div className="mt-3 rounded-card border border-line">
            <div aria-hidden="true" className="h-[92px] rounded-t-card bg-fill" />
            <div className="px-3.5 py-3">
              {previewRow && previewRow.name.trim() !== "" ? (
                <>
                  <p className="text-body-sm text-ink">
                    {previewRow.name}
                    {previewRow.size ? ` — ${previewRow.size}` : ""}
                  </p>
                  {/*
                    "Price on enquiry" is the correct phrase and the only one.
                    "Price on request" is banned, and there is no price field on
                    a product at any tier.
                  */}
                  <p className="mt-1.5 text-caption text-muted">{labels.previewPrice}</p>
                  {previewRow.availability && (
                    <p className="mt-1 text-caption text-ok-ink">
                      {labels.availability[previewRow.availability] ?? ""}
                    </p>
                  )}
                  <span className="mt-3 flex h-8 items-center justify-center rounded-ctl bg-moss text-caption font-medium text-on-ink">
                    {labels.previewEnquire}
                  </span>
                </>
              ) : (
                <p className="text-caption text-muted">{labels.previewEmpty}</p>
              )}
            </div>
          </div>
        </div>
      </aside>

      {pasting && (
        <Modal
          open
          size="md"
          title={labels.paste}
          description={labels.pasteHint}
          onClose={() => setPasting(false)}
          closeLabel={labels.pasteClose}
          footer={
            <>
              <Button variant="secondary" size="sm" onClick={() => setPasting(false)}>
                {labels.pasteClose}
              </Button>
              <Button
                size="sm"
                disabled={busy || pasteText.trim() === ""}
                onClick={() => {
                  startTransition(async () => {
                    const result = await paste(pasteText);
                    if (!result.ok) setError(result.error);
                    setPasteText("");
                    setPasting(false);
                    router.refresh();
                  });
                }}
              >
                {labels.pasteApply}
              </Button>
            </>
          }
        >
          <textarea
            rows={8}
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
            aria-label={labels.paste}
            className="w-full rounded-ctl border border-line-strong bg-card px-3 py-2 font-mono text-caption text-ink focus-visible:outline-none focus-visible:shadow-focus"
          />
        </Modal>
      )}
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cn(
        "px-3 py-2 text-start font-mono text-colhead uppercase text-muted",
        className,
      )}
    >
      {children}
    </th>
  );
}

const TONE = {
  strong: "text-ok-ink",
  thin: "text-warn-ink",
  short: "text-bad-ink",
} as const;

function SavedRow({
  row,
  labels,
  availabilityOptions,
  disabled,
  onFocus,
  onCommit,
  onRemove,
}: {
  row: EditableRow;
  labels: RowTableLabels;
  availabilityOptions: readonly string[];
  disabled: boolean;
  onFocus: () => void;
  onCommit: (next: Draft) => void;
  onRemove: () => void;
}) {
  const [value, setValue] = useState<Draft>({
    name: row.name,
    size: row.size,
    availability: row.availability ?? "",
  });
  const dirty = useRef(false);

  function change(next: Partial<Draft>): void {
    dirty.current = true;
    setValue((held) => ({ ...held, ...next }));
  }

  function blur(): void {
    if (!dirty.current) return;
    dirty.current = false;
    onCommit(value);
  }

  return (
    <tr className="border-b border-line last:border-b-0">
      <td className="px-3 py-2.5">
        <span
          aria-hidden="true"
          className={cn(
            "block size-9 rounded-tag",
            row.hasImage ? "bg-fill" : "border border-dashed border-line-strong",
          )}
        />
      </td>
      <th scope="row" className="px-3 py-2.5 text-start font-normal">
        <Cell
          value={value.name}
          label={labels.colName}
          disabled={disabled}
          onFocus={onFocus}
          onChange={(next) => change({ name: next })}
          onBlur={blur}
        />
        {!row.live && <span className="mt-1 block text-caption text-muted">{labels.notLive}</span>}
      </th>
      <td className="px-3 py-2.5">
        <Cell
          value={value.size}
          label={labels.colSize}
          disabled={disabled}
          onFocus={onFocus}
          onChange={(next) => change({ size: next })}
          onBlur={blur}
        />
      </td>
      <td className="px-3 py-2.5">
        <Availability
          value={value.availability}
          label={labels.colAvailability}
          options={availabilityOptions}
          labels={labels.availability}
          disabled={disabled}
          onFocus={onFocus}
          onChange={(next) => {
            dirty.current = true;
            const merged = { ...value, availability: next };
            setValue(merged);
            onCommit(merged);
            dirty.current = false;
          }}
        />
      </td>
      <td className={cn("px-3 py-2.5 text-end font-mono tabular-nums", TONE[row.tone])}>
        {row.specsLabel}
      </td>
      <td className="px-3 py-2.5 text-end">
        <button
          type="button"
          disabled={disabled}
          onClick={onRemove}
          className="font-mono text-eyebrow uppercase text-muted underline-offset-2 hover:text-bad-ink hover:underline focus-visible:outline-none focus-visible:shadow-focus disabled:text-disabled-text"
        >
          {labels.remove}
        </button>
      </td>
    </tr>
  );
}

function DraftRow({
  draft,
  labels,
  availabilityOptions,
  disabled,
  onFocus,
  onChange,
  onCommit,
}: {
  draft: Draft;
  labels: RowTableLabels;
  availabilityOptions: readonly string[];
  disabled: boolean;
  onFocus: () => void;
  onChange: (next: Draft) => void;
  onCommit: () => void;
}) {
  return (
    <tr className="border-b border-line last:border-b-0">
      <td className="px-3 py-2.5">
        <span
          aria-hidden="true"
          className="block size-9 rounded-tag border border-dashed border-line-strong"
        />
      </td>
      <th scope="row" className="px-3 py-2.5 text-start font-normal">
        <Cell
          value={draft.name}
          label={labels.colName}
          placeholder={labels.namePlaceholder}
          disabled={disabled}
          onFocus={onFocus}
          onChange={(next) => onChange({ ...draft, name: next })}
          onBlur={onCommit}
        />
      </th>
      <td className="px-3 py-2.5">
        <Cell
          value={draft.size}
          label={labels.colSize}
          disabled={disabled || draft.name.trim() === ""}
          onFocus={onFocus}
          onChange={(next) => onChange({ ...draft, size: next })}
          onBlur={onCommit}
        />
      </td>
      <td className="px-3 py-2.5">
        <Availability
          value={draft.availability}
          label={labels.colAvailability}
          options={availabilityOptions}
          labels={labels.availability}
          disabled={disabled || draft.name.trim() === ""}
          onFocus={onFocus}
          onChange={(next) => onChange({ ...draft, availability: next })}
        />
      </td>
      <td className="px-3 py-2.5 text-end font-mono tabular-nums text-faint">—</td>
      <td className="px-3 py-2.5" />
    </tr>
  );
}

function Cell({
  value,
  label,
  placeholder,
  disabled,
  onFocus,
  onChange,
  onBlur,
}: {
  value: string;
  label: string;
  placeholder?: string;
  disabled: boolean;
  onFocus: () => void;
  onChange: (next: string) => void;
  onBlur: () => void;
}) {
  return (
    <input
      type="text"
      value={value}
      aria-label={label}
      {...(placeholder ? { placeholder } : {})}
      disabled={disabled}
      onFocus={onFocus}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      className="w-full rounded-ctl border border-transparent bg-transparent px-2 py-1 text-body-sm text-ink hover:border-line focus-visible:border-line-strong focus-visible:outline-none focus-visible:shadow-focus disabled:text-disabled-text"
    />
  );
}

function Availability({
  value,
  label,
  options,
  labels,
  disabled,
  onFocus,
  onChange,
}: {
  value: string;
  label: string;
  options: readonly string[];
  labels: Readonly<Record<string, string>>;
  disabled: boolean;
  onFocus: () => void;
  onChange: (next: string) => void;
}) {
  return (
    <select
      value={value}
      aria-label={label}
      disabled={disabled}
      onFocus={onFocus}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-ctl border border-transparent bg-transparent px-2 py-1 text-body-sm text-ink hover:border-line focus-visible:border-line-strong focus-visible:outline-none focus-visible:shadow-focus disabled:text-disabled-text"
    >
      <option value="">—</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {labels[option] ?? option}
        </option>
      ))}
    </select>
  );
}
