import "server-only";
import { prisma } from "@/lib/db/client";
import { awaitingCount } from "@/lib/buyer-company/queue";

/**
 * The counts the buyer account's tab row prints — boards 10e and 7b.
 *
 * Each is a count of the rows its own page lists, by the same `where`, so a tab
 * reading *Saved searches 4* opens a page of four. *Company & team* counts the
 * requests waiting on this person's approval, by the same rule the approve
 * button runs.
 */
export async function accountCounts(
  userId: string,
): Promise<{ enquiries: number; saved: number; suppliers: number; company: number }> {
  const [enquiries, saved, suppliers, company] = await Promise.all([
    prisma.enquiry.count({ where: { buyerId: userId } }),
    prisma.savedSearch.count({ where: { userId } }),
    prisma.shortlist.count({ where: { userId } }),
    awaitingCount(userId),
  ]);
  return { enquiries, saved, suppliers, company };
}
