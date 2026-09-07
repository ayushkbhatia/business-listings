"use client";

import { Alert } from "@/components/display";
import { Button, Input, Toggle } from "@/components/primitives";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { RamadanHours, Shift } from "@/lib/trade/hours";

/**
 * Board 3d §3 — and the board's first correction, which is the whole card.
 *
 * Ramadan **dates** and Ramadan **hours** are different objects with different
 * owners, and the board collapsed them into one `AUTO-APPLIED` label. The
 * result was a screen that contradicted board 3a: that card told the seller
 * "Ramadan hours for 2027 unconfirmed" and linked here, where nothing said
 * anything was outstanding and nothing could be acted on.
 *
 * So the card says both things separately. The date range is ours and carries
 * `ESTIMATED` until the UAE announces it; the times are the seller's, carried
 * over from last year, with a `Confirm` that is the only thing that clears the
 * reminder.
 *
 * Condensed to two weekday groups rather than seven rows — board 3d Q3. Ramadan
 * hours vary by group and not by day for almost every supplier, and seven rows
 * for a month most sellers treat as two cases is the wrong default.
 */

export interface RamadanCardProps {
  hours: RamadanHours | null;
  onChange: (hours: RamadanHours | null) => void;
  window: { year: number; from: string; to: string; confirmed: boolean } | null;
  /** True while `ramadanConfirmedYear` does not name this window's year. */
  needsConfirming: boolean;
  confirmedYear: number | null;
  onConfirm: () => void;
  disabled?: boolean;
  readOnly?: boolean;
}

/** The two groups the card edits, and the days each writes. */
const GROUPS = [
  { key: "weekdays", days: ["sun", "mon", "tue", "wed", "thu"] as const, label: "hours.ramadan_group_weekdays" },
  { key: "weekend", days: ["fri", "sat"] as const, label: "hours.ramadan_group_weekend" },
] as const;

function shiftOf(hours: RamadanHours | null, days: readonly string[]): Shift {
  if (!hours) return { open: "", close: "" };
  for (const day of days) {
    const shifts = hours[day as "mon"];
    if (shifts && shifts.length > 0) return shifts[0]!;
  }
  return hours.all?.[0] ?? { open: "", close: "" };
}

export function RamadanCard(props: RamadanCardProps) {
  const on = props.hours !== null;

  function setGroup(days: readonly string[], shift: Shift) {
    const next: RamadanHours = { ...(props.hours ?? {}) };
    /*
       Written per day rather than to `all`, because the two groups keep
       different times and `all` can only say one thing. `hoursInEffect` reads
       per-day first and falls back to `all`, so a card that had only ever
       written `all` still works — this is the finer statement of the same
       shape.
    */
    for (const day of days) next[day as "mon"] = shift.open && shift.close ? [shift] : [];
    props.onChange(next);
  }

  return (
    <section
      className={cn(
        "rounded-card border p-4",
        on ? "border-warn-line bg-warn-surface" : "border-line bg-card",
      )}
      aria-labelledby="ramadan-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Toggle
            checked={on}
            label={t("hours.ramadan")}
            onChange={(next) => props.onChange(next ? { all: [{ open: "09:00", close: "15:00" }] } : null)}
            disabled={props.disabled || props.readOnly}
          />
          <span id="ramadan-card" className="sr-only">
            {t("hours.ramadan")}
          </span>
        </div>

        {/*
          The dates, and whose they are. `ESTIMATED` until the announcement —
          Ramadan begins on a moon sighting confirmed a day or two beforehand,
          so a window printed as fact would be wrong about a third of the time
          and wrong silently.
        */}
        {props.window && (
          <span className="font-mono text-eyebrow uppercase tracking-wide text-body">
            {props.window.confirmed
              ? t("hours.ramadan_confirmed", { from: props.window.from, to: props.window.to })
              : t("hours.ramadan_estimated", { from: props.window.from, to: props.window.to })}
          </span>
        )}
      </div>

      {!on ? (
        // It collapses rather than disappearing: a seller who turned it off
        // should see that they did.
        <p className="mt-3 text-body-sm text-muted">{t("hours.ramadan_off")}</p>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            {GROUPS.map((group) => {
              const shift = shiftOf(props.hours, group.days);
              return (
                <div key={group.key} className="flex items-center gap-2">
                  <span className="min-w-16 text-body-sm text-moss-deep">{t(group.label)}</span>
                  <Input
                    mono
                    size="sm"
                    value={shift.open}
                    aria-label={`${t(group.label)} ${t("hours.open")}`}
                    disabled={props.disabled || props.readOnly}
                    onChange={(event) => setGroup(group.days, { ...shift, open: event.target.value })}
                  />
                  <span aria-hidden="true" className="text-muted">–</span>
                  <Input
                    mono
                    size="sm"
                    value={shift.close}
                    aria-label={`${t(group.label)} ${t("hours.close")}`}
                    disabled={props.disabled || props.readOnly}
                    onChange={(event) => setGroup(group.days, { ...shift, close: event.target.value })}
                  />
                </div>
              );
            })}
          </div>

          {/*
            The carried-over notice, and the only control that clears board 3a's
            card. Criterion 5 is the sentence underneath it: an unconfirmed
            Ramadan is not an unset one, so these times are already in force.
          */}
          {props.needsConfirming && props.window && (
            <Alert
              tone="warn"
              fix={t("hours.ramadan_carried_fix")}
              action={
                props.readOnly ? undefined : (
                  <Button size="sm" variant="secondary" onClick={props.onConfirm} disabled={props.disabled}>
                    {t("hours.ramadan_confirm")}
                  </Button>
                )
              }
            >
              {t("hours.ramadan_carried", { year: String(props.window.year - 1) })}
            </Alert>
          )}

          {!props.needsConfirming && props.confirmedYear !== null && (
            <p className="text-caption text-moss-deep">
              {t("hours.ramadan_confirmed_note", { year: String(props.confirmedYear) })}
            </p>
          )}

          <p className="max-w-prose text-caption text-body">{t("hours.ramadan_dates_promise")}</p>
        </div>
      )}
    </section>
  );
}
