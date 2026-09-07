"use client";

import { useState, useTransition } from "react";
import { Alert, StatusBadge } from "@/components/display";
import { Button, Input, Toggle } from "@/components/primitives";
import { Panel } from "@/components/structure";
import { Close } from "@/components/primitives/icons";
import { t } from "@/lib/i18n";
import type { ClosureActionResult } from "./actions";

/**
 * Board 3d §4 — the holidays rail, and the seventh correction.
 *
 * The board mixed official UAE dates with the seller's own `+ Add date` and
 * distinguished neither, which left an unowned promise in shipped copy. It is
 * the same split board 3e makes between documents we verify and documents the
 * seller uploads: **ours are kept current for them, theirs are theirs to
 * maintain**, and the footer says so.
 *
 * The precedence footer is the other correction. It is stated once here and
 * again on the row where a collision actually is — a seller should not have to
 * derive which of two things listed on one screen wins.
 */

export interface HolidayRow {
  id: string;
  name: string;
  /** Already formatted — a function prop cannot cross into a client component. */
  dates: string;
  official: boolean;
  halfDay: string | null;
  /** Set where this holiday falls inside the Ramadan window. Criterion 7. */
  alsoRamadan: string | null;
  estimated: boolean;
}

export interface HolidayRailProps {
  years: string;
  rows: readonly HolidayRow[];
  locationId: string;
  addAction: (formData: FormData) => Promise<ClosureActionResult>;
  removeAction: (formData: FormData) => Promise<ClosureActionResult>;
  readOnly?: boolean;
}

export function HolidayRail(props: HolidayRailProps) {
  const [adding, setAdding] = useState(false);
  const [half, setHalf] = useState(false);
  const [error, setError] = useState<{ error: string; fix: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    form.set("locationId", props.locationId);
    if (!half) {
      form.delete("openFrom");
      form.delete("openUntil");
    }
    setError(null);
    startTransition(async () => {
      const result = await props.addAction(form);
      if (!result.ok) setError(result);
      else {
        setAdding(false);
        setHalf(false);
      }
    });
  }

  function remove(id: string) {
    const form = new FormData();
    form.set("id", id);
    startTransition(async () => {
      const result = await props.removeAction(form);
      if (!result.ok) setError(result);
    });
  }

  return (
    <Panel
      title={t("hours.holidays_title", { years: props.years })}
      actions={
        props.readOnly ? undefined : (
          <Button size="sm" variant="ghost" onClick={() => setAdding((open) => !open)}>
            {adding ? t("hours.cancel") : t("hours.holidays_add")}
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-3">
        {error && (
          <Alert tone="bad" live="assertive" fix={error.fix}>
            {error.error}
          </Alert>
        )}

        {adding && (
          <form onSubmit={add} className="flex flex-col gap-2 rounded-ctl border border-line bg-paper-sunk p-3">
            <label className="flex flex-col gap-1">
              <span className="text-caption text-ink">{t("hours.add_date_name")}</span>
              <Input name="reason" size="sm" required placeholder={t("hours.add_date_name_hint")} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-caption text-ink">{t("hours.add_date_from")}</span>
                <Input name="startsOn" size="sm" type="date" required />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-caption text-ink">{t("hours.add_date_to")}</span>
                <Input name="endsOn" size="sm" type="date" />
              </label>
            </div>
            {/* Criterion 8: a half day carries its hours or it is a setting
                whose value the seller cannot see. */}
            <Toggle checked={half} label={t("hours.add_date_half")} onChange={setHalf} />
            {half && (
              <div className="grid grid-cols-2 gap-2">
                <Input name="openFrom" size="sm" mono defaultValue="08:00" aria-label={t("hours.open")} />
                <Input name="openUntil" size="sm" mono defaultValue="12:00" aria-label={t("hours.close")} />
              </div>
            )}
            <div>
              <Button type="submit" size="sm" disabled={pending}>
                {t("hours.add_date_save")}
              </Button>
            </div>
          </form>
        )}

        <ul className="flex flex-col divide-y divide-line">
          {props.rows.map((row) => (
            <li key={row.id} className="flex items-start gap-3 py-2.5 first:pt-0">
              <div className="min-w-0 flex-1">
                <p className="text-body-sm font-medium text-ink">{row.name}</p>
                <p className="font-mono text-eyebrow uppercase tracking-wide text-body">
                  {row.dates}
                  {row.halfDay ? ` · ${row.halfDay}` : ""}
                </p>
                {/*
                  Criterion 7, on the row where the collision is. Computed from
                  the platform's own window rather than written down — with the
                  2027 dates as the calendar actually holds them these two do
                  not overlap, and a hardcoded marker would still be claiming
                  they did.
                */}
                {row.alsoRamadan && (
                  <p className="mt-0.5 font-mono text-eyebrow uppercase tracking-wide text-warn-ink">
                    {row.alsoRamadan}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {row.estimated && (
                  <span className="font-mono text-eyebrow uppercase tracking-wide text-muted">
                    {t("hours.holiday_estimated")}
                  </span>
                )}
                <StatusBadge tone={row.halfDay ? "warn" : "neutral"} shape="chip">
                  {row.halfDay ? t("hours.holiday_half") : t("hours.holiday_closed")}
                </StatusBadge>
                {!row.official && !props.readOnly && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => remove(row.id)}
                    aria-label={t("hours.holiday_remove", { name: row.name })}
                    className="rounded-pill p-0.5 text-muted hover:text-ink focus-visible:shadow-focus focus-visible:outline-none disabled:cursor-not-allowed"
                  >
                    <Close className="size-3.5" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-1.5 border-t border-line pt-3 text-caption text-body">
          <p>{t("hours.precedence")}</p>
          <p>{t("hours.holiday_ownership")}</p>
        </div>
      </div>
    </Panel>
  );
}
