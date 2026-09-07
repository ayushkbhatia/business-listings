import "server-only";
import { prisma } from "@/lib/db/client";
import { branchStatus } from "@/lib/locations/branch";
import { nextRamadan, type RamadanHours, type WeekHours } from "@/lib/trade/hours";
import { readRamadanCalendar } from "@/lib/trade/ramadan-calendar";
import { ramadanNeedsConfirming, rulingFor, type ClosureWindow, type HolidayWindow } from "@/lib/trade/closures";
import type { LocationType } from "@/lib/db/generated/enums";

/**
 * Board 3d, loaded once.
 *
 * The screen is scoped to one branch at a time and the picker excludes drafts,
 * so the branch list and the selected branch's schedule come out of the same
 * read — a second query for "the branch I am editing" is how a picker and a
 * form come to disagree about which one that is.
 */

export interface HoursBranch {
  id: string;
  name: string;
  type: LocationType;
  hours: WeekHours;
  ramadanHours: RamadanHours | null;
  ramadanConfirmedYear: number | null;
  /** Board 3c's status. Hidden branches are offered here; drafts are not. */
  hidden: boolean;
  closure: { from: Date; until: Date; reason: string } | null;
  closures: ClosureWindow[];
}

export interface HoursBoard {
  branches: HoursBranch[];
  holidays: HolidayWindow[];
  ramadan: {
    year: number;
    from: Date;
    to: Date;
    active: boolean;
    /** False while the UAE has not announced them. Drives `ESTIMATED`. */
    confirmed: boolean;
  } | null;
}

export async function getHoursBoard(
  businessId: string,
  typeLabel: (type: LocationType) => string,
  now: Date = new Date(),
): Promise<HoursBoard> {
  const [locations, calendar] = await Promise.all([
    prisma.location.findMany({
      where: { businessId },
      orderBy: [{ type: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        type: true,
        hours: true,
        ramadanHours: true,
        ramadanConfirmedYear: true,
        published: true,
        publishedAt: true,
        closedFrom: true,
        closedUntil: true,
        closureReason: true,
        area: { select: { name: true } },
        closures: {
          orderBy: { startsOn: "asc" },
          select: {
            id: true,
            reason: true,
            startsOn: true,
            endsOn: true,
            openFrom: true,
            openUntil: true,
          },
        },
      },
    }),
    readRamadanCalendar(),
  ]);

  /*
     Two years of official dates, forward only.

     Board 3d Q1's answer is "platform-maintained, two years ahead, reviewed
     each January", and the rail is headed `Public holidays 2026–27`. A date
     that has been and gone is not a setting the seller can act on, so the rail
     looks forward and the calendar behind it is the platform's to extend.
  */
  const horizon = new Date(now);
  horizon.setUTCFullYear(horizon.getUTCFullYear() + 2);
  const holidays = await prisma.publicHoliday.findMany({
    where: { endsOn: { gte: startOfDay(now) }, startsOn: { lte: horizon } },
    orderBy: { startsOn: "asc" },
    select: {
      id: true,
      name: true,
      startsOn: true,
      endsOn: true,
      openFrom: true,
      openUntil: true,
      confirmed: true,
    },
  });

  const window = nextRamadan(now, calendar);

  return {
    branches: locations
      // Criterion 11. `pickerBranches` in the service says the same thing for
      // a write; this is the read half, and both go through `branchStatus`.
      .filter((location) => branchStatus(location) !== "draft")
      .map((location) => ({
        id: location.id,
        name: `${location.area.name} ${typeLabel(location.type).toLocaleLowerCase("en")}`,
        type: location.type,
        hours: (location.hours ?? {}) as WeekHours,
        ramadanHours: (location.ramadanHours ?? null) as RamadanHours | null,
        ramadanConfirmedYear: location.ramadanConfirmedYear,
        hidden: branchStatus(location) === "hidden",
        closure:
          location.closedFrom && location.closedUntil && location.closureReason
            ? {
                from: location.closedFrom,
                until: location.closedUntil,
                reason: location.closureReason,
              }
            : null,
        closures: location.closures,
      })),
    holidays,
    ramadan: window
      ? {
          year: window.year,
          from: window.from,
          to: window.to,
          active: window.active,
          confirmed: window.confirmed,
        }
      : null,
  };
}

function startOfDay(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

/**
 * Which holidays collide with Ramadan for this branch — criterion 7.
 *
 * Computed, never written down. The render marks `19 MAR ALSO RAMADAN · CLOSED
 * WINS` on the Eid row, and with the platform's own 2027 window those two dates
 * do not overlap at all — a hardcoded marker would have gone on claiming they
 * did. `rulingFor` is asked about the holiday's first day, which is where the
 * collision either is or is not.
 */
export function ramadanCollisions(
  branch: Pick<HoursBranch, "hours" | "ramadanHours" | "closure" | "closures">,
  holidays: readonly HolidayWindow[],
): Set<string> {
  const clashes = new Set<string>();
  for (const holiday of holidays) {
    const ruling = rulingFor(holiday.startsOn, {
      hours: branch.hours,
      ramadanHours: branch.ramadanHours,
      // Deliberately without the temporary closure and the seller's own dates.
      // The question is whether *Ramadan* would have applied, not which rung
      // eventually won — a stock-take closure on top does not make the marker
      // on the Eid row untrue.
      holidays: [holiday],
    });
    if (ruling.kind === "holiday" && ruling.alsoRamadan) clashes.add(holiday.id);
  }
  return clashes;
}

/** Board 3a's reminder, as this screen computes it. */
export function needsConfirming(branch: HoursBranch, board: HoursBoard): boolean {
  return ramadanNeedsConfirming(
    branch.ramadanConfirmedYear,
    branch.ramadanHours,
    board.ramadan,
  );
}

/* ── What the public surfaces need ───────────────────────────────────────── */

/**
 * The national calendar around a date, for a page that renders `open now`.
 *
 * A fortnight either side rather than the rail's two years: the only question a
 * public surface asks is whether *today* is a holiday and when the branch next
 * opens, and `openNow` looks a week ahead. Loading two years of dates to answer
 * that would be six rows too many on every storefront in the directory.
 */
export async function publicHolidaysAround(
  now: Date,
  days = 21,
): Promise<HolidayWindow[]> {
  const span = days * 86_400_000;
  return prisma.publicHoliday.findMany({
    where: {
      endsOn: { gte: new Date(now.getTime() - span) },
      startsOn: { lte: new Date(now.getTime() + span) },
    },
    orderBy: { startsOn: "asc" },
    select: {
      id: true,
      name: true,
      startsOn: true,
      endsOn: true,
      openFrom: true,
      openUntil: true,
      confirmed: true,
    },
  });
}

/** The seller's own dates, keyed by branch, for the same surfaces. */
export async function branchClosures(
  locationIds: readonly string[],
): Promise<Map<string, ClosureWindow[]>> {
  const out = new Map<string, ClosureWindow[]>();
  if (locationIds.length === 0) return out;

  const rows = await prisma.locationClosure.findMany({
    where: { locationId: { in: [...locationIds] } },
    orderBy: { startsOn: "asc" },
    select: {
      id: true,
      locationId: true,
      reason: true,
      startsOn: true,
      endsOn: true,
      openFrom: true,
      openUntil: true,
    },
  });

  for (const row of rows) {
    const list = out.get(row.locationId) ?? [];
    list.push(row);
    out.set(row.locationId, list);
  }
  return out;
}
