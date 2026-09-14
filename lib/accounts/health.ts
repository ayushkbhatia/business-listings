/**
 * Board 4f — account health, derived.
 *
 * `B1`: health is never stored. Reply rate moves as enquiries close, a plan
 * changes on a renewal date, a closure request lands on a Tuesday — a state
 * written down on Monday is a wrong phone call by Wednesday. So this file holds
 * the rules, and every reader applies them to the facts as they are now:
 * `classifyAccount` for a row already in hand, and `stateWhere` in
 * `./health-where.ts` for the query that finds, counts and filters them.
 *
 * `B4`: **the thresholds live here and nowhere else.** The header chip, the two
 * action panels, the health filter and the badge on each row all read these
 * constants, so "88 at risk" in the chip and 88 rows under the filter are the
 * same query rather than two that happen to agree. `tests/integration/
 * account-health.test.ts` holds the classifier and the query to the same answer
 * for every seeded business.
 *
 * Pure: no database, no Prisma value import. The browser may read it.
 */

/**
 * Under this share of enquiries answered, a paying account is at risk. Board 4f
 * Q3 asks whether 50% is a finding or a round number; it is the board's stated
 * pattern, and it is one constant so the answer changes one line.
 */
export const CHURN_RISK_BELOW = 0.5;

/**
 * Under this, an account is replying slowly enough to call — the warning before
 * churn risk, and the state that makes the board preventive rather than a
 * post-mortem.
 */
export const SLOW_REPLIES_BELOW = 0.75;

/** How recent a ceiling must be to make an account an upgrade candidate. `B6`. */
export const UPGRADE_WINDOW_DAYS = 30;

/**
 * The plans an upgrade candidate is on. Basic, as the board states: a Free
 * account at its cap is recruitment (`12d`'s call list), not an upgrade.
 */
export const UPGRADE_FROM_PLANS = ["basic"] as const;

/**
 * Subscription statuses that are paying. The same pair `lib/billing/revenue.ts`
 * counts as MRR: a trial has paid nothing, and a cancelled account is churn.
 * Paying also needs a plan with a price — `B2`: Free is a plan, not revenue.
 */
export const PAYING_STATUSES = ["active", "past_due"] as const;

/** The telemetry events that record a seller hitting their plan's ceiling. */
export const CAP_REFUSED_EVENTS = ["product_cap_refused", "service_cap_refused"] as const;

/**
 * Every state an account can be in, in precedence order — the first that
 * applies wins. Lifecycle states come first because they change what a call is
 * about: a suspended account is not "slow to reply", and one in its closure
 * window (`11i`, board 4f Q2) is the call an ops lead most wants to make.
 *
 * Upgrade candidate outranks slow replies, as the board draws it: Sharjah Steel
 * at 71% reads *Upgrade candidate*, because a seller who just hit their ceiling
 * is the call with something to offer.
 */
export const ACCOUNT_STATES = [
  "suspended",
  "merged",
  "closed",
  "closing",
  "unclaimed",
  "churn_risk",
  "upgrade_candidate",
  "slow_replies",
  "unmeasured",
  "healthy",
] as const;

export type AccountState = (typeof ACCOUNT_STATES)[number];

export function isAccountState(value: string): value is AccountState {
  return (ACCOUNT_STATES as readonly string[]).includes(value);
}

/** The five the board names as health, plus the honest sixth for a thin sample. */
export const HEALTH_STATES = [
  "churn_risk",
  "upgrade_candidate",
  "slow_replies",
  "unmeasured",
  "healthy",
] as const satisfies readonly AccountState[];

export interface AccountFacts {
  claimStatus: "unclaimed" | "claimed" | "disputed";
  suspendedAt: Date | null;
  mergedIntoId: string | null;
  closedAt: Date | null;
  closureRequestedAt: Date | null;
  planId: string | null;
  /** Whether the subscription is in a paying status on a priced plan. */
  paying: boolean;
  replyRate: number | null;
  /** The most recent ceiling inside the window, or null. */
  upgradeEventAt: Date | null;
}

export function classifyAccount(facts: AccountFacts): AccountState {
  if (facts.suspendedAt) return "suspended";
  if (facts.mergedIntoId) return "merged";
  if (facts.closedAt) return "closed";
  if (facts.closureRequestedAt) return "closing";
  // Disputed has no settled owner either, and no plan a call could be about.
  if (facts.claimStatus !== "claimed") return "unclaimed";

  const rate = facts.replyRate;
  if (facts.paying && rate !== null && rate < CHURN_RISK_BELOW) return "churn_risk";
  if (
    facts.upgradeEventAt !== null &&
    facts.planId !== null &&
    (UPGRADE_FROM_PLANS as readonly string[]).includes(facts.planId)
  ) {
    return "upgrade_candidate";
  }
  if (rate === null) return "unmeasured";
  if (rate < SLOW_REPLIES_BELOW) return "slow_replies";
  return "healthy";
}

export function upgradeWindowStart(now: Date): Date {
  return new Date(now.getTime() - UPGRADE_WINDOW_DAYS * 86_400_000);
}

/** A tone per state, for the badge. Status is never colour alone — the label says it. */
export const STATE_TONE: Record<AccountState, "ok" | "warn" | "bad" | "info" | "neutral"> = {
  healthy: "ok",
  slow_replies: "warn",
  churn_risk: "bad",
  upgrade_candidate: "info",
  unmeasured: "neutral",
  unclaimed: "neutral",
  closing: "warn",
  suspended: "bad",
  closed: "neutral",
  merged: "neutral",
};
