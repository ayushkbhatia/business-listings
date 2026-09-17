/**
 * Which channels fire, and when.
 *
 * Two rules from board 7e, and they pull against each other. The routing
 * matrix is the seller's own choice about where each event reaches them. Quiet
 * hours are the platform's promise that it will not wake them at two in the
 * morning to tell them a document expires next month.
 *
 * The override is where the tension resolves: a large enquiry is worth being
 * woken for, and a seller who misses one because we were being polite has been
 * badly served. `highValueOverrideAed` is theirs to set, and null means never.
 *
 * In-app is never suppressed. It is not an interruption — nothing buzzes, and
 * a notification waiting in a list at 07:00 is the same notification whether it
 * arrived at 22:00 or at dawn. Deferring it would only make the list wrong.
 *
 * Pure. `now` and the timezone are parameters so the decision is testable and
 * so every channel in one send measures from the same instant.
 */

export type NotificationChannel = "whatsapp" | "sms" | "email" | "in_app";

/**
 * The events, from the schema rather than retyped beside it.
 *
 * This was a hand-written union listing the same fifteen values as the Prisma
 * enum, and the two drifted the first time one of them gained a value: board
 * 3d added `ramadan_dates_moved` to the schema, `params.ts` demanded the entry
 * because it is keyed to the generated type, and this file went on refusing to
 * route it. A second list of the same thing is a second thing to keep in step,
 * and this one had no test that would have noticed.
 *
 * A type import, so nothing at runtime comes with it — `lib/db/generated/enums`
 * is types and a frozen object, not a client, which is why the pure modules on
 * this side of the boundary can read it.
 */
export type { NotificationEvent } from "@/lib/db/generated/enums";
import type { NotificationEvent } from "@/lib/db/generated/enums";

/**
 * What a seller cannot switch off. Board 12g `B7`.
 *
 * *"Opt-outs are honoured per channel, with two exceptions… Those are
 * consequences, not marketing, and the exception list is short and stated."*
 *
 * The list is stated here, once, and read by three places: `route()` below,
 * which adds these channels whatever the matrix says; board 7e's alerts form,
 * which renders them ticked and locked; and the console's *who can turn this
 * off* panel, which names them.
 *
 * - **`document_expiring`.** A licence that lapses takes the verified badge
 *   with it on the day, with no grace period. A seller who unticked email on 7e
 *   and learned of it from the badge going was told nothing because of a box
 *   that looked like a preference for newsletters.
 * - **`ramadan_dates_moved`.** The dates are the platform's, and board 3d's
 *   card promises "we email you when they move". It was never in 7e's matrix, so
 *   the event routed to no channel at all and the promise was kept by nobody.
 *
 * The handoff's second exception is *a reported problem*. There is no event for
 * one — `4h` resolves reports without messaging the seller — so it is not on
 * the list, and the console says so rather than naming a message that does not
 * exist.
 *
 * Email and in-app only. Neither interrupts, so quiet hours still hold for
 * whatever a seller has chosen on top.
 */
export const PLATFORM_FLOOR: Readonly<Partial<Record<NotificationEvent, readonly NotificationChannel[]>>> = {
  document_expiring: ["email", "in_app"],
  ramadan_dates_moved: ["email", "in_app"],
  /*
     Board `11e` `B10`. The screen tells a seller joining a waiting list that
     everybody on it is told the day the slot frees, and the first to answer
     takes it. A seller who had switched something off and then lost the race
     because of it would have been beaten by a preference they set about
     newsletters — so the promise is on the floor with the other two.
  */
  placement_slot_freed: ["email", "in_app"],
};

/** The channels quiet hours actually silence. */
export const INTERRUPTING_CHANNELS: readonly NotificationChannel[] = ["whatsapp", "sms"];

export interface QuietHours {
  enabled: boolean;
  /** Local hour the quiet window opens, e.g. 21. The fallback, see below. */
  fromHour: number;
  /** Local hour it closes, e.g. 7. Wraps midnight when from > to. */
  toHour: number;
  onSunday: boolean;
  /**
   * The seller's own counter, from the Hours page.
   *
   * Board 7e §5 names one source for quiet hours, the auto-reply and board 7d's
   * routing skip: "the Hours page. Same source… One copy." A second working
   * week stored on the alerts screen is the contradiction that surfaces first
   * during Ramadan — quiet hours running to 07:00 while the counter opened at
   * 09:00 and the routing skip agreed with neither.
   *
   * Null where nobody has published hours. That is not "always open" and not
   * "always shut" — it is a business with no week — and the stored window above
   * is what is left until the Hours page is filled in. It is the same rule
   * `lib/leads/router.ts` applies to the routing skip, written once in each
   * place because the two decide different things from the same fact.
   */
  hours?: { closedNow: boolean; opensAt: Date | null } | null;
}

export interface RoutingPreference {
  /** Event to channels, as stored. An event absent from the matrix sends nothing. */
  matrix: Partial<Record<NotificationEvent, readonly NotificationChannel[]>>;
  quiet: QuietHours;
  /** Null means quiet hours are never overridden, whatever the enquiry is worth. */
  highValueOverrideAed: number | null;
}

