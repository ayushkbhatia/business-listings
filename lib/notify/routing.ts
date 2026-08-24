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
export type NotificationEvent =
  | "enquiry_received"
  | "enquiry_unanswered"
  | "enquiry_escalated"
  | "quote_received"
  | "quote_revised"
  | "quote_accepted"
  | "quote_expiring"
  | "review_posted"
  | "review_requested"
  | "document_expiring"
  | "weekly_digest";

/** The channels quiet hours actually silence. */
export const INTERRUPTING_CHANNELS: readonly NotificationChannel[] = ["whatsapp", "sms"];

export interface QuietHours {
  enabled: boolean;
  /** Local hour the quiet window opens, e.g. 21. */
  fromHour: number;
  /** Local hour it closes, e.g. 7. Wraps midnight when from > to. */
  toHour: number;
  onSunday: boolean;
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
  const channels = preference.matrix[context.event] ?? [];
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
