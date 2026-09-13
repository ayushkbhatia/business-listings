import "server-only";
import { prisma } from "@/lib/db/client";

/**
 * Board `11i` build note `B7` — everyone signed out, including the owner.
 *
 * ## Why SQL and not the admin API
 *
 * Supabase's admin client can sign out a session only by that session's own
 * JWT (`auth.admin.signOut(jwt)`); there is no by-user-id call. What GoTrue does
 * when it logs a user out everywhere is delete their rows from `auth.sessions`,
 * which cascades to `auth.refresh_tokens` — so that is what this does, as the
 * `postgres` role Prisma already connects as. `getActor` calls `getUser()` on
 * every request, and GoTrue answers `session_not_found` for an access token
 * whose session is gone, so the cookie stops working on the next page load
 * rather than when it happens to expire.
 *
 * ## This is the second door, not the first
 *
 * The seat is revoked in the database before this runs: `businessId` is nulled
 * and `getActor` reads `businessId` from the profile row on every request, so a
 * revoked seat opens nothing even with a live session. Ending the session is
 * what makes "signed out" literally true.
 *
 * ## Where there is no auth schema
 *
 * A per-worktree database has no `auth` schema — Supabase keeps it in the main
 * `postgres` database. Rather than throw, this reports `null`, which callers
 * record as *not measured*. Production always has the table, and the result is
 * returned so a test against a database that has it can assert the count.
 */
export async function endSessions(userIds: readonly string[]): Promise<number | null> {
  if (userIds.length === 0) return 0;

  const [present] = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT to_regclass('auth.sessions') IS NOT NULL AS "exists"
  `;
  if (!present?.exists) return null;

  try {
    return await prisma.$executeRaw`
      DELETE FROM auth.sessions WHERE user_id = ANY(${[...userIds]}::uuid[])
    `;
  } catch (cause) {
    // The seats are already revoked; a failure here leaves a session that can
    // open nothing. Loud, because it should not happen, but not fatal.
    console.error("[closure] could not end sessions", { count: userIds.length, cause });
    return null;
  }
}
