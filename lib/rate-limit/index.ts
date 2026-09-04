import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { prisma } from "@/lib/db/client";
import {
  decideRate,
  RATE_POLICIES,
  type RateBucket,
  type RateDecision,
} from "./policy";

/**
 * The database side of the rate limiter. The decision itself is pure and lives
 * in `./policy`.
 *
 * Postgres rather than memory. A module-level Map is one instance's opinion,
 * and on a platform that runs each request wherever there is capacity that is a
 * limiter which forgets what it counted the moment traffic spreads out — which
 * is exactly when a limit matters. One indexed read on a narrow table is a
 * small price beside the search it is protecting, which is itself a database
 * query.
 */

export { RATE_POLICIES, retryAfterSeconds, type RateDecision, type RateBucket } from "./policy";

/**
 * Who is asking, as a digest.
 *
 * The signed-in actor where there is one, so a shared office IP does not throttle
 * a whole company down to one person's allowance; the forwarded address
 * otherwise, because board 2a's search runs before anybody has an account.
 *
 * Hashed, salted and never stored raw. This table exists to count, and an
 * address kept in order to count is an address kept for no reason once the
 * window has passed. The salt keeps the digest from being a rainbow table away
 * from the address it came from — IPv4 has four billion values and a bare
 * SHA-256 of one is reversible in seconds.
 *
 * `unknown` when there is no address to read. A proxy that strips the header
 * puts every caller in one bucket, which is the safe side to be wrong on: a
 * shared limit still limits, whereas a per-request random key would be no limit
 * at all.
 */
export async function requesterKey(actorId?: string | null): Promise<string> {
  if (actorId) return digest(`actor:${actorId}`);

  const store = await headers();
  const forwarded = store.get("x-forwarded-for");
  const address =
    forwarded?.split(",")[0]?.trim() || store.get("x-real-ip")?.trim() || "unknown";
  return digest(`ip:${address}`);
}

function digest(value: string): string {
  const salt = process.env["RATE_LIMIT_SALT"] ?? process.env["AUTH_HOOK_SECRET"] ?? "";
  return createHash("sha256").update(`${salt}:${value}`).digest("hex").slice(0, 32);
}

/**
 * Read the window and decide.
 *
 * Never throws. A limiter that takes a page down when its own table is
 * unavailable has turned a cost control into an outage, and the thing it
 * guards — a public search over public records — is not worth that trade.
 */
export async function checkRate(
  bucket: RateBucket,
  identifier: string,
  now: Date = new Date(),
): Promise<RateDecision> {
  const policy = RATE_POLICIES[bucket];
  try {
    const hits = await prisma.rateLimitHit.findMany({
      where: {
        bucket,
        identifier,
        createdAt: { gte: new Date(now.getTime() - policy.windowMs) },
      },
      select: { createdAt: true },
      orderBy: { createdAt: "desc" },
      take: policy.limit + 1,
    });
    return decideRate(
      hits.map((hit) => hit.createdAt),
      now,
      policy,
    );
  } catch (cause) {
    console.warn("[rate-limit] could not read the window", { bucket, cause });
    return { allowed: true };
  }
}

/** Record one. Never throws, for the same reason `checkRate` does not. */
export async function recordHit(bucket: RateBucket, identifier: string): Promise<void> {
  try {
    await prisma.rateLimitHit.create({ data: { bucket, identifier } });
  } catch (cause) {
    console.warn("[rate-limit] could not record a hit", { bucket, cause });
  }
}

/**
 * Drop rows past every window.
 *
 * `olderThan` has no default on purpose, the same as `pruneAttempts`: pruning
 * anything newer than the longest window in `RATE_POLICIES` hands back an
 * allowance somebody has already spent. The caller picks the cutoff and says
 * why. Part of the daily job.
 */
export async function pruneRateLimitHits(olderThan: Date): Promise<number> {
  const { count } = await prisma.rateLimitHit.deleteMany({
    where: { createdAt: { lt: olderThan } },
  });
  return count;
}

/** The longest window any bucket counts over. The floor for a prune cutoff. */
export const LONGEST_RATE_WINDOW_MS = Math.max(
  ...Object.values(RATE_POLICIES).map((policy) => policy.windowMs),
);
