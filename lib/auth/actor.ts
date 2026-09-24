import "server-only";
import { prisma } from "@/lib/db/client";
import { isRole, type Actor } from "./roles";

/**
 * The actor behind a user id, read from the record.
 *
 * For a service that is handed an id rather than a session. `createEnquiry`,
 * `acceptQuote` and `createReview` each take a `buyerId`, and their callers
 * resolve it two ways — a session, or the claim token a buyer with no account
 * carries in their link. What that person may do is a property of the person,
 * not of how they proved who they are, so the service asks it here rather than
 * trusting each caller to have asked: a caller cannot hand in roles, only an
 * id, and the record decides the rest. That is what makes an `assertCan*` in
 * the service cover every caller, the tests included.
 *
 * It decides what, never who. The id must already be the caller's own — the
 * same contract every one of those services has always had for the ownership
 * checks they run against it.
 *
 * Read the way `getActor` reads a session: roles from the profile row, never
 * from a claim. A provisional identity comes back marked and holding no role,
 * whatever its row says; `can()` answers it from the matrix. A suspended
 * account, and an id with no row, come back as an actor holding nothing — board
 * 7a `B7`, "a suspended account has no actor", on the one path that never saw a
 * session to refuse. Never null, so a guard is always the thing that says no,
 * and says it the same way.
 */
export async function actorFor(userId: string): Promise<Actor> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      roles: true,
      businessId: true,
      branchId: true,
      buyerCompanyId: true,
      isProvisional: true,
      suspendedAt: true,
    },
  });

  if (!user || user.suspendedAt) return { id: userId, roles: [] };
  if (user.isProvisional) return { id: userId, roles: [], provisional: true };

  return {
    id: userId,
    roles: user.roles.filter(isRole),
    // Absent rather than null, as `getActor` builds them: a scope check reads the absence.
    ...(user.businessId ? { businessId: user.businessId } : {}),
    ...(user.branchId ? { branchId: user.branchId } : {}),
    ...(user.buyerCompanyId ? { buyerCompanyId: user.buyerCompanyId } : {}),
  };
}
