import { describe, expect, it } from "vitest";
import { decideRate, RATE_POLICIES, retryAfterSeconds, type RatePolicy } from "./policy";

/**
 * The decision, against hand-built arrays.
 *
 * The other half — that the query fetches the right rows and that the window
 * excludes old ones — is `tests/integration/onboarding-claim.test.ts`, which
 * needs Postgres. This file needs nothing, so a change to the arithmetic fails
 * in a second rather than after a container starts.
 */

const NOW = new Date("2026-09-04T10:00:00.000Z");
const POLICY: RatePolicy = { limit: 3, windowMs: 60_000, cooldownMs: 1_000 };

/** `secondsAgo(5)` is a hit five seconds before `NOW`. */
const secondsAgo = (n: number) => new Date(NOW.getTime() - n * 1000);

describe("decideRate", () => {
  it("allows a first request", () => {
    expect(decideRate([], NOW, POLICY)).toEqual({ allowed: true });
  });

  it("allows up to the limit", () => {
    const hits = [secondsAgo(30), secondsAgo(20)];
    expect(decideRate(hits, NOW, POLICY)).toEqual({ allowed: true });
  });

  it("refuses once the window's allowance is spent", () => {
    const hits = [secondsAgo(30), secondsAgo(20), secondsAgo(10)];
    const decision = decideRate(hits, NOW, POLICY);
    expect(decision).toMatchObject({ allowed: false, reason: "too_many", limit: 3 });
  });

  it("clears from the oldest hit that still counts, not from now", () => {
    // Three hits, the oldest 30 seconds into a 60-second window. The wait is
    // the remaining 30 seconds — telling somebody to wait the whole window
    // when they are one request over is a longer wait than the policy asks for.
    const hits = [secondsAgo(30), secondsAgo(20), secondsAgo(10)];
    const decision = decideRate(hits, NOW, POLICY);
    if (decision.allowed) throw new Error("unreachable");
    expect(decision.retryAfterMs).toBe(30_000);
  });

  it("ignores hits older than the window", () => {
    const stale = [secondsAgo(120), secondsAgo(90), secondsAgo(61)];
    expect(decideRate(stale, NOW, POLICY)).toEqual({ allowed: true });
  });

  it("holds a second request behind the cooldown", () => {
    const decision = decideRate([new Date(NOW.getTime() - 200)], NOW, POLICY);
    expect(decision).toMatchObject({ allowed: false, reason: "cooldown" });
    if (decision.allowed) throw new Error("unreachable");
    expect(decision.retryAfterMs).toBe(800);
  });

  it("lets the cooldown expire", () => {
    expect(decideRate([secondsAgo(2)], NOW, POLICY)).toEqual({ allowed: true });
  });

  it("does not order-depend on how the rows arrive", () => {
    const ascending = [secondsAgo(30), secondsAgo(20), secondsAgo(10)];
    const descending = [...ascending].reverse();
    expect(decideRate(descending, NOW, POLICY)).toEqual(decideRate(ascending, NOW, POLICY));
  });

  it("skips the cooldown entirely when the policy has none", () => {
    const noCooldown: RatePolicy = { ...POLICY, cooldownMs: 0 };
    expect(decideRate([new Date(NOW.getTime() - 1)], NOW, noCooldown)).toEqual({ allowed: true });
  });
});

describe("retryAfterSeconds", () => {
  it("is zero when allowed", () => {
    expect(retryAfterSeconds({ allowed: true })).toBe(0);
  });

  it("never counts down to zero while still refusing", () => {
    // A countdown showing 0 beside a control that still says no is a bug the
    // person in front of it cannot distinguish from a broken page.
    expect(
      retryAfterSeconds({ allowed: false, reason: "cooldown", retryAfterMs: 40, limit: 3 }),
    ).toBe(1);
  });

  it("rounds up, so the wait it names is long enough", () => {
    expect(
      retryAfterSeconds({ allowed: false, reason: "too_many", retryAfterMs: 2_400, limit: 3 }),
    ).toBe(3);
  });
});

describe("the shipped policies", () => {
  it("leaves room for a whole office behind one address", () => {
    /*
       Signed out, the caller is an IP, and an IP is a building or a carrier's
       CGNAT pool rather than a person. The limit has to clear what a shared
       address does in a minute, not what one person does. Thirty in five
       minutes was tried and refused real suppliers.
    */
    const { limit, windowMs } = RATE_POLICIES.claim_search;
    expect(limit / (windowMs / 60_000)).toBeGreaterThanOrEqual(60);
  });

  it("still caps a runaway loop", () => {
    // Unbounded is not the alternative to too tight.
    expect(RATE_POLICIES.claim_search.limit).toBeLessThan(1_000);
    expect(RATE_POLICIES.claim_search.windowMs).toBeLessThanOrEqual(15 * 60_000);
  });

  it("puts no cooldown between two claim searches", () => {
    /*
       Deliberate, and it was tried the other way. A one-second cooldown refused
       a legitimate second search from somebody who had mistyped their own trade
       name, and put a full-page refusal in front of them for a query costing
       one indexed lookup. The window limit already caps a held-down Enter key.
    */
    expect(RATE_POLICIES.claim_search.cooldownMs).toBe(0);
  });
});
