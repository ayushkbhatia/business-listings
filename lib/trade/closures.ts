import {
  DAYS,
  hoursInEffect,
  type Day,
  type RamadanCalendar,
  type RamadanHours,
  type Shift,
  type WeekHours,
} from "./hours";

/**
 * Which of four things decides whether a branch is open today.
 *
 * Board 3d's second correction. `19 MAR 2027` is the last day of Ramadan hours
 * and the first day of the Eid Al Fitr closure, and the board listed both on
 * one screen with no rule between them — so a seller could read their own page
 * and not know what a buyer would be told.
 *
 *     temporary closure  >  holiday  >  Ramadan hours  >  standard week
 *
 * A closure the seller schedules outranks a holiday because it is the more
 * specific and more recent statement of fact: if they say the warehouse is shut
 * for a stock-take, it is shut, and a national holiday underneath it changes
 * nothing about the padlock.
 *
 * Pure, and with no database above it, because three surfaces have to agree
 * about this: the seller's own screen, board 1f's public strip, and the
 * `open now` filter that `1b` and `1c` run. A second implementation of the
 * order is the defect this file exists to make impossible.
 */

/* ── Dubai calendar days ─────────────────────────────────────────────────── */

const DAY_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Dubai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * The Dubai calendar day an instant falls in, as `YYYY-MM-DD`.
 *
 * A holiday is a *date*, not an instant, and every comparison here is between
 * dates on somebody's wall. `Intl` rather than a fixed +04:00 offset, for the
 * reason `lib/verification.ts` gives about the same conversion: the offset is
 * right today, and hard-coding it is how a date library acquires a bug it keeps
 * for a decade.
 *
 * A `@db.Date` column comes back from Prisma as a UTC midnight, which formats
 * to the *previous* day in Dubai — so those are read with `dateKey` below
 * rather than through this.
 */
export function dubaiDateKey(at: Date): string {
  const parts = DAY_PARTS.formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * The calendar day a `DATE` column holds.
 *
 * Postgres hands a bare date back as midnight UTC. Formatting that in Dubai
 * gives the day before, so National Day would begin on the 1st and the whole
 * calendar would sit a day early — which is precisely the sort of wrong that
 * nobody notices until a buyer drives to a closed gate.
 */
export function dateKey(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/* ── What the resolver reads ─────────────────────────────────────────────── */

export interface HolidayWindow {
  id: string;
  name: string;
  startsOn: Date;
  endsOn: Date;
  /** Null both, or both set: the CHECK says so. Set means a half day. */
  openFrom: string | null;
  openUntil: string | null;
  /** False while an Islamic date is still an estimate. */
  confirmed?: boolean;
}

export interface ClosureWindow {
  id: string;
  reason: string;
  startsOn: Date;
  endsOn: Date;
  openFrom: string | null;
  openUntil: string | null;
}

/** The one temporary closure a branch may have, from `Location`'s own columns. */
export interface TemporaryClosure {
  from: Date;
  until: Date;
  reason: string;
}

export interface BranchSchedule {
  hours: WeekHours;
  ramadanHours?: RamadanHours | null;
  /**
   * The platform's window, where the caller has read it.
   *
   * Omitted, the compiled estimates in `hours.ts` apply — which is the same
   * fallback `hoursInEffect` has always had. It is threaded through rather than
   * left to the default because `openNow` already takes a calendar and passes
   * it to `hoursInEffect`: without this the two would ask different calendars
   * inside one call, and a platform correction would move the hours while
   * leaving the ruling on the old dates.
   */
  calendar?: RamadanCalendar;
  temporaryClosure?: TemporaryClosure | null;
  /** Official, national, ours. */
  holidays?: readonly HolidayWindow[];
  /** The seller's own dates, for this branch. */
  closures?: readonly ClosureWindow[];
}

export type DayRuling =
  | { kind: "temporary_closure"; reason: string; until: Date; shifts: [] }
  | {
      kind: "holiday";
      name: string;
      /** Empty is a full closure; one shift is a half day. */
      shifts: Shift[];
      /** True for a date the platform maintains, false for one the seller added. */
      official: boolean;
      /**
       * True when Ramadan hours would otherwise have applied to this day.
       *
       * Criterion 7 wants the collision *said*, not just resolved — the render
       * puts `19 MAR ALSO RAMADAN · CLOSED WINS` on the row where it happens.
       * Computed rather than written down, because the dates move: with the
       * platform's own 2027 window the two do not overlap at all, and a
       * hardcoded marker would have gone on claiming they did.
       */
      alsoRamadan: boolean;
    }
  | { kind: "ramadan"; shifts: Shift[] }
  | { kind: "standard"; shifts: Shift[] };

function covers(window: { startsOn: Date; endsOn: Date }, key: string): boolean {
  return dateKey(window.startsOn) <= key && key <= dateKey(window.endsOn);
}

function halfDayShifts(window: { openFrom: string | null; openUntil: string | null }): Shift[] {
  return window.openFrom && window.openUntil
    ? [{ open: window.openFrom, close: window.openUntil }]
    : [];
}

/**
 * What is in force on one day, and why.
 *
 * The order is the whole function. Each rung is checked before the one below it
 * and returns as soon as it applies, so there is no arithmetic in which two
 * could both be true.
 */
export function rulingFor(at: Date, schedule: BranchSchedule): DayRuling {
  const key = dubaiDateKey(at);

  /* 1 · a closure the seller scheduled. The most specific statement of fact. */
  const temporary = schedule.temporaryClosure;
  if (
    temporary &&
    dateKey(temporary.from) <= key &&
    key <= dateKey(temporary.until)
  ) {
    return { kind: "temporary_closure", reason: temporary.reason, until: temporary.until, shifts: [] };
  }

  /* 2 · a holiday, ours or theirs. */
  const ramadanWeek = hoursInEffect(schedule.hours, schedule.ramadanHours ?? null, at, schedule.calendar);

  const sellerDate = (schedule.closures ?? []).find((window) => covers(window, key));
  if (sellerDate) {
    return {
      kind: "holiday",
      name: sellerDate.reason,
      shifts: halfDayShifts(sellerDate),
      official: false,
      alsoRamadan: ramadanWeek.isRamadan,
    };
  }

  const holiday = (schedule.holidays ?? []).find((window) => covers(window, key));
  if (holiday) {
    return {
      kind: "holiday",
      name: holiday.name,
      shifts: halfDayShifts(holiday),
      official: true,
      alsoRamadan: ramadanWeek.isRamadan,
    };
  }

  /* 3 and 4 · the Ramadan week, or the standard one. `hoursInEffect` already
     owns that choice, including its refusal to let a Ramadan block open a day
     the seller has switched off. */
  const day = weekdayIn(at);
  const shifts = ramadanWeek.hours[day] ?? [];
  return ramadanWeek.isRamadan ? { kind: "ramadan", shifts } : { kind: "standard", shifts };
}

const WEEKDAY = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Dubai",
  weekday: "short",
});

