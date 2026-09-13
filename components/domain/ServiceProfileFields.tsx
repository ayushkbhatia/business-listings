"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, Label, Textarea } from "@/components/primitives";
import { Close } from "@/components/primitives/icons";
import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import {
  ENGAGEMENTS_MAX,
  HEADLINE_MAX,
  SERVICES_MAX,
  sectorSlug,
} from "@/lib/onboarding/service-profile";

/**
 * Board `2c-s` — the services field set, as one component.
 *
 * **AC7: "`2c-s` and `3b-s` render the same field set — a change to one is a
 * change to both."** The only way to keep that true is for there to be one
 * component, so this is it, and both the onboarding step and the dashboard's
 * listing screen mount it. A shared field set that exists twice is two field
 * sets that agree today.
 *
 * Presentational and controlled. It owns no save behaviour and no server call:
 * onboarding autosaves per field and the dashboard saves a whole form, and a
 * component that decided which would have to be forked for the other — which is
 * exactly what AC7 forbids.
 *
 * ## Sectors: chips, then search, then free entry
 *
 * The chips are the most-picked sectors in this seller's own trades, from an
 * index recomputed nightly. On a directory where nobody has filled the field in
 * there are none, and the component says so rather than rendering an empty row:
 * padding it with a list we invented would be the curated list the board rejects,
 * and it would look like data.
 */

export interface SectorOption {
  label: string;
  pickedBy: number;
}

export interface ServiceProfileValue {
  headline: string;
  servicesOffered: string[];
  sectorsServed: string[];
  /**
   * Board `1d-s` B8 — engagements declared per sector, keyed by `sectorSlug`.
   * A sector with no key has no declared count, which is not zero.
   */
  sectorEngagements: Record<string, number>;
  languages: string[];
}

export interface ServiceProfileFieldsProps {
  value: ServiceProfileValue;
  onChange: (next: ServiceProfileValue) => void;
  /** The most-picked sectors in this seller's trades. Empty is a real state. */
  chips: readonly SectorOption[];
  /** Searches the index. Returns matches; the caller offers free entry. */
  search: (query: string) => Promise<SectorOption[]>;
  /** Rendered under the group heading when the seller sells both. */
  grouped?: boolean;
  disabled?: boolean;
}

export function ServiceProfileFields({
  value,
  onChange,
  chips,
  search,
  grouped = false,
  disabled = false,
}: ServiceProfileFieldsProps) {
  const set = (patch: Partial<ServiceProfileValue>) => onChange({ ...value, ...patch });

  const headlineCount = value.headline.trim().length;
  const over = headlineCount > HEADLINE_MAX;

  return (
    <div className="flex flex-col gap-5">
      {grouped && (
        <h3 className="font-mono text-eyebrow uppercase tracking-wide text-muted">
          {t("profile_svc.group_services")}
        </h3>
      )}

      {/* ── The one-liner ─────────────────────────────────────────────── */}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="svc-headline">{t("profile_svc.headline")}</Label>
          <span className="rounded-pill border border-line bg-wash px-2 py-0.5 font-mono text-eyebrow uppercase tracking-wide text-muted">
            {t("profile_svc.headline_badge")}
          </span>
        </div>
        <Textarea
          id="svc-headline"
          rows={2}
          disabled={disabled}
          value={value.headline}
          placeholder={t("profile_svc.headline_placeholder")}
          onChange={(event) => set({ headline: event.target.value })}
          aria-describedby="svc-headline-count"
        />
        {/*
           The counter is live and the save is blocked over the cap rather than
           the value being truncated. A seller who wrote 96 characters chose all
           96; cutting six of them silently is the form deciding which.
        */}
        <p
          id="svc-headline-count"
          aria-live="polite"
          className={cn("mt-1 text-caption", over ? "text-warn-ink" : "text-muted")}
        >
          {over
            ? t("profile_svc.headline_over", {
                count: formatCount(headlineCount),
                max: formatCount(HEADLINE_MAX),
              })
            : t("profile_svc.headline_hint", {
                count: formatCount(headlineCount),
                max: formatCount(HEADLINE_MAX),
              })}
        </p>
      </div>

      {/* ── Services offered, capped ──────────────────────────────────── */}
      <ChipField
        id="svc-services"
        label={t("profile_svc.services")}
        hint={t("profile_svc.services_hint", { max: formatCount(SERVICES_MAX) })}
        fullNote={t("profile_svc.services_full", { max: formatCount(SERVICES_MAX) })}
        addLabel={t("profile_svc.services_add")}
        values={value.servicesOffered}
        max={SERVICES_MAX}
        disabled={disabled}
        onChange={(next) => set({ servicesOffered: next })}
      />

      {/* ── Sectors: chips, search, free entry ────────────────────────── */}
      <SectorField
        values={value.sectorsServed}
        chips={chips}
        search={search}
        disabled={disabled}
        onChange={(next) => {
          // A removed sector takes its count with it.
          const kept = new Set(next.map(sectorSlug));
          set({
            sectorsServed: next,
            sectorEngagements: Object.fromEntries(
              Object.entries(value.sectorEngagements).filter(([slug]) => kept.has(slug)),
            ),
          });
        }}
      />

      {value.sectorsServed.length > 0 && (
        <EngagementCounts
          sectors={value.sectorsServed}
          counts={value.sectorEngagements}
          disabled={disabled}
          onChange={(next) => set({ sectorEngagements: next })}
        />
      )}

      {/* ── Languages ─────────────────────────────────────────────────── */}
      <ChipField
        id="svc-languages"
        label={t("profile_svc.languages")}
        addLabel={t("profile_svc.languages_add")}
        values={value.languages}
        disabled={disabled}
        onChange={(next) => set({ languages: next })}
      />
    </div>
  );
}

