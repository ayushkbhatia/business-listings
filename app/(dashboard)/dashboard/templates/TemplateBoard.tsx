"use client";

import { useMemo, useState, useTransition } from "react";
import { Alert, StatusBadge, Tag, type StatusTone } from "@/components/display";
import { Button, Checkbox, IconButton, Input, Toggle } from "@/components/primitives";
import { Modal, Panel } from "@/components/structure";
import { t } from "@/lib/i18n";
import type { TemplateActionResult } from "./actions";

/**
 * Board 3h — the fields table, the settings rail, and the changes waiting.
 *
 * One client component because the three share a selection: the rail is scoped
 * to the row the table has selected, and the pending list is derived from the
 * same working overlay both of them edit. Splitting them would mean lifting
 * that state into a fourth thing anyway.
 *
 * ## Nothing here writes to the live template
 *
 * Every edit moves the working overlay and stages a draft. `Apply` is a
 * separate, confirmed act against a list that states each change's blast
 * radius — §8, and the reason the board's single `Save & apply to 318` was
 * wrong: it was a one-click retroactive edit to 318 live products.
 *
 * ## Everything arrives resolved
 *
 * Labels, type descriptions and blast-radius sentences are strings computed on
 * the server. A function cannot cross into a client component — the repeated
 * defect in this codebase, and the one board 3k shipped a runtime error on.
 */

export interface BoardField {
  fieldId: string;
  label: string;
  /** Pre-resolved for the table cell: "Select · 18 · DN / inch". */
  typeLabel: string;
  /**
   * The field's actual type — `select`, `multiselect`, `number`, `text`.
   *
   * Carried beside the label rather than derived from it, because `stage()`
   * used to write `typeLabel` into `OwnField.type`, so any staged save turned a
   * seller's own field's type into a sentence. `readOwnFields` accepts any
   * string and defaults a non-string to "text", so nothing failed — the product
   * editor simply stopped being able to tell a multiselect from a text box, and
   * a multiselect it renders as a text box is a stored array it deletes.
   */
  type: string;
  platformFieldId: string | null;
  /** The immutable mapping, shown locked. Null for a field the seller invented. */
  mappedTo: string | null;
  platformLabel: string | null;
  required: boolean;
  /** The platform's own requirement — a floor the seller cannot lower. */
  platformRequired: boolean;
  facet: "platform" | "not_a_facet" | "yours_only";
  facetLabel: string;
  /**
   * Authored on board 4e, enforced by board 3g.
   *
   * Read-only here for the same reason the facet is: a clone can only inherit
   * a flag the library template carries, and a per-seller answer to "does
   * nominal size differ between variants" is not a thing the platform could
   * act on.
   */
  varies: boolean;
  variesLabel: string;
  detached: boolean;
  own: boolean;
  isNew: boolean;
  options: string[];
  platformOptions: string[];
  unit: string | null;
  unitDisplay: "both" | "primary";
  /** The platform's own position. A position equal to it is not an override. */
  platformSortOrder: number;
  filled: number;
  total: number;
  toFix: number;
}

export interface BoardChange {
  /** Pre-resolved: "Renamed Size to Nominal size". */
  sentence: string;
  /** Pre-resolved: "6 flagged · none delisted". */
  blastLabel: string;
  blast: "display_only" | "republish" | "flag";
}

export interface TemplateBoardProps {
  sellerTemplateId: string;
  fields: readonly BoardField[];
  changes: readonly BoardChange[];
  /** Products on this template. The denominator every count is stated against. */
  total: number;
  gaps: number;
  gapsHref: string;
  saveAction: (formData: FormData) => Promise<TemplateActionResult>;
  applyAction: (formData: FormData) => Promise<TemplateActionResult>;
  discardAction: (formData: FormData) => Promise<TemplateActionResult>;
}

/** The working overlay, as the browser holds it while a seller edits. */
interface Working {
  label?: string;
  sortOrder?: number;
  required?: boolean;
  options?: string[];
  unitDisplay?: "both" | "primary";
  detached?: boolean;
}

