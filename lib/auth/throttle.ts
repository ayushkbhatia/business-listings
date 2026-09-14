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

export type AuthAttemptKind = "otp_request" | "otp_verify" | "reset_request" | "password_verify";

export interface ThrottlePolicy {
  /** Failures inside the window before the door closes. */
  limit: number;
  windowMs: number;
  /** Minimum gap between two of these, regardless of the limit. */
  cooldownMs: number;
  /**
   * Set for a lockout, as opposed to a rate.
   *
   * A rate clears as its oldest failure leaves the window, which is right for
   * "five codes an hour": the sixth becomes possible as soon as the first is an
   * hour old. A lockout is a sentence the screen says out loud — board 7a's
   * "locked for 15 minutes" — so once `limit` failures land inside one window
   * the door stays shut for `lockMs` from the failure that shut it, even as the
   * earlier failures age out of the window. Otherwise a lock reached slowly
   * would open early, and the number on the screen would be a guess.
   */
  lockMs?: number;
}

const MINUTE = 60_000;

export const THROTTLES: Readonly<Record<AuthAttemptKind, ThrottlePolicy>> = {
  /*
   * Five codes an hour, one every 24 seconds — board 7a `B4`'s resend lock. The
   * cooldown is the cost control and the
   * limit is the abuse control: without the cooldown, a held-down resend button
   * spends real money; without the limit, a slow script still does.
   */
  otp_request: { limit: 5, windowMs: 60 * MINUTE, cooldownMs: 24_000 },
  /*
   * Five wrong codes in fifteen minutes. Against a six-digit code that leaves
   * a one-in-two-hundred-thousand chance per lockout, and it is loose enough
   * that somebody reading a code off a cracked phone screen is not locked out
   * for a typo.
   */
  otp_verify: { limit: 5, windowMs: 15 * MINUTE, cooldownMs: 0, lockMs: 15 * MINUTE },
  /*
   * Three reset links an hour. A reset link lands in an inbox, so the cost is
   * somebody else's attention rather than ours.
   */
  reset_request: { limit: 3, windowMs: 60 * MINUTE, cooldownMs: 30_000 },
  /*
   * Board 7a `B5`. Five wrong passwords, then fifteen minutes — and the code
   * path is untouched, because this is its own kind. A password is the weaker
   * of the two identities here: the lockout screen offers a code as the way
   * through, and a lock that also closed that door would turn a forgotten
   * password into a locked account.
   */
  password_verify: { limit: 5, windowMs: 15 * MINUTE, cooldownMs: 0, lockMs: 15 * MINUTE },
};

/**
 * Wrong passwords from one address, across every account.
 *
 * The per-identifier lockout above stops somebody guessing one account's
 * password. It does nothing against one address trying a leaked password
 * against a thousand accounts, one attempt each — so there is a second ceiling
 * keyed on the address. Loose, because an office or a mobile carrier puts many
 * honest people behind one address, and a lockout that fires on a Monday
 * morning in a free zone is a lockout on the market. Thirty failures in fifteen
 * minutes is not a person mistyping.
 */
export const PASSWORD_ADDRESS_CEILING: ThrottlePolicy = {
  limit: 30,
  windowMs: 15 * MINUTE,
  cooldownMs: 0,
  lockMs: 15 * MINUTE,
};

/**
 * Sign-up answers from one address.
 *
 * Sign-up says when a mobile or an email is already on an account — it is not
 * neutral, because an address you typed is your own and "check your inbox" for
 * a code that will never come is worse. The cost is that it can be asked about
 * addresses one after another, so this caps how many times one network address
 * gets that answer, or any other refusal, in an hour. Recorded against the
 * address and not the identifier typed, so nobody can spend another person's
 * attempts by signing up as them.
 */