export interface RoutingContext {
  event: NotificationEvent;
  now: Date;
  /** What the enquiry is worth, for the override. Null when there is no value. */
  valueAed?: number | null;
  timeZone?: string;
}

export type ChannelDecision =
  | { channel: NotificationChannel; action: "send" }
  /** Held by quiet hours. Sent when they lift, at `at`. */
  | { channel: NotificationChannel; action: "defer"; at: Date; reason: string }
  /** Not sent at all. The seller turned it off, or it is a duplicate. */
  | { channel: NotificationChannel; action: "skip"; reason: string };

const UAE = "Asia/Dubai";

/** Local hour and weekday, in the seller's timezone rather than the server's. */
export function localParts(now: Date, timeZone = UAE): { hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(now);

  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const weekdayName = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayName);
  return { hour: hour % 24, weekday: weekday === -1 ? 1 : weekday };
}

/** Is `now` inside the seller's quiet window? */
export function inQuietHours(quiet: QuietHours, now: Date, timeZone = UAE): boolean {
  if (!quiet.enabled) return false;
  // The counter decides where there is one. Everything below is the fallback
  // for a supplier who has not published hours anywhere.
  if (quiet.hours) return quiet.hours.closedNow;

  const { hour, weekday } = localParts(now, timeZone);

  // The UAE weekend is Saturday and Sunday; board 7e names Sunday because that
  // is the day before the working week and the one a seller most wants back.
  if (quiet.onSunday && weekday === 0) return true;

  // A window that wraps midnight — 21:00 to 07:00 — is two ranges, not one.
  return quiet.fromHour > quiet.toHour
    ? hour >= quiet.fromHour || hour < quiet.toHour
    : hour >= quiet.fromHour && hour < quiet.toHour;
}

/**
 * When the quiet window next lifts.
 *
 * Walks hour by hour rather than doing arithmetic on the window, because a
 * Sunday inside a wrapping window is two overlapping rules and the arithmetic
 * for that is where the off-by-one lives. A day of hours is 24 iterations.
 */
export function quietLiftsAt(quiet: QuietHours, now: Date, timeZone = UAE): Date {
  /*
     When the counter opens, where the counter is the source. `opensAt` is null
     for a business whose published week never opens again inside eight days,
     which is a supplier who has closed rather than one who is asleep — sending
     now beats never sending, and the delivery row records that it was held.
  */
  if (quiet.hours) return quiet.hours.opensAt ?? now;

  const HOUR = 3_600_000;
  let cursor = new Date(Math.ceil(now.getTime() / HOUR) * HOUR);
  for (let i = 0; i < 24 * 8; i += 1) {
    if (!inQuietHours(quiet, cursor, timeZone)) return cursor;
    cursor = new Date(cursor.getTime() + HOUR);
  }
  // Unreachable unless a preference silences every hour of every day, which
  // the UI cannot produce. Sending now beats never sending.
  return now;
}

/** True when this enquiry is worth waking somebody for. */
export function overridesQuietHours(
  preference: RoutingPreference,
  valueAed: number | null | undefined,
): boolean {
  if (preference.highValueOverrideAed === null) return false;
  if (valueAed === null || valueAed === undefined) return false;
  return valueAed >= preference.highValueOverrideAed;
}

export function route(
  preference: RoutingPreference,
  context: RoutingContext,
): ChannelDecision[] {
  const timeZone = context.timeZone ?? UAE;
  const chosen = preference.matrix[context.event] ?? [];
  const floor = PLATFORM_FLOOR[context.event] ?? [];
  const channels = [...chosen, ...floor.filter((channel) => !chosen.includes(channel))];
  if (channels.length === 0) return [];

  const quiet = inQuietHours(preference.quiet, context.now, timeZone);
  const override = quiet && overridesQuietHours(preference, context.valueAed);

  return channels.map((channel): ChannelDecision => {
    if (!quiet) return { channel, action: "send" };

    // In-app is never suppressed: nothing buzzes, and a list is a list.
    if (!INTERRUPTING_CHANNELS.includes(channel)) return { channel, action: "send" };

    if (override) return { channel, action: "send" };

    return {
      channel,
      action: "defer",
      at: quietLiftsAt(preference.quiet, context.now, timeZone),
      reason: "quiet_hours",
    };
  });
}

/**
 * Where a buyer is reached, and when. Buyers have no board 7e matrix, so every
 * buyer-facing event routes through this. Here rather than in `events.ts` so the
 * console can state it (board 12g `B7`) without importing a module that sends.
 *
 * Quiet hours apply — a WhatsApp at two in the morning is rude whoever receives
 * it — and there is no high-value override, because a buyer set no threshold.
 */
export const BUYER_DEFAULT: RoutingPreference = {
  matrix: {
    quote_received: ["whatsapp", "in_app"],
    quote_revised: ["in_app"],
    quote_expiring: ["in_app"],
    /*
       In-app only, deliberately. Board 11b caps the seller at one follow-up
       because a second loses more deals than it wins; putting that one on
       WhatsApp would make the cap a formality — the interruption is the part
       that costs the deal, not the message. A buyer weighing four quotes gets
       it where they are already comparing them.
    */
    message_received: ["in_app"],
  },
  quiet: { enabled: true, fromHour: 21, toHour: 7, onSunday: true },
  highValueOverrideAed: null,
};
