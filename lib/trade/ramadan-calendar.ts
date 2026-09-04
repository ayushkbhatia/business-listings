import "server-only";
import { prisma } from "@/lib/db/client";
import { FALLBACK_RAMADAN, RAMADAN_SETTING_KEY, type RamadanCalendar } from "./hours";

/**
 * The Ramadan calendar, from the platform setting.
 *
 * Board 2d, criterion 15: *"The dates come from one platform-level setting
 * (`12h` geography and calendar), not from each seller. Ramadan moves yearly and
 * 41,000 sellers will not update it."*
 *
 * The dates were already platform-level before this — a constant in
 * `lib/trade/hours.ts` — which met the "not each seller" half of that sentence
 * and missed the other. A lunar calendar shifts every year and is confirmed by a
 * moon sighting a day or two beforehand; correcting it should be a row, not a
 * deploy, and CLAUDE.md is explicit that content belongs in the database.
 *
 * ## Why the compiled table did not go away
 *
 * It is the fallback, and it earns its place three times over: the pure
 * functions in `hours.ts` stay callable without a database, a missing row on a
 * fresh environment does not take every storefront's opening hours down, and a
 * `value` somebody has mangled in the admin screen degrades to the last
 * known-good estimates rather than to nothing. `readRamadanCalendar` merges over
 * the fallback rather than replacing it, so a setting that names 2027 alone
 * still leaves 2028 answerable.
 *
 * Nothing here is cached. It is one indexed primary-key read per page, the
 * pages that need it already issue several, and `unstable_cache` only runs
 * inside a request — which the jobs and the integration tests that call this are
 * not.
 */

/** The setting's key. One string, so a typo is a compile error somewhere. */
// Declared in ./hours, which has no database in it, so the seed can read it too.
export { RAMADAN_SETTING_KEY };

/**
 * `{"2026":{"from":"2026-02-17","to":"2026-03-19"}}` → a calendar.
 *
 * Validated per entry rather than wholesale: one bad year should cost that year
 * and not the other five. Anything that is not a plain `YYYY-MM-DD` pair with
 * the end on or after the start is dropped, because a window that runs backwards
 * would report every date in the year as outside Ramadan and would do it
 * silently.
 */
export function parseRamadanCalendar(value: unknown): RamadanCalendar {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const out: RamadanCalendar = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const year = Number(key);
    if (!Number.isInteger(year) || year < 2000 || year > 2200) continue;
    if (!entry || typeof entry !== "object") continue;

    const { from, to } = entry as { from?: unknown; to?: unknown };
    if (typeof from !== "string" || typeof to !== "string") continue;
    if (!isDate(from) || !isDate(to) || to < from) continue;

    out[year] = { from, to };
  }
  return out;
}

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function isDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  // `2027-02-30` matches the pattern and is not a day.
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** The platform's calendar, over the compiled estimates. Never throws. */
export async function readRamadanCalendar(): Promise<RamadanCalendar> {
  try {
    const row = await prisma.platformSetting.findUnique({
      where: { key: RAMADAN_SETTING_KEY },
      select: { value: true },
    });
    return { ...FALLBACK_RAMADAN, ...parseRamadanCalendar(row?.value) };
  } catch (error) {
    /*
       A storefront that cannot read one settings row still knows when a
       supplier opens. Logged rather than swallowed, because a table that has
       stopped answering is worth somebody knowing about.
    */
    console.warn("[trade] could not read the Ramadan calendar", error);
    return FALLBACK_RAMADAN;
  }
}
