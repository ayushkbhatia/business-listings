import {
  DAYS,
  hoursInEffect,
  minutesOf,
  type Day,
  type RamadanHours,
  type Shift,
  type WeekHours,
} from "./hours";

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
  | { state: "closed"; opensAt?: string; opensDay?: Day; isRamadan: boolean }
  | { state: "unknown" };

function shiftsFor(week: WeekHours, day: Day): Shift[] {
  return week[day] ?? [];
}

/** Is there any shift on any day? An empty week is "unknown", not "closed". */
function hasAnyHours(week: WeekHours): boolean {
  return DAYS.some((day) => shiftsFor(week, day).length > 0);
}

/**
 * The next opening time on or after `day`, searching a week forward.
 *
 * A week rather than "tomorrow", because a supplier closed Friday and Saturday
 * needs Sunday, and one that trades a single day a week still has an answer.
 */
function nextOpening(
  week: WeekHours,
  day: Day,
  minutes: number,
): { opensAt: string; opensDay: Day } | null {
  const start = DAYS.indexOf(day);

  for (let ahead = 0; ahead < 7; ahead += 1) {
    const candidate = DAYS[(start + ahead) % 7]!;
    for (const shift of shiftsFor(week, candidate)) {
      // Today only counts if the shift has not already started.
      if (ahead === 0 && minutesOf(shift.open) <= minutes) continue;
      return { opensAt: shift.open, opensDay: candidate };
    }
  }
  return null;
}

/**
 * Open, closed, or unknown — with the time that matters attached.
 *
 * `until` is the close of the shift currently running, so the surface can say
 * "Open until 18:00" rather than only "Open". `opensAt` is the mirror: "Closed ·
 * opens 08:00". Both are the strings the seller typed, not reformatted, because
 * a supplier who wrote 08:00 means 08:00.
 */
export function openNow(
  hours: WeekHours | null | undefined,
  ramadan: RamadanHours | null | undefined,
  now = new Date(),
): OpenState {
  if (!hours || !hasAnyHours(hours)) return { state: "unknown" };

  /*
     The Ramadan switch is automatic, and that is the point of it — a seller who
     set reduced hours in March should not have to remember to turn them on.
     `hoursInEffect` owns the decision, including refusing to apply a Ramadan
     block that would close the business all week.
  */
  const { hours: week, isRamadan } = hoursInEffect(hours, ramadan ?? null, now);
  if (!hasAnyHours(week)) return { state: "unknown" };

  const { day, minutes } = dubaiNow(now);

  for (const shift of shiftsFor(week, day)) {
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

  const next = nextOpening(week, day, minutes);
  return next
    ? { state: "closed", opensAt: next.opensAt, opensDay: next.opensDay, isRamadan }
    : { state: "closed", isRamadan };
}
