import { describe, expect, it } from "vitest";
import {
  advance,
  anchorDayOf,
  monthlyValueFils,
  monthsFree,
  offersAnnual,
  periodDays,
  periodPriceAed,
  type TermPlan,
} from "@/lib/billing/period";
import { perDayFils, prorate } from "@/lib/billing/proration";

/**
 * The period arithmetic, which every money path in billing divides by.
 *
 * Kept away from the database on purpose. A divisor that is wrong by a factor
 * of twelve is not the kind of thing to discover in an integration test, and
 * calendar arithmetic has more edges than any fixture would exercise.
 */

const FREE: TermPlan = { monthlyPriceAed: 0, annualMonthsCharged: null };
const BASIC: TermPlan = { monthlyPriceAed: 349, annualMonthsCharged: 10 };
const PRO: TermPlan = { monthlyPriceAed: 899, annualMonthsCharged: 10 };
/** A paid plan we have chosen not to sell by the year. */
const MONTHLY_ONLY: TermPlan = { monthlyPriceAed: 199, annualMonthsCharged: null };

const utc = (iso: string) => new Date(iso);

describe("what a period costs", () => {
  it("charges a month for a month and ten months for a year", () => {
    expect(periodPriceAed(PRO, "monthly")).toBe(899);
    expect(periodPriceAed(PRO, "annual")).toBe(8_990);
    expect(periodPriceAed(BASIC, "annual")).toBe(3_490);
  });

  /*
     A plan we do not sell by the year has no yearly price, and returning zero
     would be worse than throwing: a free subscription that renews for ever,
     minted by a caller that asked the wrong question.
  */
  it("refuses to price a year on a plan that has none", () => {
    expect(() => periodPriceAed(MONTHLY_ONLY, "annual")).toThrow(/not sold annually/i);
    expect(periodPriceAed(MONTHLY_ONLY, "monthly")).toBe(199);
  });

  it("knows which plans can be bought by the year", () => {
    expect(offersAnnual(PRO)).toBe(true);
    expect(offersAnnual(MONTHLY_ONLY)).toBe(false);
    // Free has a null discount and a zero price, and either alone is enough.
    expect(offersAnnual(FREE)).toBe(false);
  });

  it("states the discount as two months", () => {
    expect(monthsFree(PRO)).toBe(2);
    expect(monthsFree(MONTHLY_ONLY)).toBe(0);
  });
});

describe("what a subscription is worth a month", () => {
  it("is the list price on a monthly term", () => {
    expect(monthlyValueFils(PRO, "monthly")).toBe(89_900);
    expect(monthlyValueFils(BASIC, "monthly")).toBe(34_900);
  });

  /*
     The number `reconcile()` depends on. An annual Pro account pays 8,990 once
     a year, which is 749.17 a month — ten twelfths of the list price. `mrrNow`
     and `recordMovement` both read this function so the live sum and the ledger
     cannot derive it differently.
  */
  it("is ten twelfths of the list price on an annual term", () => {
    expect(monthlyValueFils(PRO, "annual")).toBe(74_917);
    expect(monthlyValueFils(BASIC, "annual")).toBe(29_083);
  });

  it("is always less than the monthly figure, which is what a discount means", () => {
    for (const plan of [BASIC, PRO]) {
      expect(monthlyValueFils(plan, "annual")).toBeLessThan(monthlyValueFils(plan, "monthly"));
    }
  });

  it("falls back to the monthly figure rather than throwing, so a screen never blanks", () => {
    // Unlike `periodPriceAed`, this is read by revenue screens rather than by a
    // charge. A plan with no annual price cannot have an annual subscription,
    // and if one somehow exists the honest report is the list price rather than
    // a crashed dashboard.
    expect(monthlyValueFils(MONTHLY_ONLY, "annual")).toBe(19_900);
  });
});

