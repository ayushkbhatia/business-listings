"use client";

import { useId, useState } from "react";
import {
  Button,
  IconButton,
  Input,
  Select,
  Toggle,
} from "@/components/primitives";
import { Close, Plus } from "@/components/primitives/icons";
import { StatusBadge } from "@/components/display/StatusBadge";
import { cn } from "@/lib/cn";
import {
  DAYS,
  everyDay,
  problemsWith,
  type Day,
  type RamadanHours,
  type Shift,
  type WeekHours,
} from "@/lib/trade/hours";

/**
 * HoursEditor — tier 4.
 *
 * The README: "per-day toggle and time pair, split shifts, copy-to-all-branches,
 * public holidays, Ramadan block with automatic dates."
 *
 * Three things about this are not incidental, and each is a decision the design
 * makes rather than a constraint of the data:
 *
 *   1. **The week starts on Sunday.** A Monday-first editor puts the Gulf
 *      weekend in the middle of the list, and a supplier scanning for Friday
 *      finds it in the wrong place.
 *   2. **Split shifts are a first-class row, not an "advanced" toggle.** A
 *      trade counter opens at eight, shuts at one for the afternoon and opens
 *      again at four. An editor that can only hold one pair per day pushes that
 *      supplier into writing their hours in the description, where nothing can
 *      read them.
 *   3. **Ramadan is a whole separate week with its own dates.** It applies for
 *      about a month and reverts on its own. A supplier who has to remember to
 *      switch will remember in week three.
 *
 * Labels are resolved by the caller passing plain strings, and every function
 * this needs it builds itself. See tests/unit/client-labels.test.ts.
 */

export interface HoursEditorProps {
  hours: WeekHours;
  ramadanHours?: RamadanHours | null;
  onChange: (hours: WeekHours) => void;
  onRamadanChange?: (hours: RamadanHours | null) => void;

  /** Required: names the group of controls. */
  label: string;
  dayLabels: Record<Day, string>;
  openLabel: string;
  closeLabel: string;
  closedLabel: string;
  addShiftLabel: string;
  removeShiftLabel: string;
  copyAllLabel: string;

  publicHolidaysLabel: string;
  publicHolidayOptions: { value: string; label: string }[];

  ramadanLabel: string;
  ramadanHint: string;
  /** "17 February to 19 March 2026, approximately", already formatted. */
  ramadanWindowLabel?: string;
  ramadanActiveLabel?: string;
  ramadanOnLabel: string;

  /** Rendered under the grid when a shift does not make sense. */
  problemLabel?: (problem: ReturnType<typeof problemsWith>[number]) => string;

  /** Shown only where the business has more than one branch. */
  onCopyToAll?: () => void;
  disabled?: boolean;
}

