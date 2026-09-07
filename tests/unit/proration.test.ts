import { describe, expect, it } from "vitest";
import { daysRemaining, filsToAed, perDayFils, prorate, vatOn } from "@/lib/billing/proration";

const RENEWS = new Date("2026-09-01T00:00:00Z");

describe("criterion 10 — a plan change prorates correctly", () => {
  it("credits the unused days and charges the same days on the new plan", () => {
    // Free → Basic on the 20th, renewing on the 1st: twelve days left.
    const result = prorate({
      fromPeriodAed: 0,
      toPeriodAed: 349,
      periodDays: 30,
      renewsAt: RENEWS,
      now: new Date("2026-08-20T00:00:00Z"),
    });

    expect(result.daysRemaining).toBe(12);
    expect(result.creditLine.fils).toBe(0);
    // 349 AED over 30 days is 1163 fils a day, floored — but the line is not
    // that times twelve. It is one division over the whole span, rounded once:
    // 349 × 12/30 = 139.60 exactly. Multiplying a floored day rate gives 139.56,
    // and the four-fil gap is the flooring remainder times the day count.
    expect(result.chargeLine.perDayFils).toBe(1163);
    expect(result.chargeLine.fils).toBe(13_960);
    expect(result.netFils).toBe(13_960);
  });

  it("produces a credit on a downgrade, not a charge", () => {
    const result = prorate({
      fromPeriodAed: 899,
      toPeriodAed: 349,
      periodDays: 30,
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
      fromPeriodAed: 349,
      toPeriodAed: 899,
      periodDays: 30,
      renewsAt: RENEWS,
      now: new Date("2026-08-12T00:00:00Z"),
    });
    expect(result.renewsAt).toBe(RENEWS);
  });

  it("charges nothing on the day of renewal", () => {
    const result = prorate({
      fromPeriodAed: 349,
      toPeriodAed: 899,
      periodDays: 30,
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
          fromPeriodAed: 0,
          toPeriodAed: aed,
          periodDays: 30,
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

describe("board 3m — the worked example, to the fil", () => {
  /*
   * The spec prints this arithmetic and the invoice list carries its answer as
   * `BL-INV-18790`. Both boards had `234.00` and `−77.50` for the same 24 days,
   * which is the third correction on the pair; this is the sum they should have
   * shown, and it is the one number a seller can check by hand.
   *
   *   Pro, 24 of 31 days      299 × 24/31 =  231.48
   *   Basic credit, 24 days    99 × 24/31 = − 76.65
   *   VAT 5% on 154.83                    =    7.74
   *   Due now                             =  162.57
   */
  const CYCLE_END = new Date("2026-06-14T00:00:00Z");
  const UPGRADED_ON = new Date("2026-05-21T00:00:00Z");

  const result = prorate({
    fromPeriodAed: 99,
    toPeriodAed: 299,
    periodDays: 31,
    renewsAt: CYCLE_END,
    now: UPGRADED_ON,
  });

  it("counts 24 of 31 days", () => {
    expect(result.daysRemaining).toBe(24);
    expect(result.chargeLine.days).toBe(24);
  });

  it("charges 231.48 for the days left on Pro", () => {
    expect(filsToAed(result.chargeLine.fils)).toBe("231.48");
  });

  it("credits 76.65 for the unused days on Basic", () => {
    // Rounds up, from 76.6451. Flooring gives 76.64 and disagrees with the
    // document the seller keeps by a fil.
    expect(filsToAed(result.creditLine.fils)).toBe("76.65");
  });

  it("puts VAT on its own line and totals 162.57 incl. VAT", () => {
    expect(filsToAed(result.netFils)).toBe("154.83");
    expect(filsToAed(result.vatFils)).toBe("7.74");
    expect(filsToAed(result.dueFils)).toBe("162.57");
  });
});

describe("vatOn", () => {
  it("rounds once, per invoice", () => {
    // 1,699.00 ex-VAT is the subtotal on BL-INV-20418.
    expect(vatOn(169_900)).toBe(8_495);
    expect(vatOn(169_900) + 169_900).toBe(178_395);
  });

  it("mirrors on a credit note rather than drifting a fil", () => {
    // Math.round(-0.5) is -0 while Math.round(0.5) is 1, so a naive round makes
    // a correction that does not cancel the thing it corrects.
    const net = 15_483;
    expect(vatOn(-net)).toBe(-vatOn(net));
  });

  it("honours a stored rate rather than assuming today's", () => {
    expect(vatOn(100_000, 0.05)).toBe(5_000);
    expect(vatOn(100_000, 0)).toBe(0);
  });
});
