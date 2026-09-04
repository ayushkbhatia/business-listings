/**
 * Trading hours, as they are actually kept in the Gulf.
 *
 * `Location.hours` is Json and has had a shape since the seed was written —
 * `{ sun: [{ open, close }, ...], ..., sat: [] }` — read in exactly one place
 * on the storefront. This module is that shape given a name, a validator and a
 * week that starts on Sunday, so the editor writes what the storefront already
 * reads rather than a second dialect of the same thing.
 *
 * Two things are not incidental:
 *
 *   - Split shifts are the norm, not an edge case. A trade counter in Sharjah
 *     opens at eight, closes at one for the afternoon, and opens again at four.
 *     An editor with one open and one close per day cannot describe that, and
 *     a supplier who cannot describe their hours writes them in the description
 *     field instead, where nothing can read them.
 *   - Ramadan hours are a whole separate week, not a modifier. They apply for
 *     about a month and revert on their own.
 */

/** The week starts on Sunday. The working week is Monday to Friday elsewhere. */
export const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Day = (typeof DAYS)[number];

export interface Shift {
  /** "08:00", 24-hour. */
  open: string;
  close: string;
}

/** A day with no shifts is closed. An absent day is also closed. */
export type WeekHours = Partial<Record<Day, Shift[]>> & {
  /**
   * What the supplier does on a public holiday.
   *
   * Deliberately a statement of practice rather than a calendar. The UAE's
   * public holidays include Eid, whose dates move with the moon and are
   * announced by the government weeks out — a table of them here would be
   * wrong within a year and would be wrong silently. What a buyer needs to know
   * is whether this supplier trades on them at all, and the supplier is the
   * authority on that.
   *
   * Stored alongside the days because the storefront reads this object by day
   * key and ignores anything else in it.
   */
  publicHolidays?: "closed" | "reduced" | "normal";
};

/**
 * Ramadan hours apply to every day the same way far more often than not, so the
 * shape the seed already uses — `{ all: [...] }` — is kept, with per-day
 * overrides possible alongside it.
 */
