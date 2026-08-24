import { describe, expect, it } from "vitest";
import { daysRemaining, filsToAed, perDayFils, prorate } from "@/lib/billing/proration";

const RENEWS = new Date("2026-09-01T00:00:00Z");

describe("criterion 10 — a plan change prorates correctly", () => {
  it("credits the unused days and charges the same days on the new plan", () => {
    // Free → Basic on the 20th, renewing on the 1st: twelve days left.
    const result = prorate({
      fromMonthlyAed: 0,
      toMonthlyAed: 349,
      renewsAt: RENEWS,
      now: new Date("2026-08-20T00:00:00Z"),
    });

    expect(result.daysRemaining).toBe(12);
    expect(result.creditLine.fils).toBe(0);
    // 349 AED over 30 days is 1163 fils a day, floored.
    expect(result.chargeLine.perDayFils).toBe(1163);
    expect(result.chargeLine.fils).toBe(1163 * 12);
    expect(result.netFils).toBe(13_956);
  });

  it("produces a credit on a downgrade, not a charge", () => {
    const result = prorate({
      fromMonthlyAed: 899,
      toMonthlyAed: 349,
      renewsAt: RENEWS,
      now: new Date("2026-08-20T00:00:00Z"),
    });
    expect(result.netFils).toBeLessThan(0);
    // Applied to the next invoice, never paid out. This platform holds no funds.
    expect(result.creditLine.fils).toBeGreaterThan(result.chargeLine.fils);
  });

  it("does not move the renewal date", () => {
    // A change on the 12th swaps what is being paid for over the days that were
    // left. It does not restart the month.
    const result = prorate({
      fromMonthlyAed: 349,
      toMonthlyAed: 899,
      renewsAt: RENEWS,
      now: new Date("2026-08-12T00:00:00Z"),
    });
    expect(result.renewsAt).toBe(RENEWS);
  });

  it("charges nothing on the day of renewal", () => {
    const result = prorate({
      fromMonthlyAed: 349,
      toMonthlyAed: 899,
      renewsAt: RENEWS,
      now: RENEWS,
    });
    expect(result.daysRemaining).toBe(0);
    expect(result.netFils).toBe(0);
  });

  it("never invoices backwards for a subscription past its renewal", () => {
    // Past the renewal date is a billing problem, not a reason to bill in
    // reverse.
    expect(daysRemaining(new Date("2026-09-10T00:00:00Z"), RENEWS)).toBe(0);
  });

  it("floors a part-day rather than charging for it", () => {
    // The direction to be wrong in is the one that favours the seller.
    const almost = new Date(RENEWS.getTime() - (5 * 86_400_000 - 1));
    expect(daysRemaining(almost, RENEWS)).toBe(4);
  });

  it("floors the daily rate, so rounding never favours us", () => {
    // 349 / 30 is 11.6333… dirhams. 1163 fils, not 1164.
    expect(perDayFils(349, 30)).toBe(1163);
    expect(perDayFils(899, 30)).toBe(2996);
    expect(perDayFils(0, 30)).toBe(0);
  });

  it("does not divide by zero on a nonsense period", () => {
    expect(perDayFils(349, 0)).toBe(0);
  });

  it("stays in integers, so no invoice reads 349.00000000004", () => {
    for (const aed of [349, 899, 1, 7, 1200]) {
      for (const days of [1, 7, 13, 29, 30]) {
        const result = prorate({
          fromMonthlyAed: 0,
          toMonthlyAed: aed,
          renewsAt: new Date(RENEWS.getTime()),
          now: new Date(RENEWS.getTime() - days * 86_400_000),
        });
        expect(Number.isInteger(result.netFils)).toBe(true);
      }
    }
  });
});

describe("formatting money", () => {
  it("renders whole fils as dirhams and fils", () => {
    expect(filsToAed(34_900)).toBe("349.00");
    expect(filsToAed(13_956)).toBe("139.56");
    expect(filsToAed(5)).toBe("0.05");
    expect(filsToAed(0)).toBe("0.00");
  });

  it("keeps a credit signed", () => {
    expect(filsToAed(-13_956)).toBe("-139.56");
  });
});
