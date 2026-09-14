import "server-only";
import { prisma } from "@/lib/db/client";
import type { DeliveryStatus, NotificationChannel, NotificationEvent, TradeKind } from "@/lib/db/generated/enums";
import { CHANNELS } from "./draft";
import { EVENT_AUDIENCE, type Audience } from "./params";
import { BUYER_DEFAULT, PLATFORM_FLOOR } from "./routing";
import { resolveNotificationSenders } from "./senders";

/**
 * Board 12g — the three tabs beside the templates: the delivery log, the
 * channels and quiet hours.
 *
 * Reports, not editors. Nothing here writes, and every figure is a query over
 * `NotificationDelivery`, `NotificationPreference` or the carrier configuration
 * the process actually booted with. No address is ever read: the log names the
 * business or says *buyer*, and the delivery row itself never held a number.
 */

const DAY = 86_400_000;
export const REPORT_WINDOW_DAYS = 30;
export const LOG_PAGE_SIZE = 50;

// ── Delivery log ──────────────────────────────────────────────────────────────

export const LOG_STATUSES = ["sent", "deferred", "queued", "failed", "skipped"] as const satisfies readonly DeliveryStatus[];

export interface LogFilters {
  status: DeliveryStatus | null;
  channel: NotificationChannel | null;
  event: NotificationEvent | null;
  /** `createdAt|id` of the last row on the previous page. */
  cursor: string | null;
  tests: boolean;
}

export interface LogRow {
  id: string;
  createdAt: Date;
  event: NotificationEvent;
  channel: NotificationChannel;
  status: DeliveryStatus;
  reason: string | null;
  audience: Audience;
  businessName: string | null;
  businessSlug: string | null;
  enquiryId: string | null;
  tradeKind: TradeKind | null;
  templateVersion: number | null;
  templateKind: string | null;
  test: boolean;
  scheduledFor: Date | null;
}

export interface DeliveryLog {
  rows: LogRow[];
  /** Matching rows in the window, for "50 of 1,204". */
  total: number;
  nextCursor: string | null;
  since: Date;
}

export function parseCursor(raw: string | null | undefined): { createdAt: Date; id: string } | null {
  if (!raw) return null;
  const [at, id] = raw.split("|");
  const createdAt = new Date(at ?? "");
  return id && !Number.isNaN(createdAt.getTime()) ? { createdAt, id } : null;
}

/**
 * The newest deliveries first, fifty at a time, on a keyset cursor.
 *
 * Keyset rather than offset: rows arrive while somebody is reading, and an
 * offset page shifts under them — the row they were about to read appears again
 * at the top of page two. The order ends on `id` so it is total (`check:ordering`).
 */
export async function deliveryLog(filters: LogFilters, now: Date = new Date()): Promise<DeliveryLog> {
  const since = new Date(now.getTime() - REPORT_WINDOW_DAYS * DAY);
  const where = {
    createdAt: { gte: since },
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.channel ? { channel: filters.channel } : {}),
    ...(filters.event ? { event: filters.event } : {}),
    ...(filters.tests ? {} : { test: false }),
  };
  const cursor = parseCursor(filters.cursor);

  const [rows, total] = await Promise.all([
    prisma.notificationDelivery.findMany({
      where: cursor
        ? {
            ...where,
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: LOG_PAGE_SIZE + 1,
      select: {
        id: true,
        createdAt: true,
        event: true,
        channel: true,
        status: true,
        reason: true,
        businessId: true,
        enquiryId: true,
        tradeKind: true,
        test: true,
        scheduledFor: true,
        template: { select: { version: true, kind: true } },
      },
    }),
    prisma.notificationDelivery.count({ where }),
  ]);

  const page = rows.slice(0, LOG_PAGE_SIZE);
  const businessIds = [...new Set(page.map((row) => row.businessId).filter((id): id is string => !!id))];
  const businesses = new Map(
    (businessIds.length === 0
      ? []
      : await prisma.business.findMany({ where: { id: { in: businessIds } }, select: { id: true, displayName: true, slug: true } })
    ).map((b) => [b.id, b]),
  );

  const last = page.at(-1);
  return {
    rows: page.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      event: row.event,
      channel: row.channel,
      status: row.status,
      reason: row.reason,
      audience: EVENT_AUDIENCE[row.event],
      businessName: row.businessId ? (businesses.get(row.businessId)?.displayName ?? null) : null,
      businessSlug: row.businessId ? (businesses.get(row.businessId)?.slug ?? null) : null,
      enquiryId: row.enquiryId,
      tradeKind: row.tradeKind,
      templateVersion: row.template?.version ?? null,
      templateKind: row.template?.kind ?? null,
      test: row.test,
      scheduledFor: row.scheduledFor,
    })),
    total,
    nextCursor: rows.length > LOG_PAGE_SIZE && last ? `${last.createdAt.toISOString()}|${last.id}` : null,
    since,
  };
}

// ── Channels ──────────────────────────────────────────────────────────────────

