import { describe, expect, it } from "vitest";
import { decide, retryAfterSeconds, THROTTLES, type AttemptRecord } from "./throttle";

const NOW = new Date("2026-08-24T12:00:00+04:00");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MINUTE = 60_000;

function failures(count: number, spacingMs: number, offsetMs = 0): AttemptRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    createdAt: ago(offsetMs + i * spacingMs),
    succeeded: false,
  }));
}

describe("asking for a code", () => {
  it("allows the first one", () => {
    expect(decide("otp_request", [], NOW)).toEqual({ allowed: true });
  });

  it("holds a resend behind a cooldown, and says how long", () => {
    // The cost control. A held-down resend button spends real money.
    const decision = decide("otp_request", [{ createdAt: ago(20_000), succeeded: true }], NOW);
    expect(decision).toMatchObject({ allowed: false, reason: "cooldown" });
    expect(retryAfterSeconds(decision)).toBe(40);
  });

  it("counts a successful send against the cooldown too", () => {
    // A resend that worked still cost a message.
    expect(decide("otp_request", [{ createdAt: ago(5_000), succeeded: true }], NOW).allowed).toBe(false);
  });

  it("releases once the cooldown has run", () => {
    expect(decide("otp_request", [{ createdAt: ago(61_000), succeeded: false }], NOW))
      .toEqual({ allowed: true });
  });

  it("closes the door at the limit and names it", () => {
    const decision = decide("otp_request", failures(5, 2 * MINUTE, 90_000), NOW);
    expect(decision).toMatchObject({ allowed: false, reason: "too_many_attempts", limit: 5 });
  });
});

describe("submitting a code", () => {
  it("has no cooldown — a typo should be retryable at once", () => {
    expect(decide("otp_verify", [{ createdAt: ago(1_000), succeeded: false }], NOW))
      .toEqual({ allowed: true });
  });

  it("locks out after five wrong codes", () => {
    const decision = decide("otp_verify", failures(5, MINUTE), NOW);
    expect(decision).toMatchObject({ allowed: false, reason: "too_many_attempts", limit: 5 });
  });

  it("counts from the oldest failure still in the window, not from now", () => {
    // Five failures, the oldest 14 minutes ago, a 15 minute window: one more
    // minute and the oldest drops out.
    const decision = decide("otp_verify", failures(5, 3 * MINUTE, 2 * MINUTE), NOW);
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error("unreachable");
    expect(retryAfterSeconds(decision)).toBe(60);
  });

  it("forgets failures older than the window", () => {
    expect(decide("otp_verify", failures(20, MINUTE, 16 * MINUTE), NOW)).toEqual({ allowed: true });
  });
});

describe("a success clears the slate", () => {
  it("does not count failures from before the last success", () => {
    // Four typos and then in. That should not leave somebody one typo from a
    // lockout for the rest of the window.
    const attempts: AttemptRecord[] = [
      ...failures(4, MINUTE, 5 * MINUTE),
      { createdAt: ago(4 * MINUTE), succeeded: true },
      { createdAt: ago(MINUTE), succeeded: false },
    ];
    expect(decide("otp_verify", attempts, NOW)).toEqual({ allowed: true });
  });

  it("still counts failures since the last success", () => {
    const attempts: AttemptRecord[] = [
      { createdAt: ago(10 * MINUTE), succeeded: true },
      ...failures(5, 30_000, MINUTE),
    ];
    expect(decide("otp_verify", attempts, NOW)).toMatchObject({ reason: "too_many_attempts" });
  });
});

describe("the policies themselves", () => {
  it("throttles asking and answering differently, because the risks differ", () => {
    expect(THROTTLES.otp_request.cooldownMs).toBeGreaterThan(0);
    expect(THROTTLES.otp_verify.cooldownMs).toBe(0);
  });

  it("rounds a retry up, so a countdown never shows zero while still refusing", () => {
    const decision = decide("otp_request", [{ createdAt: ago(59_500), succeeded: false }], NOW);
    expect(decision.allowed).toBe(false);
    expect(retryAfterSeconds(decision)).toBe(1);
  });
});
