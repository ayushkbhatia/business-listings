import "server-only";
import { prisma } from "@/lib/db/client";

/**
 * The three counts the buyer account's tab row prints — board 10e.
 *
 * Each is a count of the rows its own page lists, by the same `where`, so a tab
 * reading *Saved searches 4* opens a page of four.
 */
export async function accountCounts(userId: string): Promise<{ enquiries: number; saved: number; suppliers: number }> {
  const [enquiries, saved, suppliers] = await Promise.all([
    prisma.enquiry.count({ where: { buyerId: userId } }),
    prisma.savedSearch.count({ where: { userId } }),
    prisma.shortlist.count({ where: { userId } }),
  ]);
  return { enquiries, saved, suppliers };
}
