import { EN_DASH, UAE_LOCALE, UAE_TIME_ZONE } from "./locale";
import type { DateInput, ZoneOption } from "./date";

/** `"08:00"`, minutes since midnight, or an instant. */
export type TimeInput = string | number | Date;

export interface Shift {
  open: TimeInput;
  close: TimeInput;
}

const HHMM = /^(\d{1,2}):(\d{2})$/;

function toMinutes(value: TimeInput, timeZone: string): number {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0 || value > 24 * 60) {
      throw new RangeError(`Minutes since midnight must be 0..1440, received: ${value}`);
    }
    return value;
  }
  if (typeof value === "string") {
    const m = HHMM.exec(value.trim());
    if (!m) throw new TypeError(`Expected "HH:MM", received: ${value}`);
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 24 || min > 59) throw new RangeError(`Not a valid time of day: ${value}`);
    return h * 60 + min;
  }
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(value);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const min = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return h * 60 + min;
}

/**
 * `08:00`. Twenty-four hour, always zero-padded.
 *
 * The UAE reads both clocks, but a directory listing trade-counter hours cannot
 * afford `4:00` meaning either end of the working day.
 */
export function formatTime(
  value: TimeInput,
  { timeZone = UAE_TIME_ZONE }: ZoneOption = {},
): string {
  const total = toMinutes(value, timeZone);
  // 24:00 is a legitimate closing time and is not the same statement as 00:00.
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** `08:00–18:00`. En dash, no spaces — it is one value, not two. */
export function formatTimeRange(
  open: TimeInput,
  close: TimeInput,
  { timeZone = UAE_TIME_ZONE }: ZoneOption = {},
): string {
  return `${formatTime(open, { timeZone })}${EN_DASH}${formatTime(close, { timeZone })}`;
}

/**
 * `08:00–13:00, 16:00–20:00`. Split shifts are the norm here, not the exception —
 * most of Al Quoz closes through the middle of the afternoon.
 */
export function formatShifts(
  shifts: readonly Shift[],
  { timeZone = UAE_TIME_ZONE }: ZoneOption = {},
): string {
  if (shifts.length === 0) return "closed";
  return shifts.map((s) => formatTimeRange(s.open, s.close, { timeZone })).join(", ");
}

/** `09:30` for an instant, in the given zone. */
export function formatClock(
  value: DateInput,
  { timeZone = UAE_TIME_ZONE }: ZoneOption = {},
): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw new TypeError(`Expected a valid date, received: ${String(value)}`);
  return new Intl.DateTimeFormat(UAE_LOCALE, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}
