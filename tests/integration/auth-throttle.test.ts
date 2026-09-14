import { afterAll, afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { checkAddressThrottle, checkThrottle, recordAttempt, remainingAttempts } from "@/lib/auth/attempts";
import { PASSWORD_ADDRESS_CEILING, THROTTLES } from "@/lib/auth/throttle";

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
  await prisma.authAttempt.deleteMany({ where: { ip: "203.0.113.77" } });
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

describe("board 7a: a wrong password", () => {
  it("locks the password and leaves the code path open", async () => {
    for (let i = 0; i < THROTTLES.password_verify.limit; i += 1) {
      await recordAttempt({ identifier: IDENTIFIER, kind: "password_verify", succeeded: false });
    }
    expect(await checkThrottle(IDENTIFIER, "password_verify")).toMatchObject({
      allowed: false,
      reason: "too_many_attempts",
    });
    // B5: the lockout copy offers a code, so both code kinds must still be open.
    expect(await checkThrottle(IDENTIFIER, "otp_verify")).toEqual({ allowed: true });
    expect(await checkThrottle(IDENTIFIER, "otp_request")).toEqual({ allowed: true });
  });

  it("holds a lock reached slowly for its full fifteen minutes", async () => {
    // Failures fourteen minutes apart end to end: the first has left the
    // fifteen-minute window, and the lock the screen quoted has not run out.
    const now = Date.now();
    const minutesAgo = [16, 12, 8, 4, 2];
    await prisma.authAttempt.createMany({
      data: minutesAgo.map((m) => ({
        identifier: IDENTIFIER,
        kind: "password_verify" as const,
        succeeded: false,
        createdAt: new Date(now - m * 60_000),
      })),
    });
    const decision = await checkThrottle(IDENTIFIER, "password_verify");
    expect(decision).toMatchObject({ allowed: false, reason: "too_many_attempts" });
    if (decision.allowed) throw new Error("unreachable");
    expect(Math.round(decision.retryAfterMs / 60_000)).toBe(13);
  });

  it("counts what is left", async () => {
    await recordAttempt({ identifier: IDENTIFIER, kind: "password_verify", succeeded: false });
    await recordAttempt({ identifier: IDENTIFIER, kind: "password_verify", succeeded: false });
    expect(await remainingAttempts(IDENTIFIER, "password_verify")).toBe(3);
  });

  it("stops one address walking a list of accounts", async () => {
    await prisma.authAttempt.createMany({
      data: Array.from({ length: PASSWORD_ADDRESS_CEILING.limit }, (_, i) => ({
        identifier: `+97150000${String(1000 + i)}`,
        kind: "password_verify" as const,
        succeeded: false,
        ip: "203.0.113.77",
      })),
    });
    expect(await checkAddressThrottle("203.0.113.77", "password_verify")).toMatchObject({
      allowed: false,
      limit: PASSWORD_ADDRESS_CEILING.limit,
    });
    expect(await checkAddressThrottle("203.0.113.78", "password_verify")).toEqual({ allowed: true });
    expect(await checkAddressThrottle(null, "password_verify")).toEqual({ allowed: true });
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
