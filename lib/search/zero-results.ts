import "server-only";
import { prisma } from "@/lib/db/client";

/**
 * Searches that found nothing, over a window.
 *
 * One function because two surfaces state this number under the same label: the
 * console's supply metrics route *"Searches that found nothing"* to
 * `/admin/search`, and board `12c`'s right rail is where that link lands. A
 * staff member who clicks a number must arrive at the same number.
 *
 * ## Why it has a window at all
 *
 * The console counted every zero-result search ever recorded. That number only
 * goes up, so it says nothing about whether the gap is being worked — a
 * directory that fixed every gap last month would still show its worst-ever
 * total. Thirty days is what makes it a queue rather than a milestone.
 */
export const ZERO_RESULT_WINDOW_DAYS = 30;

export async function zeroResultCount(now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - ZERO_RESULT_WINDOW_DAYS * 86_400_000);
  return prisma.zeroResultQuery.count({ where: { createdAt: { gte: since } } });
}
