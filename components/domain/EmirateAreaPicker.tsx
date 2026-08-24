"use client";

import { useId, useMemo, useState } from "react";
import { Input, Select, Toggle } from "@/components/primitives";
import { Tag } from "@/components/display";
import { EMIRATES } from "@/lib/uae";

/**
 * EmirateAreaPicker — tier 4.
 *
 * The README: "seven emirates, areas nested one level, free zone as a
 * cross-cutting toggle rather than an area. A JAFZA company is in Dubai *and*
 * in a free zone."
 *
 * That sentence is the whole design. The tempting shape is an eighth entry in
 * the emirate list called "Free zones", because that is how a supplier says it
 * out loud — "we're in JAFZA, not Dubai". It is wrong in a way that costs
 * later: JAFZA is inside Dubai, a buyer filtering for suppliers in Dubai must
 * find it, and a buyer filtering for free-zone suppliers must find it too. Two
 * independent facts about one place, so two independent controls.
 *
 * The toggle filters rather than selects. Turning it on narrows the area list
 * to the free zones inside the chosen emirate; it does not become part of the
 * answer, because whether an area is a free zone is a property of the area and
 * not of this supplier's choice. `Area.isFreeZone` already says so.
 *
 * Areas are nested one level and no deeper. A supplier picks Al Quoz, not
 * Al Quoz Industrial Area 3 — the buyer searching does not know which of the
 * four they want either, and a deeper tree makes both sides guess.
 */

export interface AreaOption {
  id: string;
  name: string;
  emirate: string;
  isFreeZone: boolean;
}

export interface EmirateAreaPickerProps {
  areas: readonly AreaOption[];
  emirate: string | null;
  areaId: string | null;
  onChange: (next: { emirate: string | null; areaId: string | null }) => void;

  /** Required: names the pair of controls. */
  label: string;
  emirateLabel: string;
  areaLabel: string;
  emiratePlaceholder: string;
  areaPlaceholder: string;
  /** "Only show free zones" — a filter, said as one. */
  freeZoneFilterLabel: string;
  freeZoneTagLabel: string;
  /** Shown under the pair once an area is chosen and it is a free zone. */
  freeZoneNote: (emirate: string, area: string) => string;
  searchLabel?: string;
  noAreasLabel: string;
  disabled?: boolean;
}

export function EmirateAreaPicker({
  areas,
  emirate,
  areaId,
  onChange,
  label,
  emirateLabel,
  areaLabel,
  emiratePlaceholder,
  areaPlaceholder,
  freeZoneFilterLabel,
  freeZoneTagLabel,
  freeZoneNote,
  searchLabel,
  noAreasLabel,
  disabled = false,
}: EmirateAreaPickerProps) {
  const groupId = useId();
  const [freeZonesOnly, setFreeZonesOnly] = useState(false);
  const [search, setSearch] = useState("");

  const inEmirate = useMemo(
    () => areas.filter((area) => area.emirate === emirate),
    [areas, emirate],
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return inEmirate
      .filter((area) => (freeZonesOnly ? area.isFreeZone : true))
      .filter((area) => (needle === "" ? true : area.name.toLowerCase().includes(needle)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [inEmirate, freeZonesOnly, search]);

  const chosen = areas.find((area) => area.id === areaId) ?? null;
  const emirateName = EMIRATES.find((e) => e.value === emirate)?.label ?? "";

  return (
    <fieldset className="min-w-0 border-0 p-0">
      <legend className="sr-only">{label}</legend>

      <div className="flex flex-col gap-3">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-body-sm text-ink">{emirateLabel}</span>
          <Select
            disabled={disabled}
            value={emirate ?? ""}
            placeholder={emiratePlaceholder}
            options={EMIRATES.map((e) => ({ value: e.value, label: e.label }))}
            onChange={(event) =>
              // Changing emirate clears the area. An area from the old one is
              // not a valid answer for the new one, and leaving it selected is
              // how a Sharjah supplier ends up filed under Dubai.
              onChange({ emirate: event.target.value || null, areaId: null })
            }
          />
        </label>

        {emirate && (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-body-sm text-ink">{areaLabel}</span>
                <Select
                  disabled={disabled || visible.length === 0}
                  value={areaId ?? ""}
                  placeholder={visible.length === 0 ? noAreasLabel : areaPlaceholder}
                  options={visible.map((area) => ({
                    value: area.id,
                    label: area.isFreeZone ? `${area.name} · ${freeZoneTagLabel}` : area.name,
                  }))}
                  onChange={(event) => onChange({ emirate, areaId: event.target.value || null })}
                  aria-describedby={chosen?.isFreeZone ? `${groupId}-note` : undefined}
                />
              </label>

              {searchLabel && inEmirate.length > 12 && (
                <label className="flex w-44 shrink-0 flex-col gap-1">
                  <span className="text-caption text-muted">{searchLabel}</span>
                  <Input
                    size="sm"
                    disabled={disabled}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
              )}
            </div>

            {/*
              A filter, not a third value. Whether an area is a free zone is a
              property of the area — turning this on narrows the list and
              changes nothing about the answer.
            */}
            <Toggle
              checked={freeZonesOnly}
              disabled={disabled}
              size="sm"
              label={freeZoneFilterLabel}
              onChange={setFreeZonesOnly}
            />
          </>
        )}

        {chosen?.isFreeZone && (
          <p id={`${groupId}-note`} className="flex flex-wrap items-center gap-2 text-caption text-muted">
            <Tag mono size="sm">
              {freeZoneTagLabel}
            </Tag>
            {freeZoneNote(emirateName, chosen.name)}
          </p>
        )}
      </div>
    </fieldset>
  );
}