export function TemplateBoard(props: TemplateBoardProps) {
  const [order, setOrder] = useState<string[]>(props.fields.map((f) => f.fieldId));
  const [edits, setEdits] = useState<Record<string, Working>>({});
  const [selected, setSelected] = useState<string | null>(props.fields[0]?.fieldId ?? null);
  const [detaching, setDetaching] = useState<BoardField | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const byId = useMemo(
    () => new Map(props.fields.map((field) => [field.fieldId, field])),
    [props.fields],
  );
  const rows = useMemo(
    () => order.map((id) => byId.get(id)).filter((f): f is BoardField => Boolean(f)),
    [order, byId],
  );

  /** A field as it currently reads, with the seller's unsaved edits over it. */
  function current(field: BoardField): BoardField {
    const edit = edits[field.fieldId] ?? {};
    return {
      ...field,
      label: edit.label ?? field.label,
      // The platform's requirement is a floor. `edit.required` can only add.
      required: field.platformRequired || (edit.required ?? field.required),
      options: edit.options ?? field.options,
      unitDisplay: edit.unitDisplay ?? field.unitDisplay,
      detached: edit.detached ?? field.detached,
    };
  }

  function change(fieldId: string, patch: Working) {
    setEdits((now) => ({ ...now, [fieldId]: { ...(now[fieldId] ?? {}), ...patch } }));
  }

  function move(fieldId: string, by: 1 | -1) {
    setOrder((now) => {
      const at = now.indexOf(fieldId);
      const to = at + by;
      if (at < 0 || to < 0 || to >= now.length) return now;
      const next = [...now];
      [next[at], next[to]] = [next[to]!, next[at]!];
      return next;
    });
  }

  function run(action: (f: FormData) => Promise<TemplateActionResult>, form: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await action(form);
      if (!result.ok) setError(result.error);
      else setNotice(result.message ?? null);
    });
  }

  function stage() {
    /*
       The whole overlay, every time.

       `saveDraft` replaces the stored draft rather than merging into it, so a
       partial post would erase every override missing from it — the same shape
       as the bug that made `saveProduct` delete spec values. Posting all of it
       keeps the two ends honest.
    */
    const mappings: Record<string, Working> = {};
    const ownFields: unknown[] = [];

    order.forEach((fieldId, index) => {
      const field = byId.get(fieldId);
      if (!field) return;
      const now = current(field);

      if (field.own) {
        ownFields.push({
          id: field.fieldId,
          label: now.label,
          // The type, not the label for it. See `BoardField.type`.
          type: field.type,
          unit: field.unit,
          options: now.options,
          required: now.required,
          sortOrder: index,
        });
        return;
      }

      const override: Working = {};
      if (index !== field.platformSortOrder) override.sortOrder = index;
      if (now.label !== field.platformLabel) override.label = now.label;
      // Only the seller's own addition is stored. The platform's floor is read
      // from the platform field, so storing it here would freeze a copy of it.
      if (!field.platformRequired && now.required) override.required = true;
      if (now.options.length !== field.platformOptions.length) override.options = now.options;
      if (now.unitDisplay !== "both") override.unitDisplay = now.unitDisplay;
      if (now.detached) override.detached = true;
      mappings[fieldId] = override;
    });

    const form = new FormData();
    form.set("sellerTemplateId", props.sellerTemplateId);
    form.set("overlay", JSON.stringify({ mappings, ownFields }));
    run(props.saveAction, form);
  }

  const active = selected ? byId.get(selected) : undefined;
  const field = active ? current(active) : undefined;

  return (
    <div className="flex flex-col gap-[var(--gutter)] xl:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-[var(--gutter)]">
        {error && <Alert tone="bad" live="assertive">{error}</Alert>}

        <Panel
          title={t("template.fields_heading")}
          description={t("template.fields_hint")}
          padded={false}
        >
          <div className="overflow-x-auto contain-paint">
            {/*
              The widths are the board's own defect, measured rather than
              eyeballed. Four panes at 236 nav + 200 rail + 300 settings leave
              626px of table at 1440, and the first pass asked for 672 — so
              `FILLED`, the column the whole screen turns on, was clipped off
              the right edge. The same failure the render was corrected for.

              328px of fixed columns now, against a 576px minimum: the label and
              the type share the remainder and the row fits with the longest
              field name in the fixture.
            */}
            <table className="w-full min-w-[36rem] border-collapse text-left">
              <caption className="sr-only">{t("template.caption")}</caption>
              <thead>
                <tr className="bg-paper-sunk">
                  <th scope="col" className="w-14 px-2 py-2">
                    <span className="sr-only">{t("table.actions_header")}</span>
                  </th>
                  <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">
                    {t("template.col_label")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">
                    {t("template.col_type")}
                  </th>
                  <th scope="col" className="w-20 px-2 py-2 text-caption font-normal text-muted">
                    {t("template.col_required")}
                  </th>
                  <th scope="col" className="w-24 px-2 py-2 text-caption font-normal text-muted">
                    {t("template.col_filter")}
                  </th>
                  <th scope="col" className="w-24 px-2 py-2 text-right text-caption font-normal text-muted">
                    {t("template.col_filled")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const now = current(row);
                  const isSelected = row.fieldId === selected;
                  return (
                    <tr
                      key={row.fieldId}
                      className={`border-t border-line align-middle ${
                        isSelected ? "bg-paper-sunk" : ""
                      }`}
                    >
                      {/*
                        Buttons, not a drag handle alone. A pointer-only reorder
                        is a control a keyboard cannot reach, and the order is
                        the thing this table exists to set.
                      */}
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-0.5">
                          <IconButton
                            size="sm"
                            variant="ghost"
                            icon={<span aria-hidden="true">↑</span>}
                            label={t("template.reorder_up", { field: now.label })}
                            disabled={index === 0 || pending}
                            onClick={() => move(row.fieldId, -1)}
                          />
                          <IconButton
                            size="sm"
                            variant="ghost"
                            icon={<span aria-hidden="true">↓</span>}
                            label={t("template.reorder_down", { field: now.label })}
                            disabled={index === rows.length - 1 || pending}
                            onClick={() => move(row.fieldId, 1)}
                          />
                        </div>
                      </td>
                      <th scope="row" className="px-3 py-2 text-left font-normal">
                        <button
                          type="button"
                          onClick={() => setSelected(row.fieldId)}
                          aria-label={t("template.select_field", { field: now.label })}
                          className="text-left text-body-sm text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                        >
                          {now.label}
                        </button>
                        {row.own && (
                          <span className="ml-1.5 text-caption text-muted">
                            {t("template.own_marker")}
                          </span>
                        )}
                        {row.isNew && (
                          <span className="ml-1.5 inline-flex">
                            <Tag mono size="sm">
                              {t("template.new_marker")}
                            </Tag>
                          </span>
                        )}
                      </th>
                      <td className="px-3 py-2 text-body-sm text-muted">{row.typeLabel}</td>
                      <td className="px-2 py-2">
                        <Toggle
                          checked={now.required}
                          /*
                            The platform's requirement is a floor. Disabled
                            rather than absent, so a seller can see the field is
                            required and that it is not theirs to lift —
                            `saveDraft` refuses it again, because a disabled
                            control is a UI opinion and an action is a URL.
                          */
                          disabled={row.platformRequired || pending}
                          label={t("template.required_label", { field: now.label })}
                          hideLabel
                          onChange={(next) => change(row.fieldId, { required: next })}
                        />
                      </td>
                      <td className="px-2 py-2">
                        {/*
                          State, never a switch. A per-seller facet returns a
                          subset of the sellers who hold the data while its count
                          claims otherwise — §"Why the facet cannot be
                          per-seller".
                        */}
                        <span className="flex flex-wrap items-center gap-1">
                          <StatusBadge tone={facetTone(now.facet)} size="sm" shape="chip">
                            {row.facetLabel}
                          </StatusBadge>
                          {row.varies && (
                            <StatusBadge tone="neutral" size="sm" shape="chip">
                              {row.variesLabel}
                            </StatusBadge>
                          )}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <span className="block font-mono tabular-nums text-body-sm text-ink">
                          {t("template.filled_of", {
                            filled: String(row.filled),
                            total: String(row.total),
                          })}
                        </span>
                        {row.toFix > 0 && (
                          <span className="mt-0.5 block font-mono text-caption text-bad-ink">
                            {t("template.to_fix", { count: row.toFix })}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-line px-3 py-2.5">
            <Button size="sm" disabled={pending} onClick={stage}>
              {t("template.save")}
            </Button>
            <span aria-live="polite" className="text-caption text-muted">
              {notice}
            </span>
          </div>
        </Panel>

        {/*
          §5 stated where it can be acted on, not only in the settings rail.
          The consequence is the sentence: they stay live, they stay in search.
        */}
        {props.gaps > 0 ? (
          <Panel>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="max-w-prose text-body-sm text-ink">
                <span className="font-medium">
                  {t("template.gaps_heading", { count: props.gaps })}
                </span>{" "}
                <span className="text-muted">{t("template.gaps_body")}</span>
              </p>
              <a
                href={props.gapsHref}
                className="shrink-0 text-body-sm underline underline-offset-2 focus-visible:outline-none focus-visible:shadow-focus"
              >
                {t("template.gaps_fix", { count: props.gaps })}
              </a>
            </div>
          </Panel>
        ) : null}

        <PendingList
          changes={props.changes}
          total={props.total}
          sellerTemplateId={props.sellerTemplateId}
          pending={pending}
          onApply={(form) => run(props.applyAction, form)}
          onDiscard={(form) => run(props.discardAction, form)}
        />
      </div>

      <aside className="w-full shrink-0 xl:w-[300px]">
        <div className="flex flex-col gap-[var(--gutter)]">
          <Panel
            eyebrow={
              field
                ? `${t("template.settings_eyebrow")} · ${field.label}`
                : t("template.settings_eyebrow")
            }
          >
            {field && active ? (
              <div className="flex flex-col gap-4">
                <label className="flex flex-col gap-1">
                  <span className="text-body-sm text-ink">{t("template.label_field")}</span>
                  <Input
                    size="sm"
                    value={field.label}
                    aria-label={t("template.label_for", {
                      field: active.platformLabel ?? active.label,
                    })}
                    onChange={(event) =>
                      change(active.fieldId, { label: event.target.value })
                    }
                  />
                  <span className="text-caption text-muted">{t("template.label_hint")}</span>
                </label>

                {field.mappedTo && (
                  <div className="flex flex-col gap-1">
                    <span className="text-body-sm text-ink">{t("template.mapped_to")}</span>
                    {/*
                      Shown locked rather than hidden. The pairing is what makes
                      a rename safe, and a seller who cannot see it has no reason
                      to believe it.
                    */}
                    <span className="flex items-center justify-between gap-2 rounded-ctl border border-line bg-paper-sunk px-2.5 py-1.5">
                      <span className="font-mono text-caption text-ink">{field.mappedTo}</span>
                      <span className="font-mono text-eyebrow uppercase text-muted">
                        {t("template.locked")}
                      </span>
                    </span>
                  </div>
                )}

                <div className="flex flex-col gap-1">
                  <span className="text-body-sm text-ink">{t("template.type_field")}</span>
                  <span className="text-body-sm text-muted">{field.typeLabel}</span>
                  {!field.own && (
                    <span className="text-caption text-muted">{t("template.type_locked")}</span>
                  )}
                </div>

                {active.platformOptions.length > 0 && (
                  <fieldset className="min-w-0 border-0 p-0">
                    <legend className="mb-1.5 text-body-sm text-ink">
                      {t("template.options_heading", { count: field.options.length })}
                    </legend>
                    <div className="flex flex-col gap-1.5">
                      {active.platformOptions.map((option) => (
                        <Checkbox
                          key={option}
                          checked={field.options.includes(option)}
                          label={option}
                          onChange={(event) =>
                            change(active.fieldId, {
                              options: event.target.checked
                                ? [...field.options, option]
                                : field.options.filter((o) => o !== option),
                            })
                          }
                        />
                      ))}
                    </div>
                    <p className="mt-1.5 text-caption text-muted">{t("template.options_hint")}</p>
                  </fieldset>
                )}

                {field.unit && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-body-sm text-ink">{t("template.unit_heading")}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {(["both", "primary"] as const).map((mode) => (
                        <Button
                          key={mode}
                          size="sm"
                          variant={field.unitDisplay === mode ? "primary" : "secondary"}
                          onClick={() => change(active.fieldId, { unitDisplay: mode })}
                        >
                          {mode === "both"
                            ? t("template.unit_both")
                            : t("template.unit_primary", { unit: field.unit ?? "" })}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-2 border-t border-line pt-3">
                  <Toggle
                    checked={field.required}
                    disabled={active.platformRequired}
                    label={t("template.required_switch")}
                    onChange={(next) => change(active.fieldId, { required: next })}
                  />
                  {active.platformRequired ? (
                    <p className="text-caption text-muted">{t("template.required_floor")}</p>
                  ) : (
                    <p className="text-caption text-muted">{t("template.required_new_note")}</p>
                  )}

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-body-sm text-ink">{t("template.filter_switch")}</span>
                    <StatusBadge tone={facetTone(field.facet)} size="sm" shape="chip">
                      {active.facetLabel}
                    </StatusBadge>
                  </div>
                </div>

                {!field.own && !field.detached && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => setDetaching(active)}
                  >
                    {t("template.detach")}
                  </Button>
                )}
                {field.detached && (
                  <p className="text-caption text-warn-ink">{t("template.detached_note")}</p>
                )}
              </div>
            ) : (
              <p className="text-body-sm text-muted">{t("template.settings_none")}</p>
            )}
          </Panel>

          <Panel eyebrow={t("template.ownership_heading")}>
            {/*
              Load-bearing rather than decorative: the facet column is read-only
              and a seller who does not know why will read it as broken.
            */}
            <p className="max-w-prose text-caption text-muted">{t("template.ownership_body")}</p>
          </Panel>
        </div>
      </aside>

      <Modal
        open={detaching !== null}
        onClose={() => setDetaching(null)}
        size="sm"
        title={t("template.detach_confirm", { field: detaching?.label ?? "" })}
        description={t("template.detach_body")}
        closeLabel={t("overlay.close")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDetaching(null)}>
              {t("action.cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (detaching) change(detaching.fieldId, { detached: true });
                setDetaching(null);
              }}
            >
              {t("template.detach_go")}
            </Button>
          </>
        }
      />
    </div>
  );
}

function facetTone(state: BoardField["facet"]): StatusTone {
  // Neutral throughout. None of the three is a fault — they are three different
  // true statements about who a field belongs to.
  return state === "platform" ? "info" : "neutral";
}

function PendingList({
  changes,
  total,
  sellerTemplateId,
  pending,
  onApply,
  onDiscard,
}: {
  changes: readonly BoardChange[];
  total: number;
  sellerTemplateId: string;
  pending: boolean;
  onApply: (form: FormData) => void;
  onDiscard: (form: FormData) => void;
}) {
  /*
     Absent with nothing pending, rather than disabled.

     §"States": with none pending the primary action is absent. A disabled
     `Review 0 changes` is a control a seller reads as broken.
  */
  if (changes.length === 0) return null;

  const form = () => {
    const data = new FormData();
    data.set("sellerTemplateId", sellerTemplateId);
    return data;
  };

  return (
    <Panel
      title={t("template.pending_heading")}
      description={t("template.pending_eyebrow", { count: total })}
    >
      <div className="flex flex-col gap-3">
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {changes.map((change, index) => (
            <li
              key={`${change.sentence}-${index}`}
              className="flex flex-col gap-1 rounded-card border border-line bg-paper-sunk px-3 py-2.5"
            >
              <span className="text-body-sm text-ink">{change.sentence}</span>
              {/*
                The blast radius, per change. The board had one button and no
                statement of what applying it would do to 318 live products.
              */}
              <span
                className={`font-mono text-eyebrow uppercase ${
                  change.blast === "flag" ? "text-warn-ink" : "text-muted"
                }`}
              >
                {change.blastLabel}
              </span>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
          <Button disabled={pending} onClick={() => onApply(form())}>
            {t("template.apply")}
          </Button>
          <Button variant="secondary" disabled={pending} onClick={() => onDiscard(form())}>
            {t("template.discard")}
          </Button>
        </div>
      </div>
    </Panel>
  );
}
