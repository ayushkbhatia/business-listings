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
 * Drop rows past every window. Called from the flow rather than a cron: the
 * table is only interesting inside an hour, and a sweep on a fraction of
 * requests keeps it small without another moving part to operate.
 */
export async function pruneAttempts(olderThan: Date): Promise<number> {
  const { count } = await prisma.authAttempt.deleteMany({
    where: { createdAt: { lt: olderThan } },
  });
  return count;
}
