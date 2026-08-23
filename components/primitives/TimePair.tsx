"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";
import { EN_DASH } from "@/lib/format/locale";

/**
 * An open and a close time. The building block the hours editor stacks to make
 * a split shift — most of Al Quoz closes through the middle of the afternoon,
 * so one row is never enough on its own, but one row is what this is.
 *
 * 24-hour, always. The UAE reads both clocks and a trade counter cannot afford
 * "4:00" meaning either end of the working day.
 *
 * A close earlier than its open is flagged here rather than on submit, because
 * it is the one error in this control that is always wrong and never a
 * work-in-progress.
 */
export interface TimePairProps {
  open: string;
  close: string;
  onChange: (value: { open: string; close: string }) => void;
  /** Accessible names. */
  openLabel: string;
  closeLabel: string;
  /** Shown when close is at or before open. Say what correct looks like. */
  orderErrorLabel?: string;
  disabled?: boolean;
  invalid?: boolean;
}

const HHMM = /^([01]\d|2[0-4]):([0-5]\d)$/;

function minutes(value: string): number | null {
  const m = HHMM.exec(value);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function TimePair({
  open,
  close,
  onChange,
  openLabel,
  closeLabel,
  orderErrorLabel,
  disabled = false,
  invalid = false,
}: TimePairProps) {
  const id = useId();
  const a = minutes(open);
  const b = minutes(close);
  const outOfOrder = a !== null && b !== null && b <= a;
  const bad = invalid || outOfOrder;

  const field = cn(
    "h-9 rounded-ctl border bg-card px-2 font-mono text-body-sm tabular-nums text-ink",
    "transition-colors duration-120 ease-out",
    "focus-visible:outline-none",
    bad
      ? "border-bad-line-strong focus:border-bad focus:shadow-focus-danger"
      : "border-line-strong focus:border-moss focus:shadow-focus",
    disabled && "cursor-not-allowed border-line bg-fill text-disabled-text",
  );

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          id={`${id}-open`}
          type="time"
          step={300}
          value={open}
          disabled={disabled}
          aria-label={openLabel}
          aria-invalid={bad || undefined}
          onChange={(event) => onChange({ open: event.target.value, close })}
          className={field}
        />
        <span
          aria-hidden="true"
          className={cn("select-none", disabled ? "text-disabled-text" : "text-faint")}
        >
          {EN_DASH}
        </span>
        <input
          id={`${id}-close`}
          type="time"
          step={300}
          value={close}
          disabled={disabled}
          aria-label={closeLabel}
          aria-invalid={bad || undefined}
          aria-describedby={outOfOrder ? `${id}-error` : undefined}
          onChange={(event) => onChange({ open, close: event.target.value })}
          className={field}
        />
      </div>

      {outOfOrder && orderErrorLabel && (
        <p id={`${id}-error`} role="alert" className="text-caption text-bad-ink">
          {orderErrorLabel}
        </p>
      )}
    </div>
  );
}
