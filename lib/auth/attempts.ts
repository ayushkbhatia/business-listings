import "server-only";
import { prisma } from "@/lib/db/client";
import {
  attemptsLeft,
  decide,
  horizonMs,
  PASSWORD_ADDRESS_CEILING,
  THROTTLES,
  type AuthAttemptKind,
  type ThrottleDecision,
  type ThrottlePolicy,
} from "./throttle";

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
      createdAt: { gte: new Date(now.getTime() - horizonMs(THROTTLES[kind])) },
    },
    select: { createdAt: true, succeeded: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
  });
  return decide(kind, attempts, now);
}

/**
 * How many more wrong answers before the door shuts. Board 7a: *attempt
 * counted, remaining attempts stated*. Read after the failure is recorded.
 */
export async function remainingAttempts(
  identifier: string,
  kind: AuthAttemptKind,
  now: Date = new Date(),
): Promise<number> {
  const attempts = await prisma.authAttempt.findMany({
    where: { identifier, kind, createdAt: { gte: new Date(now.getTime() - THROTTLES[kind].windowMs) } },
    select: { createdAt: true, succeeded: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
  });
  return attemptsLeft(kind, attempts, now);
}

/**
 * The per-address ceiling on wrong passwords — see `PASSWORD_ADDRESS_CEILING`.
 *
 * Only failures count, and only this kind. An address with no header to read
 * is not throttled here: refusing every request that arrives without one would
 * lock out whatever sits behind a proxy that strips it, and the per-identifier
 * lockout still holds for those.
 */
export async function checkAddressThrottle(
  ip: string | null | undefined,
  kind: AuthAttemptKind,
  now: Date = new Date(),
  policy: ThrottlePolicy = PASSWORD_ADDRESS_CEILING,
): Promise<ThrottleDecision> {
  if (!ip) return { allowed: true };
  const failures = await prisma.authAttempt.findMany({
    where: {
      ip,
      kind,
      succeeded: false,
      createdAt: { gte: new Date(now.getTime() - horizonMs(policy)) },
    },
    select: { createdAt: true, succeeded: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: policy.limit * 2,
  });
  return decide(kind, failures, now, policy);
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
