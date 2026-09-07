import {
  DAYS,
  hoursInEffect,
  minutesOf,
  type Day,
  type RamadanCalendar,
  type RamadanHours,
  type Shift,
  type WeekHours,
} from "./hours";
import { rulingFor, type BranchSchedule, type DayRuling } from "./closures";

/**
 * Whether a counter is open at this moment, in the only timezone that matters.
 *
 * Board 1d criterion 7: *"'Open now' must evaluate in Asia/Dubai regardless of
 * visitor timezone, and honour the Ramadan override window."*
 *
 * ## Why the timezone is not the server's
 *
 * The obvious implementation reads `new Date().getHours()` and is wrong in a
 * way nobody notices in testing: the answer is correct for a buyer in Dubai,
 * correct for a developer in Dubai, and wrong for the Vercel region the page
 * actually renders in. A supplier in Al Quoz is open from eight in the morning
 * *there*, and that is true whether the reader is in London, the renderer is in
 * Frankfurt, or the machine's clock is set to UTC.
 *
 * So the wall clock is derived through `Intl.DateTimeFormat` with an explicit
 * zone rather than from the host. That is the same decision `lib/format/date.ts`
 * already made for rendering dates.
 *
 * ## What it will not claim
 *
 * A supplier with no hours on file is `unknown`, never `closed`. Absent data is
 * not evidence of a shut door, and a storefront that says "Closed" about a
 * business that never told us its hours is inventing a fact against them —
 * the same rule the map runs on for a location with no coordinates.
 */

const ZONE = "Asia/Dubai";

/** The weekday and minute-of-day in Dubai, whatever the host clock says. */
export function dubaiNow(now = new Date()): { day: Day; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: ZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = get("weekday").toLowerCase().slice(0, 3) as Day;
  // `hour12: false` yields 24 for midnight in some ICU versions rather than 00.
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));

  return {
    day: DAYS.includes(weekday) ? weekday : "sun",
    minutes: hour * 60 + minute,
  };
}

export type OpenState =
  | { state: "open"; until: string; isRamadan: boolean }
  | {
      state: "closed";
      opensAt?: string;
      opensDay?: Day;
      isRamadan: boolean;
      /**
       * Why, when it is not simply the standard week.
       *
       * Board 3d criterion 6 makes the order real; this is what lets a surface
       * *say* which rung applied. `1f` prints "Closed for Eid Al Fitr" rather
       * than "Closed", which is the difference between a buyer waiting until
       * tomorrow and a buyer ringing to ask.
       */
      because?: { kind: "temporary_closure" | "holiday"; name: string };
    }
  | { state: "unknown" };

function shiftsFor(week: WeekHours, day: Day): Shift[] {
  return week[day] ?? [];
}

/** Is there any shift on any day? An empty week is "unknown", not "closed". */
function hasAnyHours(week: WeekHours): boolean {
  return DAYS.some((day) => shiftsFor(week, day).length > 0);
}

/** How far ahead "opens 08:00" is willing to look. */
const LOOKAHEAD_DAYS = 7;
const DAY_MS = 86_400_000;

/**
 * Open, closed, or unknown — with the time that matters attached.
 *
 * `until` is the close of the shift currently running, so the surface can say
 * "Open until 18:00" rather than only "Open". `opensAt` is the mirror: "Closed ·
 * opens 08:00". Both are the strings the seller typed, not reformatted, because
 * a supplier who wrote 08:00 means 08:00.
 *
 * ## The fifth argument
 *
 * Board 3d criterion 6 puts three more things above the standard week —
 * a temporary closure, a holiday, and the Ramadan block — in that order.
 * `rulingFor` owns the order; this function asks it, once for today and again
 * for each day it looks ahead to.
 *
 * Optional, so the eight existing callers keep the behaviour they had until
 * each is given the rows to pass. That is a real state and not a shim: a
 * caller that has not loaded a branch's closures genuinely does not know about
 * them, and answering as though there were none is better than refusing to
 * answer at all. Every caller that renders `open now` to a buyer passes them.
 */