export function HoursEditor({
  hours,
  ramadanHours,
  onChange,
  onRamadanChange,
  label,
  dayLabels,
  openLabel,
  closeLabel,
  closedLabel,
  addShiftLabel,
  removeShiftLabel,
  copyAllLabel,
  publicHolidaysLabel,
  publicHolidayOptions,
  ramadanLabel,
  ramadanHint,
  ramadanWindowLabel,
  ramadanActiveLabel,
  ramadanOnLabel,
  problemLabel,
  onCopyToAll,
  disabled = false,
}: HoursEditorProps) {
  const groupId = useId();
  const [ramadanOn, setRamadanOn] = useState(Boolean(ramadanHours));

  const problems = problemsWith(hours);
  const problemsByDay = new Map<Day, string[]>();
  if (problemLabel) {
    for (const problem of problems) {
      const list = problemsByDay.get(problem.day) ?? [];
      list.push(problemLabel(problem));
      problemsByDay.set(problem.day, list);
    }
  }

  function setDay(day: Day, shifts: Shift[]) {
    onChange({ ...hours, [day]: shifts });
  }

  function toggleDay(day: Day, open: boolean) {
    // Re-opening a day restores the ordinary trading day rather than an empty
    // pair — a supplier who ticks Saturday means "we are open", and typing
    // 08:00 and 17:00 again is work they already did on Sunday.
    setDay(day, open ? [{ open: "08:00", close: "17:00" }] : []);
  }

  return (
    <fieldset
      className="min-w-0 border-0 p-0"
      aria-describedby={`${groupId}-note`}
    >
      <legend className="sr-only">{label}</legend>

      <div className="flex flex-col divide-y divide-line rounded-card border border-line bg-card">
        {DAYS.map((day) => {
          const shifts = hours[day] ?? [];
          const isOpen = shifts.length > 0;
          const dayProblems = problemsByDay.get(day) ?? [];

          return (
            <div
              key={day}
              className="flex flex-wrap items-start gap-3 px-3 py-2.5"
            >
              <div className="flex w-36 shrink-0 items-center gap-2 pt-1">
                <Toggle
                  checked={isOpen}
                  disabled={disabled}
                  size="sm"
                  label={dayLabels[day]}
                  onChange={(checked) => toggleDay(day, checked)}
                />
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {!isOpen && (
                  <span className="pt-1 text-body-sm text-muted">
                    {closedLabel}
                  </span>
                )}

                {shifts.map((shift, index) => (
                  <div
                    key={index}
                    className="flex flex-wrap items-center gap-2"
                  >
                    {/*
                      A fixed width on a wrapper, because Input deliberately
                      takes no className. Left to stretch, the open and close
                      fields fill the row and stack, which reads as two separate
                      questions rather than one time range.
                    */}
                    <div className="w-32">
                      <Input
                        size="sm"
                        mono
                        type="time"
                        disabled={disabled}
                        aria-label={`${dayLabels[day]} ${openLabel}${index > 0 ? ` ${index + 1}` : ""}`}
                        value={shift.open}
                        onChange={(e) =>
                          setDay(
                            day,
                            shifts.map((s, i) =>
                              i === index ? { ...s, open: e.target.value } : s,
                            ),
                          )
                        }
                      />
                    </div>
                    <span
                      aria-hidden="true"
                      className="text-caption text-faint"
                    >
                      –
                    </span>
                    <div className="w-32">
                      <Input
                        size="sm"
                        mono
                        type="time"
                        disabled={disabled}
                        aria-label={`${dayLabels[day]} ${closeLabel}${index > 0 ? ` ${index + 1}` : ""}`}
                        value={shift.close}
                        onChange={(e) =>
                          setDay(
                            day,
                            shifts.map((s, i) =>
                              i === index ? { ...s, close: e.target.value } : s,
                            ),
                          )
                        }
                      />
                    </div>
                    {shifts.length > 1 && (
                      <IconButton
                        label={`${removeShiftLabel} — ${dayLabels[day]}`}
                        icon={<Close size={14} />}
                        size="sm"
                        variant="ghost"
                        disabled={disabled}
                        onClick={() =>
                          setDay(
                            day,
                            shifts.filter((_, i) => i !== index),
                          )
                        }
                      />
                    )}
                  </div>
                ))}

                {isOpen && shifts.length < 3 && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() =>
                      setDay(day, [
                        ...shifts,
                        { open: "16:00", close: "20:00" },
                      ])
                    }
                    className={cn(
                      "inline-flex w-fit items-center gap-1 rounded-tag px-1 py-0.5",
                      "text-caption text-moss underline-offset-2 hover:underline",
                      "focus-visible:shadow-focus focus-visible:outline-none",
                    )}
                  >
                    <Plus size={12} />
                    {addShiftLabel}
                  </button>
                )}

                {dayProblems.map((problem, i) => (
                  <p key={i} role="alert" className="text-caption text-bad-ink">
                    {problem}
                  </p>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-body-sm text-ink">{publicHolidaysLabel}</span>
          <Select
            size="sm"
            disabled={disabled}
            value={hours.publicHolidays ?? "closed"}
            options={publicHolidayOptions}
            onChange={(e) =>
              onChange({
                ...hours,
                publicHolidays: e.target.value as WeekHours["publicHolidays"],
              })
            }
          />
        </label>

        {onCopyToAll && (
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled}
            onClick={onCopyToAll}
          >
            {copyAllLabel}
          </Button>
        )}
      </div>

      {onRamadanChange && (
        <div className="mt-4 rounded-card border border-line bg-paper-sunk p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-body-sm text-ink">{ramadanLabel}</span>
                {ramadanActiveLabel && (
                  <StatusBadge tone="ok" shape="chip" size="sm">
                    {ramadanActiveLabel}
                  </StatusBadge>
                )}
              </div>
              <p
                id={`${groupId}-note`}
                className="mt-0.5 max-w-prose text-caption text-muted"
              >
                {ramadanHint}
                {ramadanWindowLabel ? ` ${ramadanWindowLabel}` : ""}
              </p>
            </div>
            <Toggle
              checked={ramadanOn}
              disabled={disabled}
              hideLabel
              label={ramadanOnLabel}
              onChange={(checked) => {
                setRamadanOn(checked);
                onRamadanChange(
                  checked
                    ? (ramadanHours ?? {
                        all: [{ open: "09:00", close: "15:00" }],
                      })
                    : null,
                );
              }}
            />
          </div>

          {ramadanOn && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <div className="w-32">
                <Input
                  size="sm"
                  mono
                  type="time"
                  disabled={disabled}
                  aria-label={`${ramadanLabel} ${openLabel}`}
                  value={ramadanHours?.all?.[0]?.open ?? "09:00"}
                  onChange={(e) =>
                    onRamadanChange({
                      all: [
                        {
                          open: e.target.value,
                          close: ramadanHours?.all?.[0]?.close ?? "15:00",
                        },
                      ],
                    })
                  }
                />
              </div>
              <span aria-hidden="true" className="text-caption text-faint">
                –
              </span>
              <div className="w-32">
                <Input
                  size="sm"
                  mono
                  type="time"
                  disabled={disabled}
                  aria-label={`${ramadanLabel} ${closeLabel}`}
                  value={ramadanHours?.all?.[0]?.close ?? "15:00"}
                  onChange={(e) =>
                    onRamadanChange({
                      all: [
                        {
                          open: ramadanHours?.all?.[0]?.open ?? "09:00",
                          close: e.target.value,
                        },
                      ],
                    })
                  }
                />
              </div>
            </div>
          )}
        </div>
      )}
    </fieldset>
  );
}

/** Every day the same, for the copy-to-all-branches control. */
export { everyDay };
