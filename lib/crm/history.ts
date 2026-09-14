import "server-only";
import { prisma } from "@/lib/db/client";

/**
 * What has been said to this account, for board 4f's account page.
 *
 * Every call on the list lands here, whichever task it worked, and the page is
 * where a *closed down* outcome is seen: the CRM records it and does not delist
 * anybody by itself (board 12d, States).
 */
export async function callHistory(businessId: string, limit = 20) {
  return prisma.callOutcome.findMany({
    where: { businessId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      id: true,
      kind: true,
      signal: true,
      note: true,
      callBackAt: true,
      createdAt: true,
      staff: { select: { id: true, fullName: true } },
    },
  });
}
