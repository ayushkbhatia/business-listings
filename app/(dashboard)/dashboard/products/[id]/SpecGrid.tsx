"use client";

import { useId } from "react";
import {
  FieldError,
  Input,
  MultiSelect,
  SegmentedControl,
  Select,
} from "@/components/primitives";
import { StatusBadge, Tag } from "@/components/display";
import { isMultiselect, selectedMulti } from "@/lib/products/spec-values";
import { isFilled } from "@/lib/catalogue/overlay";
import { t } from "@/lib/i18n";
import type { EditorField } from "./fields";

/**
 * Board 3g's field grid — every field the template carries, in template order.
 *
 * ## Every field, not the interesting ones
 *
 * The board this came from rendered twelve fields while its own completeness
 * card counted twenty-two and named four missing: one gap visible, four
 * claimed, and nothing at all saying ten more fields existed. A truncated grid
 * under an untruncated count is worse than either alone, so the grid is
 * complete and the chips scope the view.
 *
 * ## Order follows the template, and gaps are not sorted to the top
 *
 * The preview rail beside this renders the same fields in the same order. That
 * correspondence is the entire reason a preview is worth the 400px, and
 * floating the gaps would break it. `Go to the gaps` sets a chip instead.
 *
 * ## The chips hide, they do not unmount
 *
 * `mergeSpecValues` clears a stored value only for a field that posted a
 * `spec.present` marker and came back empty — which is what makes a value
 * impossible to lose to a form that was not showing its field. A filtered-out
 * field therefore stays mounted with its marker and its value, so an edit made
 * under `All` survives being scoped away under `Gaps`. Unmounting would be safe
 * against deletion and would silently discard that edit instead, which is the
 * same class of loss one screen over that cost this project a migration.
 *
 * Every control is driven from `values`. No `defaultValue` anywhere: a remount
 * would reseed it from props and lose whatever had been typed.
 */

export type Scope = "all" | "gaps" | "filterable";

export interface SpecGridProps {
  fields: readonly EditorField[];
  values: Record<string, string>;
  onChange: (fieldId: string, value: string) => void;
  scope: Scope;
  onScope: (next: Scope) => void;
  /** Per-field id, so the Save block can move focus to the first offender. */
  fieldDomId: (fieldId: string) => string;
}

/** A field with no value. The same test the server refuses a save with. */
export function isGap(field: EditorField, values: Record<string, string>): boolean {
  return !isFilled(readValue(field, values));
}

function readValue(field: EditorField, values: Record<string, string>): unknown {
  const raw = values[field.fieldId] ?? "";
  // A multiselect is stored as an array, so emptiness has to be judged on the
  // parsed value rather than on the joined string — `"|"` alone is not a value.
  return isMultiselect(field.type) ? raw.split("|").filter((part) => part.trim() !== "") : raw;
}

function matches(field: EditorField, scope: Scope, values: Record<string, string>): boolean {
  if (scope === "all") return true;
  if (scope === "gaps") return isGap(field, values);
  return field.facet === "platform";
}

export function SpecGrid(props: SpecGridProps) {
  const counts = {
    all: props.fields.length,
    gaps: props.fields.filter((field) => isGap(field, props.values)).length,
    filterable: props.fields.filter((field) => field.facet === "platform").length,
  };
  const visible = props.fields.filter((field) => matches(field, props.scope, props.values));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label={t("product.scope_label")}
          value={props.scope}
          onChange={props.onScope}
          size="sm"
          options={[
            { value: "all", label: t("product.scope_all", { count: String(counts.all) }) },
            { value: "gaps", label: t("product.scope_gaps", { count: String(counts.gaps) }) },
            {
              value: "filterable",
              label: t("product.scope_filterable", { count: String(counts.filterable) }),
            },
          ]}
        />
        <p className="text-caption text-muted">{t("product.scope_hint")}</p>
      </div>

      {visible.length === 0 ? (
        <p className="text-body-sm text-muted">{t("product.scope_empty")}</p>
      ) : null}

      {/*
        One column until 1440, two above it — `min-[1440px]`, not `xl:`, which
        is 1280. The spec reserves 1280–1439 for a single column on purpose: two
        columns at ~300px each truncate a value like "Grooved, AWWA C606", and a
        truncated value in an editor is a value the seller cannot check. A
        one-field template gets one column rather than a grid with a hole.
      */}
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 min-[1440px]:grid-cols-2">
        {props.fields.map((field) => (
          <SpecField
            key={field.fieldId}
            field={field}
            value={props.values[field.fieldId] ?? ""}
            onChange={props.onChange}
            domId={props.fieldDomId(field.fieldId)}
            hidden={!matches(field, props.scope, props.values)}
          />
        ))}
      </div>
    </div>
  );
}

interface SpecFieldProps {
  field: EditorField;
  value: string;
  onChange: (fieldId: string, value: string) => void;
  domId: string;
  hidden: boolean;
}

