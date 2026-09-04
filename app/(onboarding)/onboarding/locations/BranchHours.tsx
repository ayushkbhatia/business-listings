"use client";

import { useId } from "react";
import { Input, Toggle } from "@/components/primitives";
import { Close, Plus } from "@/components/primitives/icons";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import {
  DAYS,
  minutesOf,
  problemsWith,
  type Day,
  type RamadanHours,
  type Shift,
  type WeekHours,
} from "@/lib/trade/hours";
import { describeProblemText } from "@/lib/trade/hours-copy";

/**
 * Board 2d's hours: four rows, not seven.
 *
 * The dashboard's `HoursEditor` lists every day, which is right for board 3d —
 * that screen is where a supplier goes to change one Thursday. This one is in a
 * funnel, beside a map, and a seller filling it in for the first time thinks in
 * blocks: *we're open Monday to Thursday, half day Friday, Saturday morning,
 * shut Sunday.* Seven rows to say that is five rows of the same two times.
 *
 * So adjacent days that keep identical hours collapse into one row — `Mon – Thu`
 * — and editing the row writes to every day in it. Change Thursday alone and the
 * group splits into `Mon – Wed` and `Thursday` on the next render, which is the
 * seller's own model of their week rather than an editing mode they have to
 * choose.
 *
 * The week runs Monday to Sunday here, which is the one place in this codebase
 * it does. `DAYS` starts on Sunday because the storefront's "open now" walks
 * forward from the Gulf week's first day, and that is a fact about evaluation.
 * This is a fact about reading: Mon–Thu is the block, and putting Sunday above
 * it splits the block in half.
 *
 * Nothing here parses or validates. `lib/trade/hours.ts` owns the shape, the
 * problems and the Ramadan window; two copies of that is how a seller gets told
 * one thing while typing and another on save.
 */

