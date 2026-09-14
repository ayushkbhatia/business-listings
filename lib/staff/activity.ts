import "server-only";
import { prisma } from "@/lib/db/client";
import { ACTIVITY_WRITE_EVERY_MS } from "./policy";

/**
 * "Last active", measured. Board 4i.
 *
 * One conditional statement: it writes only when the stored time is older than
 * the window, so a staff member clicking through ten screens costs one write,
 * not ten. Called from `requireStaff()` through `after()`, so the page never
 * waits on it, and a failure is logged rather than thrown — a console that 500s
 * because it could not record that somebody opened it would be a strange trade.
 *
 * Not a staff decision, and so not a `staffMutation`: nobody chose the value.
 * `scripts/check-audit-coverage.mts` exempts this module by name for that reason.
 */
export async function recordStaffActivity(userId: string, now: Date = new Date()): Promise<void> {
  const threshold = new Date(now.getTime() - ACTIVITY_WRITE_EVERY_MS);
  try {
    await prisma.user.updateMany({
      where: {
        id: userId,
        OR: [{ staffLastActiveAt: null }, { staffLastActiveAt: { lt: threshold } }],
      },
      data: { staffLastActiveAt: now },
    });
  } catch (cause) {
    console.error("[staff] could not record console activity", {
      cause: cause instanceof Error ? cause.name : "unknown",
    });
  }
}
