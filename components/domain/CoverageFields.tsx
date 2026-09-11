"use client";

import { useId, useMemo, useState } from "react";
import { Button, Checkbox, Input, Label } from "@/components/primitives";
import { Close } from "@/components/primitives/icons";
import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { DELIVERY_MODES, framingFor } from "@/lib/locations/service-coverage";
import type { CoverageScope } from "@/lib/locations/coverage";
import type { DeliveryMode, Emirate } from "@/lib/db/generated/enums";

/**
 * Board `2d-s` — the coverage field set, as one component.
 *
 * Mounted by the onboarding step and by the dashboard's locations screen, for
 * the same reason `ServiceProfileFields` is: a field set that exists twice is
 * two field sets that agree today. The dashboard is the superset — it will grow
 * per-service rows on `3c-s` — but the default set a buyer reads has to be the
 * same control in both places or the two will drift.
 *
 * Presentational and controlled. It owns no server call and no save behaviour:
 * onboarding writes on every click and the dashboard may one day batch, and a
 * component that decided which could not serve both.
 *
 * ## The ordering is the design
 *
 * The mode group is above the areas and that is not layout. Ask for emirates
 * first and a remote-only practice reasonably ticks all eight — true, and
 * useless. Ask how the work reaches the client first and the eight acquire a
 * meaning before they are filled in, which is why the areas stay visibly inert
 * until the question above them is answered.
 */

export interface CoverageChipView {
  key: string;
  label: string;
  scope: CoverageScope;
  on: boolean;
}

export interface FreeZoneView {
  id: string;
  name: string;
  emirate: Emirate;
}

export interface CoverageFieldsProps {
  modes: readonly DeliveryMode[];
  onModes: (next: DeliveryMode[]) => void;

  chips: readonly CoverageChipView[];
  onChip: (key: string, on: boolean) => void;
  onSelectAll: () => void;

  /** Default rows narrower than the eight chips. Read-only here. */
  otherScopes?: readonly { id: string; label: string }[];

  freeZones: readonly FreeZoneView[];
  registrations: readonly FreeZoneView[];
  onFreeZone: (areaId: string, on: boolean) => void;

  /** Rendered as a labelled group when the seller sells both. */
  grouped?: boolean;
  disabled?: boolean;
}

