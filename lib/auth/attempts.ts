import "server-only";
import { prisma } from "@/lib/db/client";
import { decide, THROTTLES, type AuthAttemptKind, type ThrottleDecision } from "./throttle";

/**
 * The database side of the throttle. The decision itself is in throttle.ts and
 * is pure; this only fetches and records.
 */

/** Only what the window needs. A year of attempts is not read to answer this. */
export async function checkThrottle(
  identifier: string,
  kind: AuthAttemptKind,
  now: Date = new Date(),
): Promise<ThrottleDecision> {
  const attempts = await prisma.authAttempt.findMany({
    where: {
      identifier,
      kind,
      createdAt: { gte: new Date(now.getTime() - THROTTLES[kind].windowMs) },
    },
    select: { createdAt: true, succeeded: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return decide(kind, attempts, now);
}

/**
 * Record what happened.
 *
 * Never throws. A throttle that takes the site down when its own table is
 * unavailable has turned a rate limit into an outage — the attempt itself has
 * already been decided by the time this runs.
 */
export async function recordAttempt(input: {
  identifier: string;
  kind: AuthAttemptKind;
  succeeded: boolean;
  ip?: string | null;
}): Promise<void> {
  try {
    await prisma.authAttempt.create({
      data: {
        identifier: input.identifier,
        kind: input.kind,
        succeeded: input.succeeded,
        ip: input.ip ?? null,
      },
    });
  } catch (cause) {
    console.warn("[auth] could not record an attempt", { kind: input.kind, cause });
  }
}

/**
 * Drop rows past every window.
 *
 * This used to say it was "called from the flow rather than a cron". Nothing
 * called it — not a request path, not a test — and `auth_attempt` grew without
 * bound for it. It is now part of the daily job at `/api/jobs/daily`.
 *
 * `olderThan` is a security parameter and has no default on purpose. The
 * longest window in `THROTTLES` is sixty minutes, so pruning anything newer
 * than that resets a live throttle and hands back the attempts somebody has
 * already spent. The caller picks the cutoff and says why.
 */
export async function pruneAttempts(olderThan: Date): Promise<number> {
  const { count } = await prisma.authAttempt.deleteMany({
    where: { createdAt: { lt: olderThan } },
  });
  return count;
}