function SpecField({ field, value, onChange, domId, hidden }: SpecFieldProps) {
  const reasonId = useId();
  const gap = !isFilled(readValue(field, { [field.fieldId]: value }));
  const multi = isMultiselect(field.type);

  /*
     The reason a gap matters, in the terms that are actually true.

     Three sentences, because the honest one depends on what the field is. None
     of them claims a ranking effect: an empty filterable field is not a product
     ranked lower, it is a product absent from that filter, which is a fact
     about how the index works rather than a correlation we cannot support.

     And none carries a search-volume figure. Board 3h reached that first and
     said so on its own screen — the search log records what was typed, not
     which filters were used — and two sibling seller screens must not disagree
     about whether that number exists.
  */
  const reason = !gap
    ? null
    : field.own || field.detached
      ? t("product.gap_reason_yours_only")
      : field.facet === "platform"
        ? t("product.gap_reason_filter")
        : t("product.gap_reason_not_a_facet");

  return (
    <div hidden={hidden} className="flex flex-col gap-1">
      {/*
        The marker that licenses a delete. It stays mounted while the field is
        scoped out of view, so a value edited under one chip is not cleared by
        a save made under another.
      */}
      <input type="hidden" name="spec.present" value={field.fieldId} />

      <label htmlFor={domId} className="flex flex-wrap items-center gap-1.5 text-body-sm text-ink">
        <span className={gap ? "text-bad-ink" : undefined}>{field.label}</span>
        {field.unit ? <span className="text-caption text-muted">· {field.unit}</span> : null}
        {/*
          FILTER reads `facet`, never `isFilterable`. The two differ for a
          detached field, and a badge that could not tell "the platform does not
          filter on this" from "this is yours alone" is how the board's badges
          came to disagree with 3h's facet set in the first place.
        */}
        {field.facet === "platform" && <Tag mono size="sm">{t("import.filter_badge")}</Tag>}
        {(field.own || field.detached) && (
          <Tag mono size="sm">{t("product.pill_yours_only")}</Tag>
        )}
        {field.requiredNow && (
          <Tag mono size="sm">{t("product.pill_required")}</Tag>
        )}
        {/*
          A word, not a colour. AC 15: the state has to survive the colour being
          removed, and the pink border alone does not.
        */}
        {gap && (
          <StatusBadge tone="warn" size="sm">
            {t("product.pill_empty")}
          </StatusBadge>
        )}
      </label>

      {multi ? (
        <MultiField field={field} value={value} onChange={onChange} domId={domId} gap={gap} reasonId={reasonId} />
      ) : field.options.length > 0 ? (
        <Select
          id={domId}
          name={`spec.${field.fieldId}`}
          value={value}
          onChange={(event) => onChange(field.fieldId, event.target.value)}
          invalid={gap}
          /*
             An empty option, and it is load-bearing.

             A `<select>` whose value matches no option falls back to index 0 —
             so an unfilled field displayed "DN15" and, on submit, POSTED it.
             A seller opening a product they had never described and pressing
             Save would have written a nominal size, a body material and an end
             connection they never chose, onto a public page and into the facet
             index every buyer filters on. Invented specification data is the
             worst thing this screen could produce.

             The empty option is not the placeholder the handoff's correction 4
             is about. That one carried the argument for filling the field, and
             it vanished the moment the seller clicked in; this carries no
             information at all, and the gap's reason still lives beneath the
             field where it stays visible.
          */
          placeholder={t("product.select_empty")}
          {...(reason ? { "aria-describedby": reasonId } : {})}
          options={optionsFor(field, value).map((option) => ({ value: option, label: option }))}
        />
      ) : (
        <Input
          id={domId}
          name={`spec.${field.fieldId}`}
          mono={field.type === "number"}
          value={value}
          onChange={(event) => onChange(field.fieldId, event.target.value)}
          invalid={gap}
          {...(reason ? { "aria-describedby": reasonId } : {})}
        />
      )}

      {reason ? (
        <FieldError id={reasonId} reserveSpace={false}>
          {reason}
        </FieldError>
      ) : null}
      {field.detached ? (
        <p className="text-caption text-muted">{t("product.field_detached_note")}</p>
      ) : null}
    </div>
  );
}

/**
 * The options a select may show: the template's, plus whatever is stored.
 *
 * A value the template no longer offers still has to render, or the next save
 * silently replaces it with nothing — the seller sees a box that looks empty
 * because the option was withdrawn, and clears a value the buyer can see on the
 * storefront. "Unfilled data stays visible" cuts both ways: so does filled data
 * the template has stopped expecting.
 */
function optionsFor(field: EditorField, value: string): string[] {
  const stored = selectedMulti(value);
  const extra = stored.filter((option) => !field.options.includes(option));
  return extra.length > 0 ? [...field.options, ...extra] : [...field.options];
}

interface MultiFieldProps {
  field: EditorField;
  value: string;
  onChange: (fieldId: string, value: string) => void;
  domId: string;
  gap: boolean;
  reasonId: string;
}

/**
 * A multiselect, and the hidden input that actually posts it.
 *
 * `MultiSelect` takes `value`/`onChange` and renders no form control of its own
 * — it has no `name` and submits nothing. Without the input beside it the field
 * would post an empty string with its `spec.present` marker set, and
 * `mergeSpecValues` would read that as "the seller emptied this box" and delete
 * the stored array. That is precisely the bug this whole path exists to close,
 * so the two are written together and stay together.
 */
function MultiField({ field, value, onChange, domId, gap, reasonId }: MultiFieldProps) {
  const selected = selectedMulti(value);
  return (
    <>
      <input type="hidden" name={`spec.${field.fieldId}`} value={selected.join("|")} />
      <div id={domId}>
        <MultiSelect
          label={field.label}
          // Without these the trigger renders the bare selected count — "1" —
          // which is a number with no noun beside a field called Certification.
          placeholder={t("product.multi_placeholder")}
          summaryLabel={(count) => t("product.multi_summary", { count })}
          removeLabel={(option) => t("product.multi_remove", { option })}
          options={optionsFor(field, value).map((option) => ({ value: option, label: option }))}
          value={selected}
          invalid={gap}
          onChange={(next) => onChange(field.fieldId, next.join("|"))}
          {...(gap ? { describedBy: reasonId } : {})}
        />
      </div>
    </>
  );
}
