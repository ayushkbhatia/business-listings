import "server-only";
import { prisma } from "@/lib/db/client";
import type { RailDelivery } from "./dunning-rail";

/**
 * The payment notices each account was sent in its current episode — the rows
 * `dunningRail` reads. One query for any number of accounts, so board 12i's
 * table and board 3m's banner pay the same cost per page, not per row.
 *
 * Bounded by each account's own `pastDueSince`: a notice from a lapse the
 * account recovered from is not part of this one, and showing it would tell a
 * seller they were emailed about a payment that had nothing to do with today.
 */
export async function noticeDeliveries(
  episodes: readonly { businessId: string; since: Date }[],
): Promise<Map<string, RailDelivery[]>> {
  const out = new Map<string, RailDelivery[]>();
  if (episodes.length === 0) return out;
  const earliest = new Date(Math.min(...episodes.map((episode) => episode.since.getTime())));
  const sinceOf = new Map(episodes.map((episode) => [episode.businessId, episode.since.getTime()]));

  const rows = await prisma.notificationDelivery.findMany({
    where: {
      businessId: { in: [...sinceOf.keys()] },
      event: { in: ["payment_failed", "payment_final_notice"] },
      createdAt: { gte: earliest },
      test: false,
    },
    select: {
      businessId: true,
      event: true,
      channel: true,
      status: true,
      reason: true,
      createdAt: true,
      sentAt: true,
      scheduledFor: true,
      recipientUserId: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const userIds = [...new Set(rows.map((row) => row.recipientUserId).filter((id): id is string => !!id))];
  const names = new Map(
    (
      await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, fullName: true },
        orderBy: { id: "asc" },
      })
    ).map((user) => [user.id, user.fullName]),
  );

  for (const row of rows) {
    if (!row.businessId) continue;
    const since = sinceOf.get(row.businessId);
    if (since === undefined || row.createdAt.getTime() < since) continue;
    const list = out.get(row.businessId) ?? [];
    list.push({
      event: row.event as RailDelivery["event"],
      channel: row.channel,
      status: row.status,
      reason: row.reason,
      createdAt: row.createdAt,
      sentAt: row.sentAt,
      scheduledFor: row.scheduledFor,
      recipientName: row.recipientUserId ? (names.get(row.recipientUserId) ?? null) : null,
    });
    out.set(row.businessId, list);
  }
  return out;
}