function weekdayIn(at: Date): Day {
  const short = WEEKDAY.format(at).toLowerCase().slice(0, 3) as Day;
  return DAYS.includes(short) ? short : "sun";
}

/**
 * The window a Ramadan confirmation is *for*, and whether it has been given.
 *
 * Board 3d's first correction, as a predicate. `confirmedYear` naming the
 * coming window's year is the only thing that clears board 3a's card — and
 * criterion 5 is the other half: an unconfirmed Ramadan is not an unset one, so
 * this reports on the reminder and never on whether the hours apply.
 */
export function ramadanNeedsConfirming(
  confirmedYear: number | null | undefined,
  ramadanHours: RamadanHours | null | undefined,
  window: { year: number } | null,
): boolean {
  if (!window) return false;
  // A seller who has never stated Ramadan hours is not being reminded to
  // re-confirm hours they do not have. That is board 2d's empty state, and the
  // card would be nagging about a section they chose to leave alone.
  const states =
    ramadanHours !== null &&
    ramadanHours !== undefined &&
    (ramadanHours.all !== undefined || DAYS.some((day) => ramadanHours[day] !== undefined));
  if (!states) return false;
  return confirmedYear !== window.year;
}

/** Criterion 9's default: Friday's midday break, prefilled and removable. */
export const JUMUAH_BREAK = { from: "12:00", to: "14:00" } as const;

/**
 * Whether Friday's shifts leave the Jumu'ah window clear.
 *
 * A description, not a rule. It is not the platform's place to decide that a
 * business closes for prayer, so this reports what the seller has said rather
 * than enforcing it — the editor prefills the split for a new branch and the
 * note appears only while the gap is actually there.
 */
export function keepsJumuah(shifts: readonly Shift[]): boolean {
  if (shifts.length < 2) return false;
  return shifts.some((shift) => shift.close === JUMUAH_BREAK.from)
    && shifts.some((shift) => shift.open === JUMUAH_BREAK.to);
}