export interface ChannelHealth {
  channel: NotificationChannel;
  /** The sender class this process resolved, or null when nothing carries the channel. */
  carrier: string | null;
  sent: number;
  failed: number;
  skipped: number;
  deferred: number;
  /** The most common skip reasons, most frequent first. */
  topSkips: { reason: string; count: number }[];
  lastFailure: { at: Date; reason: string | null } | null;
}

/**
 * What each channel did in thirty days, and what carries it right now.
 *
 * The carrier is read from `resolveNotificationSenders()` — the same call the
 * send path makes — so a channel this page calls configured is one a message
 * would actually be handed to. It names the sender, never a key.
 */
export async function channelHealth(now: Date = new Date()): Promise<{ channels: ChannelHealth[]; since: Date }> {
  const since = new Date(now.getTime() - REPORT_WINDOW_DAYS * DAY);
  const senders = resolveNotificationSenders();

  const [byStatus, skips, failures] = await Promise.all([
    prisma.notificationDelivery.groupBy({
      by: ["channel", "status"],
      where: { createdAt: { gte: since }, test: false },
      _count: { _all: true },
    }),
    prisma.notificationDelivery.groupBy({
      by: ["channel", "reason"],
      where: { createdAt: { gte: since }, test: false, status: "skipped" },
      _count: { _all: true },
    }),
    Promise.all(
      CHANNELS.map((channel) =>
        prisma.notificationDelivery.findFirst({
          where: { channel, status: "failed", test: false },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { createdAt: true, reason: true },
        }),
      ),
    ),
  ]);

  const channels = CHANNELS.map((channel, index): ChannelHealth => {
    const count = (status: DeliveryStatus) =>
      byStatus.find((g) => g.channel === channel && g.status === status)?._count._all ?? 0;
    const failure = failures[index];
    return {
      channel,
      carrier: senders[channel]?.name ?? null,
      sent: count("sent"),
      failed: count("failed"),
      skipped: count("skipped"),
      deferred: count("deferred") + count("queued"),
      topSkips: skips
        .filter((g) => g.channel === channel)
        .map((g) => ({ reason: g.reason ?? "unrecorded", count: g._count._all }))
        .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
        .slice(0, 3),
      lastFailure: failure ? { at: failure.createdAt, reason: failure.reason } : null,
    };
  });

  return { channels, since };
}

// ── Quiet hours ───────────────────────────────────────────────────────────────

export interface QuietReport {
  buyer: { fromHour: number; toHour: number; onSunday: boolean; matrix: Partial<Record<NotificationEvent, readonly NotificationChannel[]>> };
  sellers: {
    preferences: number;
    enabled: number;
    standardWindow: number;
    customWindow: number;
    sundayQuiet: number;
    /** Businesses whose quiet hours follow their published counter hours (board 7e §5). */
    followHours: number;
    overrideNever: number;
  };
  held: { count: number; nextRelease: Date | null };
  floor: Partial<Record<NotificationEvent, readonly NotificationChannel[]>>;
}

export async function quietReport(): Promise<QuietReport> {
  const [preferences, enabled, standard, sunday, overrideNever, followHours, held, next] = await Promise.all([
    prisma.notificationPreference.count(),
    prisma.notificationPreference.count({ where: { quietHoursEnabled: true } }),
    prisma.notificationPreference.count({ where: { quietHoursEnabled: true, quietFromHour: 21, quietToHour: 7 } }),
    prisma.notificationPreference.count({ where: { quietHoursEnabled: true, quietOnSunday: true } }),
    prisma.notificationPreference.count({ where: { highValueOverrideAed: null } }),
    prisma.notificationPreference.count({
      /*
         A published branch with a week filled in. `quietFromHours` then decides
         from the counter rather than the stored window — the approximation is
         a branch whose hours are all "closed", which counts here and reads as
         shut there, and a Ramadan-only week, which reads the same both ways.
      */
      where: { quietHoursEnabled: true, business: { locations: { some: { published: true, NOT: { hours: { equals: {} } } } } } },
    }),
    prisma.notificationDelivery.count({ where: { status: "deferred", test: false } }),
    prisma.notificationDelivery.findFirst({
      where: { status: "deferred", test: false, scheduledFor: { not: null } },
      orderBy: [{ scheduledFor: "asc" }, { id: "asc" }],
      select: { scheduledFor: true },
    }),
  ]);

  return {
    buyer: {
      fromHour: BUYER_DEFAULT.quiet.fromHour,
      toHour: BUYER_DEFAULT.quiet.toHour,
      onSunday: BUYER_DEFAULT.quiet.onSunday,
      matrix: BUYER_DEFAULT.matrix,
    },
    sellers: {
      preferences,
      enabled,
      standardWindow: standard,
      customWindow: enabled - standard,
      sundayQuiet: sunday,
      followHours,
      overrideNever,
    },
    held: { count: held, nextRelease: next?.scheduledFor ?? null },
    floor: PLATFORM_FLOOR,
  };
}
