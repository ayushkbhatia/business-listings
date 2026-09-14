import type { Prisma } from "@/lib/db/generated/client";
import {
  CAP_REFUSED_EVENTS,
  CHURN_RISK_BELOW,
  PAYING_STATUSES,
  SLOW_REPLIES_BELOW,
  UPGRADE_FROM_PLANS,
  upgradeWindowStart,
  type AccountState,
} from "./health";

/**
 * Board 4f — `classifyAccount`, as a `where`.
 *
 * Each state is the classifier's rule written for the database, with the
 * precedence made explicit: a state excludes every state above it in
 * `ACCOUNT_STATES`, so the states partition the table and their counts sum to
 * the listings total. The two are held to the same answer, for every seeded
 * business, by `tests/integration/account-health.test.ts` — the test is what
 * makes it one definition rather than two that agree today.
 *
 * Type-only Prisma import: this builds objects, it does not touch a client.
 */

type Where = Prisma.BusinessWhereInput;

export const PAYING_WHERE: Where = {
  subscription: {
    is: { status: { in: [...PAYING_STATUSES] }, plan: { is: { monthlyPriceAed: { gt: 0 } } } },
  },
};

function upgradeEventWhere(now: Date): Where {
  const since = upgradeWindowStart(now);
  return {
    OR: [
      { missedEnquiries: { some: { createdAt: { gte: since } } } },
      { productEvents: { some: { name: { in: [...CAP_REFUSED_EVENTS] }, createdAt: { gte: since } } } },
    ],
  };
}

const NOT_SUSPENDED: Where = { suspendedAt: null };
const NOT_MERGED: Where = { mergedIntoId: null };
const NOT_CLOSED: Where = { closedAt: null };
const NOT_CLOSING: Where = { closureRequestedAt: null };
const ACTIVE_CLAIMED: Where = { AND: [NOT_SUSPENDED, NOT_MERGED, NOT_CLOSED, NOT_CLOSING, { claimStatus: "claimed" }] };

function churnRisk(): Where {
  return { AND: [ACTIVE_CLAIMED, PAYING_WHERE, { replyRate: { lt: CHURN_RISK_BELOW } }] };
}

function upgradeCandidate(now: Date): Where {
  return {
    AND: [
      ACTIVE_CLAIMED,
      { planId: { in: [...UPGRADE_FROM_PLANS] } },
      upgradeEventWhere(now),
      { NOT: churnRisk() },
    ],
  };
}

export function stateWhere(state: AccountState, now: Date): Where {
  switch (state) {
    case "suspended":
      return { suspendedAt: { not: null } };
    case "merged":
      return { AND: [NOT_SUSPENDED, { mergedIntoId: { not: null } }] };
    case "closed":
      return { AND: [NOT_SUSPENDED, NOT_MERGED, { closedAt: { not: null } }] };
    case "closing":
      return { AND: [NOT_SUSPENDED, NOT_MERGED, NOT_CLOSED, { closureRequestedAt: { not: null } }] };
    case "unclaimed":
      return { AND: [NOT_SUSPENDED, NOT_MERGED, NOT_CLOSED, NOT_CLOSING, { claimStatus: { not: "claimed" } }] };
    case "churn_risk":
      return churnRisk();
    case "upgrade_candidate":
      return upgradeCandidate(now);
    case "slow_replies":
      return {
        AND: [
          ACTIVE_CLAIMED,
          { replyRate: { lt: SLOW_REPLIES_BELOW } },
          { NOT: churnRisk() },
          { NOT: upgradeCandidate(now) },
        ],
      };
    case "unmeasured":
      return { AND: [ACTIVE_CLAIMED, { replyRate: null }, { NOT: upgradeCandidate(now) }] };
    case "healthy":
      return { AND: [ACTIVE_CLAIMED, { replyRate: { gte: SLOW_REPLIES_BELOW } }, { NOT: upgradeCandidate(now) }] };
  }
}