export function openNow(
  hours: WeekHours | null | undefined,
  ramadan: RamadanHours | null | undefined,
  now = new Date(),
  /** The platform's calendar. Omitted, the compiled estimates apply. */
  calendar?: RamadanCalendar,
  /** The three rungs above the standard week. Omitted, only Ramadan applies. */
  overrides?: Pick<BranchSchedule, "temporaryClosure" | "holidays" | "closures">,
): OpenState {
  if (!hours || !hasAnyHours(hours)) return { state: "unknown" };

  /*
     The Ramadan switch is automatic, and that is the point of it — a seller who
     set reduced hours in March should not have to remember to turn them on.
     `hoursInEffect` owns the decision, including refusing to apply a Ramadan
     block that would close the business all week.
  */
  const { hours: week, isRamadan } = hoursInEffect(hours, ramadan ?? null, now, calendar);
  if (!hasAnyHours(week)) return { state: "unknown" };

  const schedule: BranchSchedule = { hours, ramadanHours: ramadan ?? null, calendar, ...overrides };
  const today = rulingFor(now, schedule);
  const { day, minutes } = dubaiNow(now);

  for (const shift of today.shifts) {
    const open = minutesOf(shift.open);
    const close = minutesOf(shift.close);
    /*
       A shift whose close is at or before its open crosses midnight. Rare on a
       trade counter and not rare on a 24-hour depot, and reading it as a
       zero-length shift would report a business closed while its gate is up.
    */
    const overnight = close <= open;
    const inside = overnight
      ? minutes >= open || minutes < close
      : minutes >= open && minutes < close;

    if (inside) return { state: "open", until: shift.close, isRamadan };
  }

  const because = reasonOf(today);
  const next = nextOpeningWith(now, minutes, day, schedule);
  return next
    ? { state: "closed", opensAt: next.opensAt, opensDay: next.opensDay, isRamadan, ...(because ? { because } : {}) }
    : { state: "closed", isRamadan, ...(because ? { because } : {}) };
}

function reasonOf(ruling: DayRuling): { kind: "temporary_closure" | "holiday"; name: string } | null {
  if (ruling.kind === "temporary_closure") return { kind: "temporary_closure", name: ruling.reason };
  if (ruling.kind === "holiday") return { kind: "holiday", name: ruling.name };
  return null;
}

/**
 * The next opening, skipping days something above the week has closed.
 *
 * `nextOpening` below reads the week alone, which was right until holidays
 * existed and is now the difference between "opens 08:00 tomorrow" and a buyer
 * arriving on the first morning of Eid. Each candidate day is ruled on in turn,
 * so a four-day closure is stepped over rather than announced.
 */
function nextOpeningWith(
  now: Date,
  minutes: number,
  day: Day,
  schedule: BranchSchedule,
): { opensAt: string; opensDay: Day } | null {
  const start = DAYS.indexOf(day);

  for (let ahead = 0; ahead < LOOKAHEAD_DAYS; ahead += 1) {
    const candidate = DAYS[(start + ahead) % 7]!;
    const ruling = rulingFor(new Date(now.getTime() + ahead * DAY_MS), schedule);
    for (const shift of ruling.shifts) {
      // Today only counts if the shift has not already started.
      if (ahead === 0 && minutesOf(shift.open) <= minutes) continue;
      return { opensAt: shift.open, opensDay: candidate };
    }
  }
  return null;
}

/**
 * `openingHoursSpecification`, for `LocalBusiness` JSON-LD.
 *
 * Built from the same evaluation the storefront renders, Ramadan window and
 * all: a machine reading this page during Ramadan should be told the hours that
 * are in effect, not the ones on file. Two surfaces disagreeing about when a
 * supplier is open is worse than either being slightly coarse.
 *
 * Returns undefined rather than an empty array when there are no hours.
 * Schema.org treats an empty specification as a claim about opening times, and
 * we have nothing to claim.
 */
export function openingHoursSchema(
  hours: WeekHours | null | undefined,
  ramadan: RamadanHours | null | undefined,
  now = new Date(),
  calendar?: RamadanCalendar,
):
  | { "@type": "OpeningHoursSpecification"; dayOfWeek: string; opens: string; closes: string }[]
  | undefined {
  if (!hours) return undefined;

  const { hours: week } = hoursInEffect(hours, ramadan ?? null, now, calendar);

  const SCHEMA_DAY: Record<Day, string> = {
    sun: "Sunday",
    mon: "Monday",
    tue: "Tuesday",
    wed: "Wednesday",
    thu: "Thursday",
    fri: "Friday",
    sat: "Saturday",
  };

  const out = DAYS.flatMap((day) =>
    (week[day] ?? []).map((shift) => ({
      "@type": "OpeningHoursSpecification" as const,
      dayOfWeek: SCHEMA_DAY[day],
      opens: shift.open,
      closes: shift.close,
    })),
  );

  return out.length > 0 ? out : undefined;
}
