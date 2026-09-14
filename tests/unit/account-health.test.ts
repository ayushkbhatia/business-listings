import { describe, expect, it } from "vitest";
import { MIN_SAMPLE, measureReplies, replyRate, type RateObservation } from "@/lib/metrics/response-time";
import {
  ACCOUNT_STATES,
  CHURN_RISK_BELOW,
  SLOW_REPLIES_BELOW,
  classifyAccount,
  type AccountFacts,
} from "@/lib/accounts/health";
import { hasAnyFilter, normaliseAccountFilter, pageFrom, parseSearch, toQueryString } from "@/lib/accounts/filter";
import { hasMessage } from "@/lib/i18n";

/**
 * Board 4f — the rules that decide who needs a call, without a database.
 * `tests/integration/account-health.test.ts` holds the query to the same answers.
 */

const NOW = new Date("2026-09-14T08:00:00Z");
const H = 3_600_000;

function obs(hoursAgo: number, replied: boolean, closesInHours: number): RateObservation {
  const deliveredAt = new Date(NOW.getTime() - hoursAgo * H);
  return {
    deliveredAt,
    firstReplyAt: replied ? new Date(deliveredAt.getTime() + H) : null,
    closesAt: new Date(NOW.getTime() + closesInHours * H),
  };
}

describe("B5 — reply rate, measured beside the median", () => {
  it("counts answered over counted", () => {
    const rows = [obs(100, true, -10), obs(90, true, -10), obs(80, false, -10), obs(70, false, -10)];
    expect(replyRate(rows, NOW)).toEqual({ rate: 0.5, sample: 4 });
  });

  it("does not count an unanswered enquiry whose window is still open", () => {
    // The fairness rule effectiveState applies before it says no_response.
    const rows = [obs(100, true, -10), obs(90, true, -10), obs(80, true, -10), obs(2, false, 24)];
    expect(replyRate(rows, NOW)).toEqual({ rate: 1, sample: 3 });
  });

  it("counts an answer the moment it is given, open window or not", () => {
    const rows = [obs(100, false, -10), obs(90, false, -10), obs(2, true, 24)];
    expect(replyRate(rows, NOW)).toEqual({ rate: 1 / 3, sample: 3 });
  });

  it("is null below the same floor the median uses", () => {
    const rows = Array.from({ length: MIN_SAMPLE - 1 }, (_, i) => obs(100 - i, false, -1));
    expect(replyRate(rows, NOW)).toBeNull();
  });

  it("measures both numbers from one set of enquiries", () => {
    const rows = [obs(100, true, -10), obs(90, true, -10), obs(80, true, -10), obs(70, false, -10)];
    const measured = measureReplies(rows, NOW);
    expect(measured.rate).toBe(0.75);
    expect(measured.sample).toBe(4);
    expect(measured.medianMs).toBe(H);
  });
});

const base: AccountFacts = {
  claimStatus: "claimed",
  suspendedAt: null,
  mergedIntoId: null,
  closedAt: null,
  closureRequestedAt: null,
  planId: "pro",
  paying: true,
  replyRate: 0.9,
  upgradeEventAt: null,
};