/** Reading order for this screen. The stored object is unordered. */
const WEEK: readonly Day[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const DAY_LABEL: Record<Day, string> = {
  sun: t("storefront.day.sun"),
  mon: t("storefront.day.mon"),
  tue: t("storefront.day.tue"),
  wed: t("storefront.day.wed"),
  thu: t("storefront.day.thu"),
  fri: t("storefront.day.fri"),
  sat: t("storefront.day.sat"),
};

/** `Mon`, for the left side of a range. Full names elsewhere. */
const DAY_SHORT: Record<Day, string> = {
  sun: t("storefront.day_short.sun"),
  mon: t("storefront.day_short.mon"),
  tue: t("storefront.day_short.tue"),
  wed: t("storefront.day_short.wed"),
  thu: t("storefront.day_short.thu"),
  fri: t("storefront.day_short.fri"),
  sat: t("storefront.day_short.sat"),
};

/** The default a re-opened day comes back with, rather than an empty pair. */
const ORDINARY: Shift = { open: "08:00", close: "18:00" };
/** The afternoon half of a split shift, which is the shape it almost always is. */
const AFTERNOON: Shift = { open: "16:00", close: "20:00" };
/** What the Ramadan band says when a seller turns it on. */
export const RAMADAN_BAND: Shift = { open: "09:00", close: "15:00" };

export interface BranchHoursProps {
  hours: WeekHours;
  ramadanHours: RamadanHours | null;
  onChange: (hours: WeekHours) => void;
  onRamadanChange: (hours: RamadanHours | null) => void;
  /** Absent on a business with one branch — there is nowhere to copy to. */
  onCopyToAll?: () => void;
  /** `about 17 February to 19 March`, resolved by the server from the setting. */
  ramadanWindow: { from: string; to: string; active: boolean } | null;
  disabled?: boolean;
}

interface Group {
  days: Day[];
  shifts: Shift[];
  label: string;
}

/** Adjacent days keeping identical hours, as one row each. */
function grouped(hours: WeekHours): Group[] {
  const groups: Group[] = [];

  for (const day of WEEK) {
    const shifts = hours[day] ?? [];
    const last = groups.at(-1);
    if (last && sameShifts(last.shifts, shifts)) {
      last.days.push(day);
      continue;
    }
    groups.push({ days: [day], shifts, label: "" });
  }

  for (const group of groups) {
    const first = group.days[0]!;
    const final = group.days.at(-1)!;
    group.label =
      group.days.length === 1
        ? DAY_LABEL[first]
        : t("locations_step.day_range", { from: DAY_SHORT[first], to: DAY_SHORT[final] });
  }
  return groups;
}

function sameShifts(a: readonly Shift[], b: readonly Shift[]): boolean {
  return (
    a.length === b.length &&
    a.every((shift, index) => shift.open === b[index]?.open && shift.close === b[index]?.close)
  );
}

export function BranchHours({
  hours,
  ramadanHours,
  onChange,
  onRamadanChange,
  onCopyToAll,
  ramadanWindow,
  disabled = false,
}: BranchHoursProps) {
  const headingId = useId();
  const groups = grouped(hours);

  const problems = problemsWith(hours);
  const problemsByDay = new Map<Day, string[]>();
  for (const problem of problems) {
    const list = problemsByDay.get(problem.day) ?? [];
    list.push(describeProblemText(problem));
    problemsByDay.set(problem.day, list);
  }

  /** Write one group's hours to every day in it. */
  function setGroup(days: readonly Day[], shifts: Shift[]) {
    const next: WeekHours = { ...hours };
    for (const day of days) next[day] = shifts;
    onChange(next);
  }

  const ramadanOn = ramadanHours !== null;
  const band = ramadanHours?.all?.[0] ?? RAMADAN_BAND;

  /*
     A `div` with a heading, not a `section` with an accessible name.

     A named `section` is a `region` landmark, and a page with six branches on it
     had six landmarks all called "Opening hours" — `landmark-unique`, and a
     screen-reader user given six identical destinations to choose between. The
     heading gives the structure; the landmark added nothing but the collision.
  */
  return (
    <div className="border-t border-line pt-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id={headingId} className="text-body-sm font-medium text-ink">
          {t("locations_step.hours")}
        </h3>

        {/*
          A quiet link, not a button. It is one click from the row the seller was
          editing and it overwrites other branches, so it should not read as the
          obvious next action — the confirm above it is what carries the weight.
        */}
        {onCopyToAll && (
          <button
            type="button"
            disabled={disabled}
            onClick={onCopyToAll}
            className={cn(
              "inline-flex min-h-11 items-center rounded-tag px-1 sm:min-h-8",
              "text-caption font-medium text-moss underline-offset-2 hover:underline",
              "focus-visible:shadow-focus focus-visible:outline-none",
            )}
          >
            {t("locations_step.copy_all")}
          </button>
        )}
      </div>

      <p className="mt-0.5 text-caption text-muted">{t("locations_step.hours_optional")}</p>

      <ul className="mt-2.5 flex list-none flex-col gap-1.5 p-0">
        {groups.map((group) => {
          const open = group.shifts.length > 0;
          const rowProblems = group.days.flatMap((day) => problemsByDay.get(day) ?? []);

          return (
            <li key={group.days.join("-")} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                <span className="w-[5.5rem] shrink-0">
                  <Toggle
                    checked={open}
                    disabled={disabled}
                    size="sm"
                    label={group.label}
                    onChange={(checked) => setGroup(group.days, checked ? [ORDINARY] : [])}
                  />
                </span>

                {!open ? (
                  <span className="text-body-sm text-muted">{t("hours.closed")}</span>
                ) : (
                  <ShiftFields
                    label={group.label}
                    shift={group.shifts[0]!}
                    disabled={disabled}
                    onChange={(shift) =>
                      setGroup(group.days, [shift, ...group.shifts.slice(1)])
                    }
                  />
                )}

                {/*
                  Split shift is not an edge case in this market — a trade
                  counter shuts at one and opens again at four. Inline on the
                  row, because a seller who cannot say that writes it in the
                  description field where nothing can read it.
                */}
                {open && group.shifts.length < 2 && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setGroup(group.days, [...group.shifts, AFTERNOON])}
                    className={cn(
                      "ms-auto inline-flex min-h-11 items-center gap-1 rounded-tag px-1 sm:min-h-8",
                      "text-caption text-moss underline-offset-2 hover:underline",
                      "focus-visible:shadow-focus focus-visible:outline-none",
                    )}
                  >
                    <Plus size={11} />
                    {t("locations_step.split_shift")}
                  </button>
                )}
              </div>

              {group.shifts.slice(1).map((shift, index) => (
                <div key={index} className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                  <span className="w-[5.5rem] shrink-0" />
                  <ShiftFields
                    label={`${group.label} ${index + 2}`}
                    shift={shift}
                    disabled={disabled}
                    onChange={(next) =>
                      setGroup(
                        group.days,
                        group.shifts.map((current, i) => (i === index + 1 ? next : current)),
                      )
                    }
                  />
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label={`${t("hours.remove_shift")} — ${group.label}`}
                    onClick={() =>
                      setGroup(
                        group.days,
                        group.shifts.filter((_, i) => i !== index + 1),
                      )
                    }
                    className={cn(
                      "inline-flex min-h-11 min-w-11 items-center justify-center rounded-tag",
                      "text-muted hover:text-ink sm:min-h-8 sm:min-w-8",
                      "focus-visible:shadow-focus focus-visible:outline-none",
                    )}
                  >
                    <Close size={12} />
                  </button>
                </div>
              ))}

              {rowProblems.map((problem, index) => (
                <p key={index} role="alert" className="ps-[5.5rem] text-caption text-bad-ink">
                  {problem}
                </p>
              ))}
            </li>
          );
        })}
      </ul>

      {/*
        Ramadan: a toggle and one band, applied automatically on the announced
        dates. Two things about it are not incidental.

        The dates are a platform setting, because Ramadan moves yearly and
        41,000 sellers will not update it — the seller sets hours, never dates.
        And the band applies to every open day, with closed days staying closed:
        a supplier whose Saturday silently ignored Ramadan would be published as
        open when the workshop is shut.
      */}
      <div
        className={cn(
          "mt-3 flex flex-wrap items-start gap-3 rounded-card px-3.5 py-3",
          ramadanOn ? "bg-warn-wash" : "border border-line bg-paper-sunk",
        )}
      >
        <Toggle
          checked={ramadanOn}
          disabled={disabled}
          hideLabel
          size="sm"
          label={t("hours.ramadan_toggle")}
          onChange={(checked) => onRamadanChange(checked ? { all: [RAMADAN_BAND] } : null)}
        />

        <div className="min-w-0 flex-1">
          <p className={cn("text-body-sm font-medium", ramadanOn ? "text-warn-ink" : "text-ink")}>
            {ramadanOn ? t("locations_step.ramadan_on") : t("hours.ramadan_toggle")}
          </p>

          {ramadanOn ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <ShiftFields
                label={t("hours.ramadan")}
                shift={band}
                disabled={disabled}
                onChange={(shift) => onRamadanChange({ all: [shift] })}
              />
              <span className="text-caption text-warn-ink">
                {t("locations_step.ramadan_note")}
              </span>
            </div>
          ) : (
            <p className="mt-0.5 text-caption text-muted">
              {t("hours.ramadan_hint")}
              {ramadanWindow
                ? ` ${t("hours.ramadan_window", { from: ramadanWindow.from, to: ramadanWindow.to })}`
                : ""}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** `08:00` to `18:00`. Mono and tabular, because two times are compared by eye. */
function ShiftFields({
  label,
  shift,
  onChange,
  disabled,
}: {
  label: string;
  shift: Shift;
  onChange: (shift: Shift) => void;
  disabled: boolean;
}) {
  const backwards =
    Number.isFinite(minutesOf(shift.open)) &&
    Number.isFinite(minutesOf(shift.close)) &&
    minutesOf(shift.close) <= minutesOf(shift.open);

  return (
    <>
      <div className="w-[7.5rem]">
        <Input
          size="sm"
          mono
          type="time"
          step={300}
          disabled={disabled}
          invalid={backwards}
          aria-label={`${label} ${t("hours.open")}`}
          value={shift.open}
          onChange={(event) => onChange({ ...shift, open: event.target.value })}
        />
      </div>
      <span aria-hidden="true" className="text-caption text-faint">
        {t("locations_step.to")}
      </span>
      <div className="w-[7.5rem]">
        <Input
          size="sm"
          mono
          type="time"
          step={300}
          disabled={disabled}
          invalid={backwards}
          aria-label={`${label} ${t("hours.close")}`}
          value={shift.close}
          onChange={(event) => onChange({ ...shift, close: event.target.value })}
        />
      </div>
    </>
  );
}

export { DAYS };
