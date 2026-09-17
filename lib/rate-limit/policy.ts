/**
 * A window, a limit, and a cooldown. The pure half of the rate limiter.
 *
 * Deliberately not `lib/auth/throttle.ts`, which looks similar and means
 * something else. That one throttles *attempts* at getting in, so a success
 * clears the count — somebody who mistyped four codes and then got in should
 * not be one typo from a lockout tomorrow. A search has no success or failure
 * to clear against: every request costs the same query whether or not it found
 * anything, and a search that found the right listing is exactly as expensive
 * as one that did not. Folding the two together would mean a limiter with a
 * `succeeded` flag that one caller always passes `false`, which is a worse way
 * of writing two functions.
 *
 * Counting lives in `lib/rate-limit/index.ts`; this file takes the rows and
 * decides, so the decision is testable without a database.
 */

export interface RatePolicy {
  /** Requests inside the window before the door closes. */
  limit: number;
  windowMs: number;
  /** Minimum gap between two requests, regardless of the limit. */
  cooldownMs: number;
}

export type RateDecision =
  | { allowed: true }
  /** Too soon after the last one. */
  | { allowed: false; reason: "cooldown"; retryAfterMs: number; limit: number }
  /** The window's allowance is spent. Same shape, longer wait. */
  | { allowed: false; reason: "too_many"; retryAfterMs: number; limit: number };

const MINUTE = 60_000;

/**
 * The buckets, and the reasoning for each number.
 *
 * `claim_search` is board 2a, and the number is set by who shares a bucket
 * rather than by what one person does.
 *
 * Signed out — which is how that screen is normally met — the caller is an IP
 * address, and an IP address is not a person. It is an office behind one NAT,
 * or a mobile carrier's CGNAT pool with thousands of subscribers behind it.
 * Thirty searches in five minutes was tried and is wrong for that reason: it is
 * generous for one person and stingy for a building, and the failure it
 * produces is a real supplier told to come back later.
 *
 * So the ceiling is set where it stops the thing it is actually for. The search
 * reads the public licence register one indexed query at a time; the risk is
 * somebody walking the whole set, and forty-one thousand records at two a
 * second is most of a day's work for data that is public anyway. A hundred and
 * twenty a minute never touches an office and still caps a runaway loop.
 *
 * **No cooldown**, and that is a decision rather than a default. A cooldown was
 * tried and removed: it refused a legitimate second search a second after the
 * first, which is exactly what somebody does when they mistype their own trade
 * name, and it put a full-page refusal in front of them for a query that costs
 * one indexed lookup.
 *
 * A signed-in caller is keyed on their own id instead, so one person on the
 * office network cannot spend the building's allowance.
 *
 * This is a cost control, not a secret: the refusal says when it clears rather
 * than pretending the search broke.
 */
export const RATE_POLICIES = {
  claim_search: { limit: 120, windowMs: MINUTE, cooldownMs: 0 },
  /*
     Board 11i. The reversal link in a closure email is reachable without a
     session and takes a secret. The secret is 32 random bytes, so the limit is
     not what keeps it safe; it is what keeps a script hammering the endpoint
     from costing nothing. Ten a minute is far more than an owner pressing one
     button, and still refuses a loop.
  */
  closure_reopen: { limit: 10, windowMs: MINUTE, cooldownMs: 0 },
  /*
     Board `1d` amendment. A contact lead is three fields and a supplier's
     landline, and inserting one is the only write on that path a script could
     repeat to walk the directory's numbers — a returning visitor's reveal needs
     a lead on that listing already. Twenty new listings an hour is more than a
     buyer compares in a sitting and still refuses a loop. Keyed on the account
     where there is one, so an office behind one address is not one buyer.
  */
  contact_lead: { limit: 20, windowMs: 60 * MINUTE, cooldownMs: 0 },
  /*
     Board `4h`. The storefront's *Report this listing*, which a signed-out
     visitor may use — the whole point of it is that the person who found the
     wrong telephone number does not have an account.

     That makes it the one write on the public side with no session behind it,
     so the limit is what stands between the moderation queue and a script. Six
     an hour is more than anybody reports in a sitting and far less than it
     takes to bury a queue; the cooldown stops the double-submit that a slow
     page produces, which here would file the same complaint twice and cost a
     moderator the second read.

     Keyed on the account where there is one, so an office behind one address is
     not one reporter.
  */
  listing_report: { limit: 6, windowMs: 60 * MINUTE, cooldownMs: 20_000 },
} as const satisfies Record<string, RatePolicy>;

export type RateBucket = keyof typeof RATE_POLICIES;

/**
 * Decide, from the hits already on record.
 *
 * `now` is a parameter so every check inside one request measures from the same
 * instant, and so the decision can be tested without waiting for a clock.
 */
export function decideRate(
  hits: readonly Date[],
  now: Date,
  policy: RatePolicy,
): RateDecision {
  const windowStart = now.getTime() - policy.windowMs;
  const inWindow = hits
    .filter((at) => at.getTime() >= windowStart)
    .sort((a, b) => b.getTime() - a.getTime());

  if (inWindow.length >= policy.limit) {
    // The window clears from the oldest hit that still counts, not from now:
    // telling somebody to wait the whole window when they are one request over
    // is a longer wait than the policy actually asks for.
    const oldest = inWindow[inWindow.length - 1]!;
    return {
      allowed: false,
      reason: "too_many",
      retryAfterMs: Math.max(0, oldest.getTime() + policy.windowMs - now.getTime()),
      limit: policy.limit,
    };
  }

  const last = inWindow[0];
  if (policy.cooldownMs > 0 && last) {
    const readyAt = last.getTime() + policy.cooldownMs;
    if (readyAt > now.getTime()) {
      return {
        allowed: false,
        reason: "cooldown",
        retryAfterMs: readyAt - now.getTime(),
        limit: policy.limit,
      };
    }
  }

  return { allowed: true };
}

/** Seconds, rounded up. A countdown showing 0 while still refusing is a bug. */
export function retryAfterSeconds(decision: RateDecision): number {
  return decision.allowed ? 0 : Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
}