export function CoverageFields({
  modes,
  onModes,
  chips,
  onChip,
  onSelectAll,
  otherScopes = [],
  freeZones,
  registrations,
  onFreeZone,
  grouped = false,
  disabled = false,
}: CoverageFieldsProps) {
  /*
     Unique per mount, because nothing stops two of these being on one page —
     the gallery renders four side by side, and a `both` seller's step already
     carries one beside a branch list. A hardcoded id makes `aria-describedby`
     and `for` point at whichever copy the document happens to reach first,
     which is a screen-reader user reading the wrong field's state.
  */
  const uid = useId();
  const areasStateId = `${uid}-areas-state`;
  const areasLabelId = `${uid}-areas-label`;

  const framing = framingFor(modes);
  const answered = framing !== "unanswered";
  const claimed = chips.filter((chip) => chip.on).length;
  const allOn = chips.length > 0 && claimed === chips.length;

  const toggleMode = (mode: DeliveryMode, on: boolean) => {
    onModes(
      on ? DELIVERY_MODES.filter((m) => m === mode || modes.includes(m)) : modes.filter((m) => m !== mode),
    );
  };

  return (
    <div className="flex flex-col gap-6">
      {grouped && (
        <h3 className="font-mono text-eyebrow uppercase tracking-wide text-muted">
          {t("coverage_step.group_coverage")}
        </h3>
      )}

      {/* ── How the work reaches the client ───────────────────────────── */}
      <fieldset className="border-0 p-0">
        <legend className="font-mono text-eyebrow uppercase tracking-wide text-muted">
          {t("coverage_step.modes")}
        </legend>
        <p className="mt-1 max-w-prose text-caption text-muted">{t("coverage_step.modes_hint")}</p>

        <div className="mt-3 flex flex-col gap-3">
          {DELIVERY_MODES.map((mode) => (
            <Checkbox
              key={mode}
              checked={modes.includes(mode)}
              disabled={disabled}
              label={t(`coverage_step.mode.${mode}` as "coverage_step.mode.remote")}
              description={t(`coverage_step.mode.${mode}_note` as "coverage_step.mode.remote_note")}
              onChange={(event) => toggleMode(mode, event.target.checked)}
            />
          ))}
        </div>

        {/*
           The reframing line, and the reason there is no greyed distance
           control anywhere below it. B8: suppress, do not disable — a disabled
           radius slider tells a remote practice they are missing something they
           are not.
        */}
        {answered && (
          <p className="mt-3 max-w-prose text-caption text-body">
            {framing === "where_you_travel"
              ? t("coverage_step.framing.where_you_travel")
              : t("coverage_step.framing.where_clients_are")}
          </p>
        )}
      </fieldset>

      {/* ── The areas ─────────────────────────────────────────────────── */}
      {/*
         A `role="group"`, not a `<fieldset>`.

         These are toggle buttons rather than form controls, and a `<legend>`
         has to be the *first child* of its fieldset — which this layout cannot
         give it, because the heading and `Select all` share a line. A legend
         nested in a wrapper renders as a plain inline box and names nothing,
         which is worse than not claiming to. A labelled group says the same
         thing and is true. The mode set above is a real fieldset, because it is
         real checkboxes and its legend does sit first.
      */}
      <div role="group" aria-labelledby={areasLabelId} aria-describedby={areasStateId}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p id={areasLabelId} className="font-mono text-eyebrow uppercase tracking-wide text-muted">
            {t("coverage_step.areas")}
          </p>
          <span className="ms-auto">
            <Button
              size="sm"
              variant="secondary"
              disabled={disabled || !answered || allOn}
              onClick={onSelectAll}
            >
              {allOn
                ? t("coverage_step.select_all_done", { count: formatCount(chips.length) })
                : t("coverage_step.select_all")}
            </Button>
          </span>
        </div>

        <p className="mt-1 max-w-prose text-caption text-muted">{t("coverage_step.areas_hint")}</p>

        <ul
          className={cn(
            "mt-3 flex list-none flex-wrap gap-1.5 p-0",
            !answered && "opacity-50",
          )}
        >
          {chips.map((chip) => (
            <li key={chip.key}>
              <button
                type="button"
                aria-pressed={chip.on}
                disabled={disabled || !answered}
                onClick={() => onChip(chip.key, !chip.on)}
                className={cn(
                  "rounded-pill border px-3 py-1.5 text-caption",
                  "focus-visible:shadow-focus focus-visible:outline-none",
                  "disabled:cursor-not-allowed",
                  chip.on
                    ? "border-moss bg-moss-wash text-moss-deep"
                    : "border-line bg-card text-body hover:border-moss-muted",
                )}
              >
                {chip.label}
              </button>
            </li>
          ))}
        </ul>

        {/*
           The count and the cost, in one line each. Q1 says `Select all` gets no
           confirmation, so the cost is stated here once rather than asked about
           every time — a confirm on an action we allow trains sellers to dismiss
           dialogs, which is expensive the first time one matters.
        */}
        {/*
           The count survives the chips going inert.

           A seller who clears the mode answer above makes these areas
           unanswerable, not unclaimed — the rows are still there and still
           publish. Replacing the count with the locked line hid eight claims
           behind a 50% opacity and read as the work having been thrown away.
        */}
        <p id={areasStateId} aria-live="polite" className="mt-2 text-caption text-muted">
          {claimed === 0
            ? t("coverage_step.areas_none")
            : t("coverage_step.areas_count", { count: claimed })}
        </p>
        {!answered && (
          <p className="mt-1 max-w-prose text-caption text-faint">
            {t("coverage_step.areas_locked")}
          </p>
        )}
        {answered && claimed > 0 && (
          <p className="mt-1 max-w-prose text-caption text-faint">{t("coverage_step.areas_cost")}</p>
        )}

        {otherScopes.length > 0 && (
          <div className="mt-3">
            <p className="font-mono text-eyebrow uppercase tracking-wide text-muted">
              {t("coverage_step.other_scopes")}
            </p>
            <ul className="mt-1 flex list-none flex-wrap gap-1.5 p-0">
              {otherScopes.map((scope) => (
                <li
                  key={scope.id}
                  className="rounded-pill border border-dashed border-line px-2.5 py-1 text-caption text-muted"
                >
                  {scope.label}
                </li>
              ))}
            </ul>
            <p className="mt-1 max-w-prose text-caption text-faint">
              {t("coverage_step.other_scopes_note")}
            </p>
          </div>
        )}
      </div>

      {/* ── Free zones, a second axis ─────────────────────────────────── */}
      <FreeZoneField
        freeZones={freeZones}
        registrations={registrations}
        disabled={disabled}
        onChange={onFreeZone}
      />
    </div>
  );
}

