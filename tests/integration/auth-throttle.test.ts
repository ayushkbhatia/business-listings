import { afterAll, afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { checkThrottle, recordAttempt } from "@/lib/auth/attempts";
import { THROTTLES } from "@/lib/auth/throttle";

/**
 * The throttle against a real table.
 *
 * The decision logic is unit-tested in lib/auth/throttle.test.ts against
 * hand-built arrays. This is the other half: that the query fetches the right
 * rows, that the window actually excludes old ones, and that recording never
 * takes the site down.
 *
 * Needs Postgres and nothing else, so it runs everywhere CI runs.
 */
const IDENTIFIER = "+971500000001";

afterEach(async () => {
  await prisma.authAttempt.deleteMany({ where: { identifier: { startsWith: "+9715000000" } } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("checkThrottle", () => {
  it("allows a first attempt", async () => {
    expect(await checkThrottle(IDENTIFIER, "otp_request")).toEqual({ allowed: true });
  });

  it("holds a second code request behind the cooldown", async () => {
    await recordAttempt({ identifier: IDENTIFIER, kind: "otp_request", succeeded: true });
    const decision = await checkThrottle(IDENTIFIER, "otp_request");
    expect(decision).toMatchObject({ allowed: false, reason: "cooldown" });
  });

  it("locks out after the limit and says when it clears", async () => {
    for (let i = 0; i < THROTTLES.otp_verify.limit; i += 1) {
      await recordAttempt({ identifier: IDENTIFIER, kind: "otp_verify", succeeded: false });
    }
    const decision = await checkThrottle(IDENTIFIER, "otp_verify");
    expect(decision).toMatchObject({ allowed: false, reason: "too_many_attempts" });
    if (decision.allowed) throw new Error("unreachable");
    expect(decision.retryAfterMs).toBeGreaterThan(0);
  });

  it("ignores attempts older than the window", async () => {
    const old = new Date(Date.now() - THROTTLES.otp_verify.windowMs - 60_000);
    await prisma.authAttempt.createMany({
      data: Array.from({ length: 10 }, () => ({
        identifier: IDENTIFIER,
        kind: "otp_verify" as const,
        succeeded: false,
        createdAt: old,
      })),
    });
    expect(await checkThrottle(IDENTIFIER, "otp_verify")).toEqual({ allowed: true });
  });

  it("counts each identifier separately", async () => {
    for (let i = 0; i < THROTTLES.otp_verify.limit; i += 1) {
      await recordAttempt({ identifier: IDENTIFIER, kind: "otp_verify", succeeded: false });
    }
    expect(await checkThrottle("+971500000002", "otp_verify")).toEqual({ allowed: true });
  });

  it("counts each kind separately", async () => {
    for (let i = 0; i < THROTTLES.otp_verify.limit; i += 1) {
      await recordAttempt({ identifier: IDENTIFIER, kind: "otp_verify", succeeded: false });
    }
    // Locked out of guessing does not mean locked out of asking for a new one.
    const request = await checkThrottle(IDENTIFIER, "otp_request");
    expect(request).toEqual({ allowed: true });
  });

  it("clears the count after a success", async () => {
    for (let i = 0; i < THROTTLES.otp_verify.limit - 1; i += 1) {
      await recordAttempt({ identifier: IDENTIFIER, kind: "otp_verify", succeeded: false });
    }
    await recordAttempt({ identifier: IDENTIFIER, kind: "otp_verify", succeeded: true });
    await recordAttempt({ identifier: IDENTIFIER, kind: "otp_verify", succeeded: false });
    expect(await checkThrottle(IDENTIFIER, "otp_verify")).toEqual({ allowed: true });
  });
});

describe("recordAttempt", () => {
  it("writes what happened", async () => {
    await recordAttempt({ identifier: IDENTIFIER, kind: "reset_request", succeeded: false, ip: "1.2.3.4" });
    const row = await prisma.authAttempt.findFirstOrThrow({ where: { identifier: IDENTIFIER } });
    expect(row).toMatchObject({ kind: "reset_request", succeeded: false, ip: "1.2.3.4" });
  });

  it("never throws, because a rate limit must not become an outage", async () => {
    // An identifier past the column's limits is the cheapest way to make the
    // insert fail without breaking the connection.
    await expect(
      recordAttempt({ identifier: "x".repeat(100_000), kind: "otp_verify", succeeded: false }),
    ).resolves.toBeUndefined();
  });
});