describe("B1 and the states table — health, derived from the facts", () => {
  it("reads the render's rows", () => {
    expect(classifyAccount({ ...base, replyRate: 0.96 })).toBe("healthy");
    expect(classifyAccount({ ...base, replyRate: 0.62 })).toBe("slow_replies");
    expect(classifyAccount({ ...base, planId: "basic", replyRate: 0.34 })).toBe("churn_risk");
    expect(classifyAccount({ ...base, planId: "basic", replyRate: 0.71, upgradeEventAt: NOW })).toBe("upgrade_candidate");
    expect(classifyAccount({ ...base, claimStatus: "unclaimed", planId: null, paying: false, replyRate: null })).toBe(
      "unclaimed",
    );
  });

  it("puts the threshold exactly where it says", () => {
    expect(classifyAccount({ ...base, replyRate: CHURN_RISK_BELOW })).toBe("slow_replies");
    expect(classifyAccount({ ...base, replyRate: SLOW_REPLIES_BELOW })).toBe("healthy");
  });

  it("does not call a non-paying account at risk — a trial or Free account is slow, not churning", () => {
    expect(classifyAccount({ ...base, paying: false, replyRate: 0.2 })).toBe("slow_replies");
  });

  it("does not read a thin sample as a zero", () => {
    expect(classifyAccount({ ...base, replyRate: null })).toBe("unmeasured");
  });

  it("makes an upgrade candidate only of a plan with somewhere to go", () => {
    expect(classifyAccount({ ...base, planId: "pro", upgradeEventAt: NOW })).toBe("healthy");
    expect(classifyAccount({ ...base, planId: "free", paying: false, upgradeEventAt: NOW })).toBe("healthy");
  });

  it("puts lifecycle ahead of health, closure included (Q2)", () => {
    expect(classifyAccount({ ...base, closureRequestedAt: NOW, replyRate: 0.1 })).toBe("closing");
    expect(classifyAccount({ ...base, suspendedAt: NOW, closureRequestedAt: NOW })).toBe("suspended");
    expect(classifyAccount({ ...base, mergedIntoId: "b2", closedAt: NOW })).toBe("merged");
  });

  it("treats a disputed claim as having no settled owner", () => {
    expect(classifyAccount({ ...base, claimStatus: "disputed" })).toBe("unclaimed");
  });

  it("has a label for every state", () => {
    for (const state of ACCOUNT_STATES) expect(hasMessage(`admin.businesses.health.${state}`), state).toBe(true);
  });
});

describe("the filter a URL can carry", () => {
  it("keeps what it recognises and drops the rest", () => {
    expect(
      normaliseAccountFilter({
        q: "  Gulf   Cool ",
        plan: "pro",
        emirate: "dubai",
        tier: "2",
        health: "churn_risk",
        kind: "services",
        sort: "reply_rate",
      }),
    ).toEqual({ q: "Gulf Cool", plan: "pro", emirate: "dubai", tier: 2, health: "churn_risk", kind: "services", sort: "reply_rate" });
    expect(normaliseAccountFilter({ plan: "PRO; drop", emirate: "mars", tier: "3", health: "fine", sort: "price" })).toEqual({});
  });

  it("writes one canonical string whatever order the keys arrived in", () => {
    const a = toQueryString(normaliseAccountFilter({ health: "churn_risk", plan: "basic" }));
    const b = toQueryString(normaliseAccountFilter({ plan: "basic", health: "churn_risk" }));
    expect(a).toBe(b);
    expect(a).toBe("plan=basic&health=churn_risk");
  });

  it("does not count ordering as a filter, and bounds the page", () => {
    expect(hasAnyFilter({ sort: "reply_rate" })).toBe(false);
    expect(pageFrom({ page: "0" })).toBe(1);
    expect(pageFrom({ page: "abc" })).toBe(1);
    expect(pageFrom({ page: "3" })).toBe(3);
  });
});

describe("B7 — name, licence number or TRN from one box", () => {
  it("reads a name", () => {
    expect(parseSearch("Gulf Cool")).toMatchObject({ name: "Gulf Cool", digits: null, trn: null });
  });

  it("reads a licence number the way it is stored, and the way a caller says it", () => {
    expect(parseSearch("ded 441908")).toMatchObject({ licence: "DED-441908", digits: "441908" });
    expect(parseSearch("441908")).toMatchObject({ licence: "441908", digits: "441908", name: null });
  });

  it("reads fifteen digits as a TRN", () => {
    expect(parseSearch("100 1224 9131 8519")).toMatchObject({ trn: "100122491318519" });
  });

  it("does not suffix-match on a fragment too short to mean a licence", () => {
    expect(parseSearch("DED 12")).toMatchObject({ digits: null, licence: null });
  });
});
