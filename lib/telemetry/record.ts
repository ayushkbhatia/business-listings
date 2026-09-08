import "server-only";
import { prisma } from "@/lib/db/client";
import { dubaiDayStart } from "@/lib/format";
import { validateEvent, type EventName, type EventPropsInput } from "./events";

/**
 * The writes. The catalogue they are checked against is `./events`, which is
 * pure so the browser can read it too.
 *
 * ## Nothing here throws
 *
 * A telemetry write sits inside a page render or a form submit, and a counter
 * that can fail the thing it is counting is worse than no counter. Every
 * function below swallows its own failure and logs it, on the same reasoning as
 * `recordContactReveal` and `recordAttempt`: losing one row is cheaper than
 * losing the enquiry, the submit or the render that row was about.
 *
 * `pruneProductEvents` is the exception and deliberately so — it runs inside
 * `runSteps`, which catches per step and reports which one failed. A prune that
 * silently returned 0 would look like a table that stopped growing.
 */

export interface RecordEventInput {
  name: EventName;
  /** Which supplier this was about. Null where the event has no business in it. */
  businessId?: string | null;
  actorId?: string | null;
  /** Groups one page life. Never set for an anonymous event — see docs/telemetry.md. */
  sessionId?: string | null;
  props?: EventPropsInput;
  /** For a job writing about something that happened on its own schedule. */
  at?: Date;
}

/**
 * One `product_event` row.
 *
 * Validated again here rather than trusted, even though every caller is our own
 * server code. The closed set is the whole value of the table: a name typed by
 * hand in a service is exactly as capable of inventing `setup_task_complete` as
 * a client is, and the row it writes is exactly as invisible to the analysis
 * that groups by name.
 */
export async function recordEvent(input: RecordEventInput): Promise<void> {
  try {
    const validated = validateEvent(input.name, input.props ?? {});
    if (!validated.ok) {
      // Ours, not a caller's: a server-side event that fails this check is a
      // bug in the call site, and it is the one telemetry failure worth noise.
      console.error("[telemetry] refused an event", {
        error: validated.error,
        detail: validated.detail,
      });
      return;
    }

    await prisma.productEvent.create({
      data: {
        name: validated.name,
        businessId: input.businessId ?? null,
        actorId: input.actorId ?? null,
        sessionId: input.sessionId ?? null,
        props: validated.props,
        ...(input.at ? { createdAt: input.at } : {}),
      },
    });
  } catch (cause) {
    console.error("[telemetry] could not write an event", { name: input.name, cause });
  }
}

/**
 * Drop rows past the window the funnel is read over.
 *
 * `olderThan` has no default, the same as `pruneRateLimitHits` and
 * `pruneAttempts`: the caller picks the cutoff and writes down why it is that
 * number. `app/api/jobs/daily/route.ts` holds this one's reasoning.
 */
export async function pruneProductEvents(olderThan: Date): Promise<number> {
  const { count } = await prisma.productEvent.deleteMany({
    where: { createdAt: { lt: olderThan } },
  });
  return count;
}

/**
 * The Asia/Dubai calendar day an instant falls on, as UTC midnight.
 *
 * Two decisions, and both would be a migration to change later.
 *
 * **Dubai, not the host.** Vercel runs in UTC, so a view at 01:30 on the 14th
 * in Dubai is the 13th to the machine — and `setup.rail.views` says "since you
 * went live" to a supplier in Al Quoz, for whom that view happened today. This
 * is the decision `lib/format/date.ts` and `lib/trade/open-now.ts` already made
 * for rendering and for "open now", reached the same way: the wall clock comes
 * out of `Intl.DateTimeFormat` with an explicit zone rather than off the host.
 *
 * **UTC midnight, not local midnight.** `ListingViewDay.day` is `@db.Date` and
 * holds no zone. Sending 00:00+04:00 would be sending the previous day's
 * evening, and whether that lands on the right date would depend on the
 * session's `TimeZone` — a row that is correct on one connection and off by one
 * on another. UTC midnight is the value Prisma reads a `date` column back as,
 * so writing and reading agree by construction.
 *
 * **The twin is gone.** This and `dubaiDayStart` in `lib/setup/tasks.ts` were
 * the same function reached independently for the write and read sides of one
 * column. Board `3l` needed a third caller, so both now delegate to
 * `lib/format/date.ts`, which owns every other Dubai-zone date decision. The
 * alias stays because this name is what the writers in this file read as.
 */
export const dubaiDay = dubaiDayStart;


/**
 * Count one storefront view, on the day the supplier had.
 *
 * The published check is here rather than at the route because it is the thing
 * that makes the number honest, and a guard in a screen is a guard the next
 * screen forgets. `/api/events` is a public endpoint: without it, anyone posting
 * a made-up id writes a `listing_view_day` row for a listing that is a draft, is
 * suspended, or does not exist — and a seller's "views since you went live"
 * would then be counting people who could not have seen it.
 *
 * That costs one primary-key lookup per view. It is the same trade the whole
 * table already makes: the alternative is a count nobody can put on a screen.
 */
export async function recordListingView(businessId: string, at: Date = new Date()): Promise<void> {
  try {
    const business = await prisma.business.findFirst({
      where: { id: businessId, publishedAt: { not: null }, suspendedAt: null },
      select: { id: true },
    });
    if (!business) return;

    const day = dubaiDay(at);
    await prisma.listingViewDay.upsert({
      where: { businessId_day: { businessId, day } },
      create: { businessId, day, views: 1 },
      update: { views: { increment: 1 } },
    });
  } catch (cause) {
    console.error("[telemetry] could not count a listing view", { businessId, cause });
  }
}
