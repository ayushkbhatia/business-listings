import { describe, expect, it } from "vitest";
import {
  ERROR_TEXT_LIMIT,
  RESULT_TEXT_LIMIT,
  boundResult,
  errorText,
  isSummarised,
  messageOf,
  scheduleHeader,
} from "@/lib/jobs/outcome";

/**
 * Standing item 9.5 — what a step's outcome becomes in the record. Two rules:
 * the write can never be what fails, so every value is storable; and the
 * message is read by every staff seat, so what identifies a person or opens a
 * door is masked before it is stored.
 */

describe("a failed step's message", () => {
  it("masks an address, a number, a token and a password, and keeps the rest", () => {
    const text = errorText(
      "Carrier refused jane.doe@example.ae (+971 50 123 4567): Authorization: Bearer sk_live_4f9a.b2 at postgres://postgres:hunter2@db.internal:5432/app",
    );
    expect(text).toBe(
      "Carrier refused [email] ([phone]): Authorization: Bearer [secret] at postgres://postgres:[secret]@db.internal:5432/app",
    );
  });

  it("leaves ids, counts and durations alone, because they are what the message is kept for", () => {
    const message = "Invalid `prisma.subscription.update()` invocation: row 6f1c2b9e-0d4a-4e7b-9c1f-3a2b1c0d9e8f timed out after 300000 ms on attempt 2";
    expect(errorText(message)).toBe(message);
  });

  it("is never longer than the column allows, and says it was cut", () => {
    const text = errorText("x".repeat(ERROR_TEXT_LIMIT * 3));
    expect(text).toHaveLength(ERROR_TEXT_LIMIT);
    expect(text.endsWith("…")).toBe(true);
  });

  it("is never empty, because a failed row needs a reason", () => {
    expect(errorText("   ")).toBe("(no message)");
  });

  it("reads a thrown value that is not an Error", () => {
    expect(messageOf(new Error("boom"))).toBe("boom");
    expect(messageOf("plain")).toBe("plain");
    expect(messageOf(42)).toBe("42");
  });
});

describe("what a step returned", () => {
  it("keeps nothing for nothing", () => {
    expect(boundResult(undefined)).toBe(null);
    expect(boundResult(null)).toBe(null);
  });

  it("keeps a count as it came, zero included — zero is an answer", () => {
    // `expireInvites` returns a bare number.
    expect(boundResult(0)).toBe(0);
    expect(boundResult({ pruned: 41, olderThan: new Date("2026-09-23T08:23:29.027Z") })).toEqual({
      pruned: 41,
      olderThan: "2026-09-23T08:23:29.027Z",
    });
  });

  it("makes storable what JSON would throw on or drop", () => {
    expect(boundResult({ big: 10n, map: new Map([["a", 1]]), set: new Set(["x"]), error: new TypeError("no") })).toEqual({
      big: "10",
      map: { a: 1 },
      set: ["x"],
      error: { name: "TypeError", message: "no" },
    });
    const cycle: Record<string, unknown> = { a: 1 };
    cycle["self"] = cycle;
    expect(boundResult(cycle)).toEqual({ unserialisable: true });
  });

  it("summarises a result too long to keep, and says so", () => {
    // A night on which 400 licences lapse: `sweepExpiredLicences` lists each one.
    const dropped = Array.from({ length: 400 }, (_, index) => ({ slug: `business-${index}`, from: 2, expiredOn: "2026-09-20" }));
    const result = boundResult({ expired: 400, dropped });
    expect(result).toEqual({ expired: 400, dropped: 400, _summarised: true });
    expect(isSummarised(result)).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(RESULT_TEXT_LIMIT);
  });

  it("falls back to its size when even the summary is too long", () => {
    const wide = Object.fromEntries(Array.from({ length: 2_000 }, (_, index) => [`key_${index}`, index]));
    const result = boundResult(wide);
    expect(result).toMatchObject({ _summarised: true });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(RESULT_TEXT_LIMIT);
  });

  it("does not call an ordinary result summarised", () => {
    expect(isSummarised(boundResult({ considered: 6, renewed: 0 }))).toBe(false);
    expect(isSummarised(null)).toBe(false);
  });
});

describe("the schedule header", () => {
  it("keeps a cron expression and nothing else", () => {
    expect(scheduleHeader("23 20 * * *")).toBe("23 20 * * *");
    expect(scheduleHeader(" 42 * * * * ")).toBe("42 * * * *");
    expect(scheduleHeader("*/5 1-3 * * 1,3")).toBe("*/5 1-3 * * 1,3");
    expect(scheduleHeader("<script>alert(1)</script>")).toBe(null);
    expect(scheduleHeader("1 ".repeat(40))).toBe(null);
    expect(scheduleHeader(null)).toBe(null);
    expect(scheduleHeader("")).toBe(null);
  });
});