export const SIGNUP_ADDRESS_CEILING: ThrottlePolicy = {
  limit: 20,
  windowMs: 60 * MINUTE,
  cooldownMs: 0,
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
 * How far back a decision has to read. A lockout reaches past its window: the
 * failures that shut the door can be a full window older than the failure that
 * shut it, and the door stays shut for `lockMs` after that.
 */
export function horizonMs(policy: ThrottlePolicy): number {
  return policy.windowMs + (policy.lockMs ?? 0);
}

/** Newest first, and only what a success has not already cleared. */
function sinceLastSuccess(
  attempts: readonly AttemptRecord[],
  from: number,
): { countable: AttemptRecord[]; failures: AttemptRecord[] } {
  const recent = attempts
    .filter((a) => a.createdAt.getTime() >= from)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const lastSuccess = recent.find((a) => a.succeeded);
  const countable = lastSuccess
    ? recent.filter((a) => a.createdAt.getTime() > lastSuccess.createdAt.getTime())
    : recent;
  return { countable, failures: countable.filter((a) => !a.succeeded) };
}

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
  const at = now.getTime();

  if (policy.lockMs) {
    const { failures } = sinceLastSuccess(attempts, at - horizonMs(policy));
    // Walk from the newest failure back. The first run of `limit` failures
    // inside one window whose newest is still inside the lock is the lock; an
    // older run would end sooner, so the first one found is the one to report.
    for (let i = 0; i + policy.limit - 1 < failures.length; i += 1) {
      const closer = failures[i]!.createdAt.getTime();
      const lockedUntil = closer + policy.lockMs;
      if (lockedUntil <= at) break;
      const opener = failures[i + policy.limit - 1]!.createdAt.getTime();
      if (closer - opener <= policy.windowMs) {
        return {
          allowed: false,
          reason: "too_many_attempts",
          retryAfterMs: lockedUntil - at,
          limit: policy.limit,
        };
      }
    }
  }

  const { countable, failures } = sinceLastSuccess(attempts, at - policy.windowMs);

  if (!policy.lockMs && failures.length >= policy.limit) {
    // A rate clears from the oldest failure that still counts.
    const clearsAt = failures[failures.length - 1]!.createdAt.getTime() + policy.windowMs;
    return {
      allowed: false,
      reason: "too_many_attempts",
      retryAfterMs: Math.max(0, clearsAt - at),
      limit: policy.limit,
    };
  }

  if (policy.cooldownMs > 0) {
    // The cooldown counts every attempt, not only the failures: a resend that
    // succeeded still cost a message.
    const last =
      countable[0] ??
      attempts
        .filter((a) => a.createdAt.getTime() >= at - policy.windowMs)
        .reduce<AttemptRecord | undefined>(
          (newest, a) => (!newest || a.createdAt > newest.createdAt ? a : newest),
          undefined,
        );
    if (last) {
      const readyAt = last.createdAt.getTime() + policy.cooldownMs;
      if (readyAt > at) {
        return { allowed: false, reason: "cooldown", retryAfterMs: readyAt - at };
      }
    }
  }

  return { allowed: true };
}

/**
 * Attempts left before a lockout, for "3 attempts left" beside a wrong answer.
 *
 * Board 7a's verify states: *attempt counted, remaining attempts stated*. Read
 * from the same record the decision reads, after the failure has been written,
 * so the number is the one the next refusal will enforce.
 */
export function attemptsLeft(
  kind: AuthAttemptKind,
  attempts: readonly AttemptRecord[],
  now: Date,
  policy: ThrottlePolicy = THROTTLES[kind],
): number {
  const { failures } = sinceLastSuccess(attempts, now.getTime() - policy.windowMs);
  return Math.max(0, policy.limit - failures.length);
}

/** Seconds, rounded up. A countdown that shows 0 while still refusing is a bug. */
export function retryAfterSeconds(decision: ThrottleDecision): number {
  return decision.allowed ? 0 : Math.ceil(decision.retryAfterMs / 1000);
}
