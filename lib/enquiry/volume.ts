import "server-only";
import { prisma } from "@/lib/db/client";

/**
 * Enquiries and RFQs created per window — the demand series on board 4a's
 * growth chart.
 *
 * Every enquiry counts once, however many suppliers it reached: the rule board
 * `4d` states for its *RFQs / month* (`rfqWhere` in `lib/taxonomy/board.ts`),
 * without the category, so a sector's figure and the platform's are the same
 * count cut two ways. An RFQ is an enquiry sent to more than one supplier, and
 * one sequence numbers both.
 */
export async function enquiriesByWindow(
  windows: readonly { key: string; from: Date; to: Date }[],
): Promise<Map<string, number>> {
  const result = new Map(windows.map((window) => [window.key, 0]));
  await Promise.all(
    windows.map(async (window) => {
      result.set(window.key, await prisma.enquiry.count({ where: { createdAt: { gte: window.from, lt: window.to } } }));
    }),
  );
  return result;
}