export interface RamadanHours extends WeekHours {
  all?: Shift[];
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isTime(value: string): boolean {
  return TIME.test(value);
}

/** Minutes since midnight, for comparing two times without parsing dates. */
export function minutesOf(time: string): number {
  const match = TIME.exec(time);
  if (!match) return Number.NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

export type HoursProblem =
  | { day: Day; kind: "bad_time"; value: string }
  | { day: Day; kind: "backwards"; open: string; close: string }
  | { day: Day; kind: "overlap"; first: Shift; second: Shift };

/**
 * What is wrong, in terms a seller can act on.
 *
 * Overlap is checked because two shifts that overlap are almost always a
 * mistyped afternoon — "16:00–20:00" entered as "06:00–20:00" — and silently
 * merging them would publish hours the supplier does not keep.
 *
 * A close before an open is not treated as crossing midnight. A supplier who
 * genuinely trades through midnight is rare enough that guessing wrong for the
 * common case is the worse trade; they enter two shifts instead.
 */
export function problemsWith(hours: WeekHours): HoursProblem[] {
  const problems: HoursProblem[] = [];

  for (const day of DAYS) {
    const shifts = hours[day] ?? [];
    for (const shift of shifts) {
      if (!isTime(shift.open)) problems.push({ day, kind: "bad_time", value: shift.open });
      if (!isTime(shift.close)) problems.push({ day, kind: "bad_time", value: shift.close });
      if (isTime(shift.open) && isTime(shift.close) && minutesOf(shift.close) <= minutesOf(shift.open)) {
        problems.push({ day, kind: "backwards", open: shift.open, close: shift.close });
      }
    }

    const ordered = [...shifts]
      .filter((s) => isTime(s.open) && isTime(s.close))
      .sort((a, b) => minutesOf(a.open) - minutesOf(b.open));
    for (let i = 1; i < ordered.length; i += 1) {
      const previous = ordered[i - 1]!;
      const current = ordered[i]!;
      if (minutesOf(current.open) < minutesOf(previous.close)) {
        problems.push({ day, kind: "overlap", first: previous, second: current });
      }
    }
  }

  return problems;
}

/** Drop empty rows and sort each day, so two identical weeks compare equal. */
export function normalise(hours: WeekHours): WeekHours {
  const out: WeekHours = {};
  if (hours.publicHolidays) out.publicHolidays = hours.publicHolidays;
  for (const day of DAYS) {
    const shifts = (hours[day] ?? [])
      .filter((s) => s.open.trim() !== "" && s.close.trim() !== "")
      .map((s) => ({ open: s.open.trim(), close: s.close.trim() }))
      .sort((a, b) => minutesOf(a.open) - minutesOf(b.open));
    out[day] = shifts;
  }
  return out;
}

/** Every day the same. What copy-to-all-branches and the Ramadan block use. */
export function everyDay(shifts: Shift[]): WeekHours {
  return Object.fromEntries(DAYS.map((day) => [day, shifts])) as WeekHours;
}

export function isClosedAllWeek(hours: WeekHours): boolean {
  return DAYS.every((day) => (hours[day] ?? []).length === 0);
}

/**
 * Ramadan, as Gregorian dates.
 *
 * Ramadan is lunar and its start depends on a moon sighting announced a day or
 * two beforehand, so it cannot be computed to the day in advance and this does
 * not pretend to. The dates below are the astronomical estimates published for
 * the UAE; they are right to within a day at each end, which is close enough to
 * switch a supplier's hours over automatically and not close enough to publish
 * as fact. `ramadanFor` returns null past the table rather than extrapolating.
 *
 * Sourced per Hijri year. Extend it rather than computing it.
 *
 * **This is the fallback, not the source.** Board 2d, criterion 15: the dates
 * come from a platform setting, so `platform_setting.ramadan_dates` is what a
 * running system reads and `lib/trade/ramadan-calendar.ts` is what reads it.
 * A year the table below has not been extended to is a year the platform can
 * correct without a deploy — which is the whole reason the setting exists, given
 * that the calendar moves annually and 41,000 sellers will not update it.
 *
 * Kept compiled as well so that every function here stays pure and callable
 * without a database, and so a missing or malformed row degrades to the last
 * known-good estimates rather than taking a storefront's hours down.
 */
export type RamadanCalendar = Record<number, { from: string; to: string }>;

const RAMADAN: RamadanCalendar = {
  2026: { from: "2026-02-17", to: "2026-03-19" },
  2027: { from: "2027-02-07", to: "2027-03-08" },
  2028: { from: "2028-01-27", to: "2028-02-25" },
  2029: { from: "2029-01-15", to: "2029-02-13" },
  2030: { from: "2030-01-05", to: "2030-02-03" },
  2031: { from: "2031-12-15", to: "2032-01-13" },
};

/** The compiled estimates, for the module that merges the platform setting over them. */
export const FALLBACK_RAMADAN: RamadanCalendar = RAMADAN;

/**
 * The `platform_setting` row the dates are read from.
 *
 * Here rather than in `ramadan-calendar.ts` because that module imports
 * `server-only`, and `prisma/seed.mts` needs both the key and the fallback to
 * put the row back after its truncate. Re-exported there, so the reader still
 * has it beside the code that uses it.
 */
export const RAMADAN_SETTING_KEY = "ramadan_dates";

export interface RamadanWindow {
  year: number;
  from: Date;
  to: Date;
  /** True when `now` falls inside it. */
  active: boolean;
  /** The estimate is a day either side; the UI says so rather than implying precision. */
  approximate: true;
}

export function ramadanFor(
  year: number,
  now = new Date(),
  calendar: RamadanCalendar = RAMADAN,
): RamadanWindow | null {
  const entry = calendar[year];
  if (!entry) return null;

  const from = new Date(`${entry.from}T00:00:00Z`);
  const to = new Date(`${entry.to}T23:59:59Z`);
  return {
    year,
    from,
    to,
    active: now >= from && now <= to,
    approximate: true,
  };
}

/** The window covering or next following `now`, or null past the table. */
export function nextRamadan(
  now = new Date(),
  calendar: RamadanCalendar = RAMADAN,
): RamadanWindow | null {
  const years = Object.keys(calendar)
    .map(Number)
    .sort((a, b) => a - b);
  for (const year of years) {
    const window = ramadanFor(year, now, calendar);
    if (window && (window.active || window.to >= now)) return window;
  }
  return null;
}

/**
 * Which week applies today. The switch is automatic, which is the whole point.
 *
 * ## The band never opens a shut day
 *
 * Board 2d, criterion 14: *"The Ramadan band applies to every open day and never
 * opens a day that is switched off."* The first version of this spread `all`
 * across all seven days with `everyDay`, which meant a workshop closed on Sunday
 * was published as open 09:00–15:00 every Sunday of Ramadan — a locked gate with
 * the storefront's blessing, and the exact failure the "measured, never claimed"
 * rule exists to prevent.
 *
 * So the Ramadan week is the normal week's **open days**, re-timed. A day with no
 * ordinary shifts has no Ramadan shifts either, whether the seller stated the
 * band or a per-day override: a supplier who wants Saturday open in Ramadan
 * opens Saturday, which is a sentence the editor can already say. Erring the
 * other way would have the page claim a business is open when it is shut, and
 * that is the more expensive of the two mistakes by a distance — a buyer drives
 * to Al Quoz for it.
 */
export function hoursInEffect(
  hours: WeekHours,
  ramadan: RamadanHours | null,
  now = new Date(),
  calendar: RamadanCalendar = RAMADAN,
): { hours: WeekHours; isRamadan: boolean } {
  const window = nextRamadan(now, calendar);
  if (!window?.active || !ramadan) return { hours, isRamadan: false };

  /*
     A block that states nothing is a seller who opened the section and left,
     not a seller who keeps their ordinary hours through Ramadan. Checked before
     the week is built rather than after: since the band now falls back to the
     ordinary day, an empty block produces a week identical to the normal one,
     which `isClosedAllWeek` cannot tell from a real Ramadan week and which would
     otherwise put a "Ramadan hours" badge over hours nobody changed.
  */
  const states = ramadan.all !== undefined || DAYS.some((day) => ramadan[day] !== undefined);
  if (!states) return { hours, isRamadan: false };

  const week: WeekHours = {};
  if (hours.publicHolidays) week.publicHolidays = hours.publicHolidays;

  for (const day of DAYS) {
    // Closed in the ordinary week means closed, and no Ramadan value reopens it.
    if ((hours[day] ?? []).length === 0) {
      week[day] = [];
      continue;
    }
    week[day] = ramadan[day] ?? ramadan.all ?? hours[day] ?? [];
  }

  // A Ramadan block with nothing in it is not a reason to close the business.
  if (isClosedAllWeek(week)) return { hours, isRamadan: false };
  return { hours: week, isRamadan: true };
}
