import { EN_DASH, UAE_LOCALE, UAE_TIME_ZONE } from "./locale";

export type DateInput = Date | string | number;

export interface ZoneOption {
  /** Defaults to Asia/Dubai. Pass a zone only when rendering for a known other one. */
  timeZone?: string;
}

function toDate(value: DateInput): Date {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new TypeError(`Expected a valid date, received: ${String(value)}`);
  }
  return d;
}

/** `14 Aug 2026`. */
export function formatDate(value: DateInput, { timeZone = UAE_TIME_ZONE }: ZoneOption = {}): string {
  return new Intl.DateTimeFormat(UAE_LOCALE, {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(toDate(value));
}

/**
 * `Mar 2027`. A month and a year, deliberately without the day.
 *
 * Board 1d asks for certificate validity to the month, and the reason is worth
 * keeping: a precise expiry date makes the page look wrong for the twenty-four
 * hours either side of it, and "valid until March 2027" is the fact a buyer is
 * actually using. Precision nobody needs is precision that can be wrong.
 */
export function formatMonth(
  value: DateInput,
  { timeZone = UAE_TIME_ZONE }: ZoneOption = {},
): string {
  return new Intl.DateTimeFormat(UAE_LOCALE, {
    timeZone,
    month: "short",
    year: "numeric",
  }).format(toDate(value));
}

/** `14 Aug`. Same year is implied; use it only where the year is already on screen. */
export function formatDateShort(
  value: DateInput,
  { timeZone = UAE_TIME_ZONE }: ZoneOption = {},
): string {
  return new Intl.DateTimeFormat(UAE_LOCALE, {
    timeZone,
    day: "numeric",
    month: "short",
  }).format(toDate(value));
}

/** `14 Aug 2026, 09:30`. Audit rows and timestamps. */
export function formatDateTime(
  value: DateInput,
  { timeZone = UAE_TIME_ZONE }: ZoneOption = {},
): string {
  return new Intl.DateTimeFormat(UAE_LOCALE, {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(toDate(value));
}

/** `14 Aug – 18 Aug 2026`, collapsing the year and month where they repeat. */
export function formatDateRange(
  from: DateInput,
  to: DateInput,
  { timeZone = UAE_TIME_ZONE }: ZoneOption = {},
): string {
  const a = toDate(from);
  const b = toDate(to);
  const parts = (d: Date) =>
    new Intl.DateTimeFormat(UAE_LOCALE, {
      timeZone,
      day: "numeric",
      month: "short",
      year: "numeric",
    })
      .formatToParts(d)
      .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});

  const pa = parts(a);
  const pb = parts(b);

  if (pa.year === pb.year && pa.month === pb.month && pa.day === pb.day) {
    return formatDate(a, { timeZone });
  }
  if (pa.year === pb.year && pa.month === pb.month) {
    return `${pa.day}${EN_DASH}${pb.day} ${pb.month} ${pb.year}`;
  }
  if (pa.year === pb.year) {
    return `${pa.day} ${pa.month} ${EN_DASH} ${pb.day} ${pb.month} ${pb.year}`;
  }
  return `${formatDate(a, { timeZone })} ${EN_DASH} ${formatDate(b, { timeZone })}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Past this many days `formatRelative` stops counting and prints the date.
 * Exported because a caller that wraps the result in its own sentence needs to
 * know which sentence to use — "closes in 6 d" and "closes 7 Sep 2026" are not
 * the same phrase with a substitution.
 */
export const RELATIVE_WINDOW_DAYS = 7;

export interface RelativeOptions extends ZoneOption {
  /** Injected so the ladder is testable. Defaults to the current time. */
  now?: DateInput;
  /** Past this many days the ladder gives up and shows the date. */
  absoluteAfterDays?: number;
}

/**
 * `now` → `4 min ago` → `2 h ago` → `2 d 4 h ago` → `14 Aug 2026`.
 *
 * Response time is the number sellers are judged on, so the ladder stays coarse
 * on purpose: `2 h ago` and not `2 h 14 min ago`. Two units is the ceiling.
 * Future instants (an enquiry closing, a subscription renewing) mirror the same
 * ladder with `in`.
 */
export function formatRelative(value: DateInput, options: RelativeOptions = {}): string {
  const { now, timeZone = UAE_TIME_ZONE, absoluteAfterDays = 7 } = options;
  const then = toDate(value);
  const reference = now === undefined ? new Date() : toDate(now);
  const deltaMs = then.getTime() - reference.getTime();
  const abs = Math.abs(deltaMs);
  const future = deltaMs > 0;

  if (abs >= absoluteAfterDays * DAY) return formatDate(then, { timeZone });
  if (abs < MINUTE) return "now";

  const wrap = (body: string) => (future ? `in ${body}` : `${body} ago`);

  if (abs < HOUR) return wrap(`${Math.floor(abs / MINUTE)} min`);

  if (abs < DAY) {
    const h = Math.floor(abs / HOUR);
    const m = Math.floor((abs % HOUR) / MINUTE);
    return wrap(m === 0 ? `${h} h` : `${h} h ${m} min`);
  }

  const d = Math.floor(abs / DAY);
  const h = Math.floor((abs % DAY) / HOUR);
  return wrap(h === 0 ? `${d} d` : `${d} d ${h} h`);
}

/**
 * Will `formatRelative` return a countdown rather than a date?
 *
 * Callers use this to pick between "Closes in {duration}" and "Closes {date}".
 * Reading the answer off the same threshold means the two can never disagree.
 */
export function isWithinRelativeWindow(
  value: DateInput,
  { now, absoluteAfterDays = RELATIVE_WINDOW_DAYS }: RelativeOptions = {},
): boolean {
  const then = toDate(value);
  const reference = now === undefined ? new Date() : toDate(now);
  return Math.abs(then.getTime() - reference.getTime()) < absoluteAfterDays * DAY;
}

/**
 * The countdown alone: `6 d 4 h`, with no `in` and no `ago`.
 *
 * For a caller writing its own sentence around it. Only meaningful when
 * `isWithinRelativeWindow` is true.
 */
export function formatCountdown(value: DateInput, options: RelativeOptions = {}): string {
  return formatRelative(value, options).replace(/^in /, "").replace(/ ago$/, "");
}

/** `2 d 4 h` from a duration in milliseconds. Median response time, SLA copy. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new TypeError(`formatDuration expects a non-negative number of milliseconds, received: ${String(ms)}`);
  }
  if (ms < MINUTE) return "under a minute";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min`;
  if (ms < DAY) {
    const h = Math.floor(ms / HOUR);
    const m = Math.floor((ms % HOUR) / MINUTE);
    return m === 0 ? `${h} h` : `${h} h ${m} min`;
  }
  const d = Math.floor(ms / DAY);
  const h = Math.floor((ms % DAY) / HOUR);
  return h === 0 ? `${d} d` : `${d} d ${h} h`;
}