/**
 * The free-zone picker: search first, chips for what is already claimed.
 *
 * Orthogonal to the areas above, which is the whole point. On the goods side a
 * free zone is a place a warehouse sits; here it is a registration — a DMCC
 * company often needs an auditor on DMCC's approved list — so a firm can be
 * approved in one zone and cover one emirate, or cover all seven and be
 * approved nowhere.
 *
 * Filtered in the browser rather than over the wire. The list is the whole
 * taxonomy of free zones and it is small enough to send, so the search is
 * instant and there is no debounce to get wrong. The sectors field on `2c-s`
 * searches the server because its index is unbounded and grows with the
 * directory; this one does not.
 */
function FreeZoneField({
  freeZones,
  registrations,
  disabled,
  onChange,
}: {
  freeZones: readonly FreeZoneView[];
  registrations: readonly FreeZoneView[];
  disabled?: boolean;
  onChange: (areaId: string, on: boolean) => void;
}) {
  const zonesId = `${useId()}-zones`;
  const [query, setQuery] = useState("");
  const held = useMemo(() => new Set(registrations.map((row) => row.id)), [registrations]);

  const term = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      term.length === 0
        ? []
        : freeZones.filter((zone) => !held.has(zone.id) && zone.name.toLowerCase().includes(term)),
    [term, freeZones, held],
  );

  return (
    <div>
      <Label htmlFor={zonesId} hint={t("coverage_step.zones_hint")}>
        {t("coverage_step.zones")}
      </Label>

      {registrations.length > 0 && (
        <ul className="mb-2 mt-1 flex list-none flex-wrap gap-1.5 p-0">
          {registrations.map((zone) => (
            <li key={zone.id}>
              <span className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-fill px-2.5 py-1 text-caption text-body">
                {zone.name}
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => onChange(zone.id, false)}
                    aria-label={t("coverage_step.zones_remove", { name: zone.name })}
                    className="flex size-4 items-center justify-center rounded-pill text-muted hover:text-ink focus-visible:shadow-focus focus-visible:outline-none"
                  >
                    <Close size={10} />
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* The count is the row count, never a rounded claim: `over 40` written
          into a placeholder is a sentence that survives the list shrinking. */}
      <div className="mt-1">
        <Input
          id={zonesId}
          value={query}
          disabled={disabled}
          placeholder={t("coverage_step.zones_search", { count: freeZones.length })}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {term.length > 0 && (
        <>
          {matches.length > 0 ? (
            <ul className="mt-2 flex list-none flex-wrap gap-1.5 p-0">
              {matches.slice(0, 12).map((zone) => (
                <li key={zone.id}>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      onChange(zone.id, true);
                      setQuery("");
                    }}
                    className="rounded-pill border border-line bg-card px-2.5 py-1 text-caption text-body hover:border-moss-muted focus-visible:shadow-focus focus-visible:outline-none"
                  >
                    {t("coverage_step.zones_add", { name: zone.name })}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            /*
               No free entry, and the line says why rather than offering a box.
               A free zone is a closed, checkable list — board `2d-s` Q3 wants
               these verified against the zones' own approved-provider lists
               eventually — and a typed one is a registration nobody can check.
            */
            <p className="mt-2 max-w-prose text-caption text-muted">
              {t("coverage_step.zones_no_match", { query: query.trim() })}
            </p>
          )}
        </>
      )}

      {registrations.length === 0 && term.length === 0 && (
        <p className="mt-1 text-caption text-faint">{t("coverage_step.zones_none")}</p>
      )}
    </div>
  );
}
