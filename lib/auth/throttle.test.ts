import { describe, expect, it } from "vitest";
import {
  attemptsLeft,
  decide,
  PASSWORD_ADDRESS_CEILING,
  retryAfterSeconds,
  THROTTLES,
  type AttemptRecord,
} from "./throttle";

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

  it("holds a resend behind board 7a's 24-second lock, and says how long", () => {
    // The cost control. A held-down resend button spends real money.
    const decision = decide("otp_request", [{ createdAt: ago(20_000), succeeded: true }], NOW);
    expect(decision).toMatchObject({ allowed: false, reason: "cooldown" });
    expect(retryAfterSeconds(decision)).toBe(4);
  });

  it("counts a successful send against the cooldown too", () => {
    // A resend that worked still cost a message.
    expect(decide("otp_request", [{ createdAt: ago(5_000), succeeded: true }], NOW).allowed).toBe(false);
  });

  it("releases once the cooldown has run", () => {
    expect(decide("otp_request", [{ createdAt: ago(24_000), succeeded: false }], NOW))
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

  it("locks for fifteen minutes from the failure that shut the door", () => {
    // Five failures, the newest two minutes ago: thirteen minutes left.
    const decision = decide("otp_verify", failures(5, 3 * MINUTE, 2 * MINUTE), NOW);
    expect(decision).toMatchObject({ allowed: false, reason: "too_many_attempts" });
    expect(retryAfterSeconds(decision)).toBe(13 * 60);
  });

  it("does not open early when a lock was reached slowly", () => {
    // The fifth failure landed fourteen minutes after the first. Sixteen minutes
    // on, the first has left the window — and the lock the screen quoted still
    // has thirteen minutes to run.
    const shutAt = ago(2 * MINUTE);
    const spread: AttemptRecord[] = [14, 10, 6, 2, 0].map((m) => ({
      createdAt: new Date(shutAt.getTime() - m * MINUTE),
      succeeded: false,
    }));
    const decision = decide("otp_verify", spread, NOW);
    expect(decision).toMatchObject({ allowed: false, reason: "too_many_attempts" });
    expect(retryAfterSeconds(decision)).toBe(13 * 60);
  });

  it("opens once the lock has run its fifteen minutes", () => {
    expect(decide("otp_verify", failures(5, 10_000, 15 * MINUTE + 1_000), NOW)).toEqual({ allowed: true });
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
    const decision = decide("otp_request", [{ createdAt: ago(23_500), succeeded: false }], NOW);
    expect(decision.allowed).toBe(false);
    expect(retryAfterSeconds(decision)).toBe(1);
  });
});

describe("a wrong password (board 7a B5)", () => {
  it("locks after five, for fifteen minutes", () => {
    const decision = decide("password_verify", failures(5, 20_000), NOW);
    expect(decision).toMatchObject({ allowed: false, reason: "too_many_attempts", limit: 5 });
    expect(retryAfterSeconds(decision)).toBe(15 * 60);
  });

  it("is a different door from a wrong code", () => {
    // The lockout screen offers a code as the way through. The two kinds never
    // share a count, so the offer is one the backend honours.
    expect(THROTTLES.password_verify).not.toBe(THROTTLES.otp_verify);
    expect(decide("otp_verify", [], NOW)).toEqual({ allowed: true });
  });

  it("states how many attempts are left", () => {
    expect(attemptsLeft("password_verify", failures(2, MINUTE), NOW)).toBe(3);
    expect(attemptsLeft("password_verify", failures(7, MINUTE), NOW)).toBe(0);
    expect(attemptsLeft("otp_verify", failures(4, 20 * MINUTE, 16 * MINUTE), NOW)).toBe(5);
  });
});

describe("wrong passwords from one address", () => {
  it("tolerates an office's worth of typos", () => {
    const decision = decide("password_verify", failures(29, 10_000), NOW, PASSWORD_ADDRESS_CEILING);
    expect(decision).toEqual({ allowed: true });
  });

  it("stops one address walking a list of accounts", () => {
    const decision = decide("password_verify", failures(30, 10_000), NOW, PASSWORD_ADDRESS_CEILING);
    expect(decision).toMatchObject({ allowed: false, reason: "too_many_attempts", limit: 30 });
  });
});
