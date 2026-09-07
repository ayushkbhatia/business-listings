import "server-only";
import { Prisma } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { onRamadanDatesMoved } from "@/lib/notify/events";
import { readRamadanCalendar } from "./ramadan-calendar";
import {
  RAMADAN_NOTIFIED_KEY,
  type RamadanCalendar,
  type RamadanNotified,
} from "./hours";

/**
 * The other half of "we shift them and email you when they move".
 *
 * Board 3d's Ramadan card makes a promise on the platform's behalf and the
 * whole first correction rests on it: the **dates** are ours, estimated until
 * the UAE announcement, and the seller never has to watch for the change. A
 * promise in shipped copy with nothing performing it is the shape board 4e Q2
 * already got wrong once, so this performs it.
 *
 * ## What "moved" is measured against
 *
 * Nothing recorded what sellers had previously been told, so there was no
 * previous value to detect a change from. `ramadan_dates_notified` is that
 * record — one settings row holding the published window per year and the
 * instant it became published.
 *
 *   · no record for a year   the baseline is written and nobody is emailed.
 *                            Nothing has moved; this is the first time the
 *                            window has been published at all.
 *   · record matches         nothing to do.
 *   · record differs         every affected seller is emailed once, and the
 *                            record catches up.
 *
 * ## Who is affected
 *
 * Sellers with Ramadan hours on file. A supplier who has never stated any is
 * not being emailed about a window that changes nothing for them — the same
 * restraint `ramadanNeedsConfirming` shows about board 3a's card.
 *
 * ## What it will not do
 *
 * It never touches `Location.ramadanConfirmedYear`. The shift is ours, and
 * re-opening a seller's confirmation because we corrected our own estimate
 * would be asking them a question they have already answered — board 3d's
 * "dates shifted after confirmation" state in one sentence.
 *
 * No audit row, for the reason every scheduled step gives: `AuditEvent.actorId`
 * is NOT NULL because the log records decisions, and a platform following its
 * own published sequence has no actor.
 */

export interface ShiftSweepResult {
  /** Years whose window is now recorded for the first time. */
  baselined: number[];
  /** Years whose window had moved. */
  moved: number[];
  notified: number;
  alreadySent: number;
}

/** A year far enough out that a shift in it is not yet anybody's problem. */
const HORIZON_MONTHS = 14;

export async function sweepRamadanShift(now: Date = new Date()): Promise<ShiftSweepResult> {
  const [calendar, record] = await Promise.all([
    readRamadanCalendar(),
    readNotified(),
  ]);

  const result: ShiftSweepResult = { baselined: [], moved: [], notified: 0, alreadySent: 0 };
  const horizon = new Date(now);
  horizon.setUTCMonth(horizon.getUTCMonth() + HORIZON_MONTHS);

  const next = { ...record };

  for (const [key, window] of Object.entries(calendar) as [string, RamadanCalendar[number]][]) {
    const year = Number(key);
    const from = new Date(`${window.from}T00:00:00Z`);
    // A window that finished is not going to move, and one four years out is
    // not worth an email today.
    const to = new Date(`${window.to}T23:59:59Z`);
    if (to < now || from > horizon) continue;

    const previous = record[year];
    if (!previous) {
      next[year] = { from: window.from, to: window.to, at: now.toISOString() };
      result.baselined.push(year);
      continue;
    }
    if (previous.from === window.from && previous.to === window.to) continue;

    result.moved.push(year);
    const sweep = await notifyMoved(year, window, previous);
    result.notified += sweep.notified;
    result.alreadySent += sweep.alreadySent;
    next[year] = { from: window.from, to: window.to, at: now.toISOString() };
  }

  if (result.baselined.length > 0 || result.moved.length > 0) await writeNotified(next);
  return result;
}

async function notifyMoved(
  year: number,
  window: { from: string; to: string },
  previous: RamadanNotified,
): Promise<{ notified: number; alreadySent: number }> {
  /*
     Sellers with Ramadan hours, and only them.

     `ramadanHours` is a nullable Json column, so "has stated any" is `not null`
     — a seller who cleared theirs has `Prisma.DbNull` written by `saveHours`,
     which is SQL NULL and correctly excluded.
  */
  const affected = await prisma.location.findMany({
    where: { ramadanHours: { not: Prisma.DbNull }, published: true },
    select: { businessId: true },
    distinct: ["businessId"],
  });

  /*
     Who has already been told about *this* shift.

     Scoped by the instant the previous window became published rather than by
     the calendar year: a partial failure half way through a sweep must be
     resumable without emailing the first half twice, and `NotificationDelivery`
     carries `createdAt` and nothing about which window a row was for.
  */
  const since = new Date(previous.at);
  const told = new Set(
    (
      await prisma.notificationDelivery.findMany({
        where: {
          event: "ramadan_dates_moved",
          createdAt: { gt: since },
          businessId: { in: affected.map((row) => row.businessId) },
        },
        select: { businessId: true },
      })
    )
      .map((row) => row.businessId)
      .filter((id): id is string => id !== null),
  );

  let notified = 0;
  for (const { businessId } of affected) {
    if (told.has(businessId)) continue;
    await onRamadanDatesMoved({
      businessId,
      year,
      from: new Date(`${window.from}T00:00:00Z`),
      to: new Date(`${window.to}T00:00:00Z`),
    });
    notified += 1;
  }
  return { notified, alreadySent: told.size };
}

async function readNotified(): Promise<Record<number, RamadanNotified>> {
  const row = await prisma.platformSetting.findUnique({
    where: { key: RAMADAN_NOTIFIED_KEY },
    select: { value: true },
  });
  return parseNotified(row?.value);
}

/**
 * Validated per entry, like the calendar it shadows.
 *
 * One mangled year should cost that year rather than the whole record — and a
 * record that failed to parse wholesale would re-baseline every window and
 * silently stop detecting shifts, which is the failure this job exists to
 * prevent.
 */
export function parseNotified(value: unknown): Record<number, RamadanNotified> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<number, RamadanNotified> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const year = Number(key);
    if (!Number.isInteger(year) || !entry || typeof entry !== "object") continue;
    const { from, to, at } = entry as { from?: unknown; to?: unknown; at?: unknown };
    if (typeof from !== "string" || typeof to !== "string" || typeof at !== "string") continue;
    if (Number.isNaN(new Date(at).getTime())) continue;
    out[year] = { from, to, at };
  }
  return out;
}

async function writeNotified(value: Record<number, RamadanNotified>): Promise<void> {
  await prisma.platformSetting.upsert({
    where: { key: RAMADAN_NOTIFIED_KEY },
    update: { value: JSON.parse(JSON.stringify(value)) },
    create: { key: RAMADAN_NOTIFIED_KEY, value: JSON.parse(JSON.stringify(value)) },
  });
}