describe("advancing a period", () => {
  it("adds a calendar month, not thirty days", () => {
    // Thirty days from 1 February is 3 March. A month is a month.
    expect(advance(utc("2026-02-01T09:00:00Z"), "monthly", 1).toISOString()).toBe(
      "2026-03-01T09:00:00.000Z",
    );
  });

  it("rolls the year over in December", () => {
    expect(advance(utc("2026-12-15T00:00:00Z"), "monthly", 15).toISOString()).toBe(
      "2027-01-15T00:00:00.000Z",
    );
  });

  /*
     The anchor, and the whole reason it is a column.

     31 January renews on 28 February because February is short, and must then
     return to 31 March. Deriving the next date from the 28th instead would give
     28 March, and the seller would renew on the 28th for the rest of their life
     because one February was short.
  */
  it("returns to the anchor after a short month", () => {
    const jan = utc("2026-01-31T00:00:00Z");
    const feb = advance(jan, "monthly", 31);
    expect(feb.toISOString()).toBe("2026-02-28T00:00:00.000Z");

    const mar = advance(feb, "monthly", 31);
    expect(mar.toISOString()).toBe("2026-03-31T00:00:00.000Z");
  });

  it("clamps a 31st anchor through every short month of a year", () => {
    let at = utc("2026-01-31T00:00:00Z");
    const days: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      at = advance(at, "monthly", 31);
      days.push(at.getUTCDate());
    }
    // Feb 28, then the 30ths and 31sts as each month allows — and never a drift
    // downwards once a short month has passed.
    expect(days).toEqual([28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31, 31]);
  });

  it("adds a calendar year, and clamps a leap day", () => {
    expect(advance(utc("2027-03-01T00:00:00Z"), "annual", 1).toISOString()).toBe(
      "2028-03-01T00:00:00.000Z",
    );
    // 29 February 2028 has no counterpart in 2029.
    expect(advance(utc("2028-02-29T00:00:00Z"), "annual", 29).toISOString()).toBe(
      "2029-02-28T00:00:00.000Z",
    );
  });

  it("keeps the time of day, so a renewal does not drift to midnight", () => {
    const next = advance(utc("2026-05-10T17:45:31.250Z"), "monthly", 10);
    expect(next.toISOString()).toBe("2026-06-10T17:45:31.250Z");
  });

  it("takes the anchor from the day a period opens", () => {
    expect(anchorDayOf(utc("2026-07-09T23:00:00Z"))).toBe(9);
  });
});

describe("how long a period is", () => {
  it("counts the real days, not an assumed thirty", () => {
    expect(periodDays(utc("2026-02-01T00:00:00Z"), utc("2026-03-01T00:00:00Z"))).toBe(28);
    expect(periodDays(utc("2026-01-01T00:00:00Z"), utc("2026-02-01T00:00:00Z"))).toBe(31);
    expect(periodDays(utc("2026-01-01T00:00:00Z"), utc("2027-01-01T00:00:00Z"))).toBe(365);
  });

  it("never returns zero, whatever it is handed", () => {
    const same = utc("2026-01-01T00:00:00Z");
    expect(periodDays(same, same)).toBe(1);
    // A period ending before it starts is a data error, not a negative divisor.
    expect(periodDays(utc("2026-02-01T00:00:00Z"), utc("2026-01-01T00:00:00Z"))).toBe(1);
  });
});

describe("proration over a period that is not a month", () => {
  /*
     The trap the required `periodDays` closes.

     `prorate` used to default to thirty days and no caller ever passed
     anything. On a yearly period that credits a day at a thirtieth of a year's
     price — roughly twelve times what the day was worth — silently, in the
     seller's favour, on an invoice they keep for their accountant.
  */
  it("credits a day of a year at a 365th, not a 30th", () => {
    const periodStart = utc("2026-01-01T00:00:00Z");
    const renewsAt = utc("2027-01-01T00:00:00Z");
    const days = periodDays(periodStart, renewsAt);

    const result = prorate({
      fromPeriodAed: 8_990,
      toPeriodAed: 0,
      periodDays: days,
      renewsAt,
      now: utc("2026-12-02T00:00:00Z"),
    });

    expect(days).toBe(365);
    expect(result.creditLine.perDayFils).toBe(perDayFils(8_990, 365));
    // 899,000 fils over 365 days is 2,463 a day floored — not the 29,966 a
    // thirty-day divisor would have produced.
    expect(result.creditLine.perDayFils).toBe(2_463);
    expect(result.daysRemaining).toBe(30);
  });

  it("still prices a month over a month", () => {
    const result = prorate({
      fromPeriodAed: 0,
      toPeriodAed: 349,
      periodDays: 30,
      renewsAt: utc("2026-09-01T00:00:00Z"),
      now: utc("2026-08-20T00:00:00Z"),
    });
    expect(result.chargeLine.perDayFils).toBe(1_163);
    expect(result.daysRemaining).toBe(12);
  });
});
