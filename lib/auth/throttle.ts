/**
 * Attempt limits, and the two different reasons for having them.
 *
 * Asking for a code is cheap to the person and costly to us — a WhatsApp
 * authentication message to the UAE is priced per delivery, so a resend button
 * with no cooldown is a direct leak. Getting a code wrong is the opposite: free
 * to us and the only thing standing between a six-digit number and an account.
 *
 * So the two are throttled differently, and both are ours rather than
 * Supabase's. Supabase enforces its own rate limits and does not expose the
 * counter, which means "too many attempts" cannot be a designed state — with a
 * number, and a time it clears — without our own record of what happened.
 *
 * Pure decisions live here. The counting query is in lib/auth/attempts.ts.
 */

export type AuthAttemptKind = "otp_request" | "otp_verify" | "reset_request";

export interface ThrottlePolicy {
  /** Failures inside the window before the door closes. */
  limit: number;
  windowMs: number;
  /** Minimum gap between two of these, regardless of the limit. */
  cooldownMs: number;
}

const MINUTE = 60_000;

export const THROTTLES: Readonly<Record<AuthAttemptKind, ThrottlePolicy>> = {
  /*
   * Five codes an hour, one a minute. The cooldown is the cost control and the
   * limit is the abuse control: without the cooldown, a held-down resend button
   * spends real money; without the limit, a slow script still does.
   */
  otp_request: { limit: 5, windowMs: 60 * MINUTE, cooldownMs: MINUTE },
  /*
   * Five wrong codes in fifteen minutes. Against a six-digit code that leaves
   * a one-in-two-hundred-thousand chance per lockout, and it is loose enough
   * that somebody reading a code off a cracked phone screen is not locked out
   * for a typo.
   */
  otp_verify: { limit: 5, windowMs: 15 * MINUTE, cooldownMs: 0 },
  /*
   * Three reset links an hour. A reset link lands in an inbox, so the cost is
   * somebody else's attention rather than ours.
   */
  reset_request: { limit: 3, windowMs: 60 * MINUTE, cooldownMs: 30_000 },
};

export interface AttemptRecord {
  createdAt: Date;
  succeeded: boolean;
}

export type ThrottleDecision =
  | { allowed: true }
  /** Too soon after the last one. `retryAfterMs` is what the UI counts down. */
  | { allowed: false; reason: "cooldown"; retryAfterMs: number }
  /** The limit is spent. Same shape, longer wait. */
  | { allowed: false; reason: "too_many_attempts"; retryAfterMs: number; limit: number };

/**
 * Decide, from the attempts already on record.
 *
 * `now` is a parameter so the decision is testable and so every check inside
 * one request measures from the same instant.
 *
 * A success clears the count for its identifier: someone who mistyped four
 * times and then got in should not be one typo from a lockout tomorrow.
 */
export function decide(
  kind: AuthAttemptKind,
  attempts: readonly AttemptRecord[],
  now: Date,
  policy: ThrottlePolicy = THROTTLES[kind],
): ThrottleDecision {
  const windowStart = now.getTime() - policy.windowMs;
  const inWindow = attempts
    .filter((a) => a.createdAt.getTime() >= windowStart)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const lastSuccess = inWindow.find((a) => a.succeeded);
  const countable = lastSuccess
    ? inWindow.filter((a) => a.createdAt.getTime() > lastSuccess.createdAt.getTime())
    : inWindow;

  const failures = countable.filter((a) => !a.succeeded);

  if (failures.length >= policy.limit) {
    // The window clears from the oldest failure that still counts.
    const oldest = failures[failures.length - 1]!;
    const clearsAt = oldest.createdAt.getTime() + policy.windowMs;
    return {
      allowed: false,
      reason: "too_many_attempts",
      retryAfterMs: Math.max(0, clearsAt - now.getTime()),
      limit: policy.limit,
    };
  }

  if (policy.cooldownMs > 0) {
    // The cooldown counts every attempt, not only the failures: a resend that
    // succeeded still cost a message.
    const last = countable[0] ?? inWindow[0];
    if (last) {
      const readyAt = last.createdAt.getTime() + policy.cooldownMs;
      if (readyAt > now.getTime()) {
        return { allowed: false, reason: "cooldown", retryAfterMs: readyAt - now.getTime() };
      }
    }
  }

  return { allowed: true };
}

/** Seconds, rounded up. A countdown that shows 0 while still refusing is a bug. */
export function retryAfterSeconds(decision: ThrottleDecision): number {
  return decision.allowed ? 0 : Math.ceil(decision.retryAfterMs / 1000);
}