/**
 * A removable pill, shaped like the extra-category chips one step earlier.
 *
 * Built here rather than by extending `Tag`, which has no remove affordance and
 * is used in nineteen read-only places. The visual is copied from
 * `ProfileForm`'s extras row deliberately: these two field sets sit on the same
 * screen for a `both` seller, and a chip that looked different between them
 * would read as a different kind of thing.
 */
function RemovablePill({
  label,
  disabled,
  onRemove,
}: {
  label: string;
  disabled?: boolean;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-fill px-2.5 py-1 text-caption text-body">
      {label}
      {!disabled && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={t("profile_svc.remove", { value: label })}
          className="flex size-4 items-center justify-center rounded-pill text-muted hover:text-ink focus-visible:shadow-focus focus-visible:outline-none"
        >
          <Close size={10} />
        </button>
      )}
    </span>
  );
}

/**
 * A list of short free-text values, entered one at a time.
 *
 * Shared by services and languages because they are the same control with a
 * different label and a different cap — and one of them having a cap is the
 * only difference in behaviour.
 */
function ChipField({
  id,
  label,
  hint,
  fullNote,
  addLabel,
  values,
  max,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  fullNote?: string;
  addLabel: string;
  values: string[];
  max?: number;
  disabled?: boolean;
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const full = max !== undefined && values.length >= max;

  function add() {
    const entry = draft.trim().replace(/\s+/g, " ");
    if (!entry || full) return;
    // Case-insensitive, so a seller cannot add "VAT" beside "vat".
    if (values.some((held) => held.toLowerCase() === entry.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...values, entry]);
    setDraft("");
  }

  return (
    <div>
      <Label htmlFor={id}>{label}</Label>

      {values.length > 0 && (
        <ul className="mb-2 mt-1 flex flex-wrap gap-1.5">
          {values.map((entry) => (
            <li key={entry}>
              <RemovablePill
                label={entry}
                disabled={disabled}
                onRemove={() => onChange(values.filter((v) => v !== entry))}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <Input
          id={id}
          value={draft}
          disabled={disabled || full}
          placeholder={addLabel}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button variant="secondary" onClick={add} disabled={disabled || full || !draft.trim()}>
          {addLabel}
        </Button>
      </div>

      <p className="mt-1 text-caption text-muted">{full ? fullNote : hint}</p>
    </div>
  );
}

/**
 * How many engagements in each sector — board `1d-s` B8, and optional.
 *
 * The storefront prints these beside the sector chips with *counts are
 * engagements the firm has declared, not audited by us* directly beneath, and
 * this says the same thing to the seller before they type a number: it is a
 * declaration in public, under their name. A blank is *not declared* and prints
 * a chip without a number — never a zero.
 *
 * Real inputs with real labels, one per sector, rather than a number squeezed
 * into each pill: a field whose only name is the chip beside it is a field a
 * screen reader announces as "edit text".
 */
function EngagementCounts({
  sectors,
  counts,
  disabled,
  onChange,
}: {
  sectors: readonly string[];
  counts: Record<string, number>;
  disabled?: boolean;
  onChange: (next: Record<string, number>) => void;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-caption font-medium text-body">{t("profile_svc.engagements")}</legend>
      <p className="mt-0.5 max-w-prose text-caption text-muted">{t("profile_svc.engagements_hint")}</p>
      <ul className="mt-2 grid list-none gap-2 p-0 sm:grid-cols-2">
        {sectors.map((sector) => {
          const slug = sectorSlug(sector);
          const id = `svc-engagements-${slug.replace(/[^a-z0-9]+/g, "-")}`;
          return (
            <li key={slug} className="flex items-center justify-between gap-3">
              <label htmlFor={id} className="min-w-0 truncate text-body-sm text-body">
                {sector}
              </label>
              <div className="w-28 shrink-0">
                <Input
                  id={id}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={ENGAGEMENTS_MAX}
                  step={1}
                  disabled={disabled}
                  value={counts[slug] ?? ""}
                  placeholder={t("profile_svc.engagements_placeholder")}
                  onChange={(event) => {
                    const raw = event.target.value.trim();
                    const next = { ...counts };
                    if (raw === "") delete next[slug];
                    else next[slug] = Number(raw);
                    onChange(next);
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

/** Sectors: the chips, the search, and free entry when nothing matches. */
function SectorField({
  values,
  chips,
  search,
  disabled,
  onChange,
}: {
  values: string[];
  chips: readonly SectorOption[];
  search: (query: string) => Promise<SectorOption[]>;
  disabled?: boolean;
  onChange: (next: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<SectorOption[]>([]);
  const latest = useRef(0);

  useEffect(() => {
    const term = query.trim();
    /*
       No `setMatches([])` here, deliberately. Clearing state synchronously
       inside an effect cascades a render, and the lint rule that says so is
       right — the empty case is derivable from the query, so it is derived
       below rather than written. The effect's only job is the fetch.
    */
    if (term.length < 2) return;

    // Sequence-guarded, so a slow earlier search cannot overwrite a fast later
    // one and show the wrong list under the box.
    const ticket = ++latest.current;
    let live = true;
    const timer = setTimeout(() => {
      void search(term).then((rows) => {
        if (live && ticket === latest.current) setMatches(rows);
      });
    }, 180);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, search]);

  const held = useMemo(() => new Set(values.map(sectorSlug)), [values]);

  // Derived rather than stored: a query shortened below two characters shows
  // nothing, without the effect having to write the emptiness back.
  const visible = query.trim().length < 2 ? [] : matches;

  function pick(label: string) {
    const entry = label.trim().replace(/\s+/g, " ");
    if (!entry || held.has(sectorSlug(entry))) return;
    onChange([...values, entry]);
    setQuery("");
    setMatches([]);
  }

  const typed = query.trim().replace(/\s+/g, " ");
  const exact = visible.some((row) => sectorSlug(row.label) === sectorSlug(typed));
  const offerNew = typed.length >= 2 && !exact && !held.has(sectorSlug(typed));

  return (
    <div>
      <Label htmlFor="svc-sectors" hint={t("profile_svc.sectors_hint")}>
        {t("profile_svc.sectors")}
      </Label>

      {values.length > 0 && (
        <ul className="mb-2 mt-1 flex flex-wrap gap-1.5">
          {values.map((entry) => (
            <li key={entry}>
              <RemovablePill
                label={entry}
                disabled={disabled}
                onRemove={() => onChange(values.filter((v) => v !== entry))}
              />
            </li>
          ))}
        </ul>
      )}

      <Input
        id="svc-sectors"
        value={query}
        disabled={disabled}
        placeholder={t("profile_svc.sectors_search")}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (offerNew) pick(typed);
          }
        }}
      />

      {(visible.length > 0 || offerNew) && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {visible
            .filter((row) => !held.has(sectorSlug(row.label)))
            .map((row) => (
              <li key={row.label}>
                <button
                  type="button"
                  onClick={() => pick(row.label)}
                  disabled={disabled}
                  className="rounded-pill border border-line bg-card px-2.5 py-1 text-caption text-body hover:border-moss-muted focus-visible:shadow-focus focus-visible:outline-none"
                >
                  {row.label}
                  <span className="ms-1.5 text-faint">
                    {t("profile_svc.sectors_picked_by", { count: row.pickedBy })}
                  </span>
                </button>
              </li>
            ))}

          {/* The exact string echoed back, so what is about to be added is what
              was typed rather than something we cleaned up on the way. */}
          {offerNew && (
            <li>
              <button
                type="button"
                onClick={() => pick(typed)}
                disabled={disabled}
                className="rounded-pill border border-moss-line bg-moss-wash px-2.5 py-1 text-caption text-moss-deep hover:border-moss focus-visible:shadow-focus focus-visible:outline-none"
              >
                {t("profile_svc.sectors_add_new", { value: typed })}
              </button>
            </li>
          )}
        </ul>
      )}

      {chips.length > 0 ? (
        <>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {chips
              .filter((chip) => !held.has(sectorSlug(chip.label)))
              .map((chip) => (
                <li key={chip.label}>
                  <button
                    type="button"
                    onClick={() => pick(chip.label)}
                    disabled={disabled}
                    className="rounded-pill border border-line bg-wash px-2.5 py-1 text-caption text-body hover:border-moss-muted focus-visible:shadow-focus focus-visible:outline-none"
                  >
                    {chip.label}
                  </button>
                </li>
              ))}
          </ul>
          <p className="mt-1 max-w-prose text-caption text-muted">
            {t("profile_svc.sectors_chips_hint")}
          </p>
        </>
      ) : (
        /*
           The cold state, said rather than padded. Nobody in this seller's
           trades has listed a sector, so there is nothing to suggest — and a
           plausible twelve we invented would be the curated list this field
           exists to avoid, wearing the clothes of data.
        */
        <p className="mt-2 max-w-prose text-caption text-muted">
          {t("profile_svc.sectors_cold")}
        </p>
      )}
    </div>
  );
}
