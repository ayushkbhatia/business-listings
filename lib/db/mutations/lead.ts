import "server-only";
import { prisma } from "@/lib/db/client";

/**
 * Stamp the moment a seller first opened a lead.
 *
 * Deliberately not a server action. It takes a businessId, which only a caller
 * that has already resolved the seat can supply honestly — exported from a
 * "use server" module it would be a public endpoint that accepts a businessId
 * from anyone. The page calls it from `after()`, where `cookies()` is not
 * available, which is exactly why the seat cannot be resolved in here.
 *
 * `openedAt` feeds the buyer's tracking page. It is not response time —
 * response time is measured from the first reply, and opening is not a reply.
 */
export async function markLeadOpened(enquiryId: string, businessId: string): Promise<void> {
  await prisma.enquiryRecipient.updateMany({
    where: { enquiryId, businessId, openedAt: null, state: "delivered" },
    data: { state: "opened", openedAt: new Date() },
  });
}
