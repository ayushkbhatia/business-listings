import { describe, expect, it } from "vitest";
import {
  WATERFALL_LINES,
  baseStoryOf,
  causeOf,
  currentPeriod,
  dubaiMonthOf,
  emptyLines,
  endingFils,
  lineOf,
  periodFor,
  placementFils,
  previousPeriod,
  ratiosOf,
  recentPeriods,
  replyFindingKind,
  retainedFils,
  sumLines,
  type LedgerMonth,
  type MovementFacts,
} from "@/lib/billing/revenue-period";
import { formatPercent } from "@/lib/format";

/**
 * Board 4g — the month's arithmetic, held to the handoff's own figures.
 *
 * The handoff corrected one number on the design, a retention ratio that did
 * not derive from the waterfall above it, and flagged another whose denominator
 * nobody could name. Both failures were arithmetic done once and never checked,
 * so these are the checks, on the exact figures the render draws.
 */

const FILS = 100;

/** The render's August: AED 354,880 starting, and the four lines. */
function august(): LedgerMonth {
  const lines = emptyLines();
  lines.new_business = 38_220 * FILS;
  lines.upgrades = 14_400 * FILS;
  lines.downgrades = -5_200 * FILS;
  lines.cancellations = -14_046 * FILS;
  return {
    startingFils: 354_880 * FILS,
    lines,
    payingAtStart: 2_046,
    payingAtEnd: 2_046,
    cancelledAccounts: 48,
    lapsedAccounts: 0,
  };
}

describe("B1 — the waterfall reconciles", () => {
  it("ends where starting plus every line lands, to the fils", () => {
    expect(endingFils(august())).toBe(388_254 * FILS);
  });

  it("reads a negative month without reordering anything", () => {
    const month = august();
    month.lines.new_business = 0;
    expect(endingFils(month)).toBeLessThan(month.startingFils);
    expect(baseStoryOf(month)).toBe("shrank");
  });
});

describe("B3 — net revenue retention is the existing base only", () => {
  it("is 98.6% on the render's figures, not the 104% its footnote said", () => {
    const { nrr } = ratiosOf(august());
    expect(retainedFils(august())).toBe(350_034 * FILS);
    expect(formatPercent(nrr!, { decimals: 1 })).toBe("98.6%");
  });

  it("does not move when new subscriptions or returning accounts do", () => {
    const month = august();
    const before = ratiosOf(month).nrr;
    month.lines.new_business *= 3;
    month.lines.reactivation = 9_000 * FILS;
    expect(ratiosOf(month).nrr).toBe(before);
  });

  it("says the growth was all new business, because it was", () => {
    expect(baseStoryOf(august())).toBe("shrank_growth_from_new");
    const grew = august();
    grew.lines.upgrades = 20_000 * FILS;
    expect(baseStoryOf(grew)).toBe("grew");
    const held = { ...august(), lines: emptyLines() };
    expect(baseStoryOf(held)).toBe("held");
  });
});

describe("Q1 and the flag — churn, with its denominator", () => {
  it("is 3.96% of starting MRR as revenue churn, and 2.35% of accounts as customer churn", () => {
    const { revenueChurn, customerChurn } = ratiosOf(august());
    expect(formatPercent(revenueChurn!, { decimals: 2 })).toBe("3.96%");
    expect(formatPercent(customerChurn!, { decimals: 2 })).toBe("2.35%");
  });

  it("counts a lapse after failed payments as churn once it has happened", () => {
    const month = august();
    month.lines.lapsed = -1_000 * FILS;
    month.lapsedAccounts = 3;
    expect(ratiosOf(month).revenueChurn).toBeCloseTo((14_046 + 1_000) / 354_880, 10);
    expect(ratiosOf(month).customerChurn).toBeCloseTo(51 / 2_046, 10);
  });

  it("prints a month with no churn as zero, not minus zero", () => {
    const { revenueChurn } = ratiosOf({ ...august(), lines: emptyLines() });
    expect(Object.is(revenueChurn, -0)).toBe(false);
    expect(formatPercent(revenueChurn!, { decimals: 2 })).toBe("0.00%");
  });

  it("refuses a percentage of nothing", () => {
    const month = { ...august(), startingFils: 0, payingAtStart: 0, payingAtEnd: 0 };
    const ratios = ratiosOf(month);
    expect(ratios.nrr).toBeNull();
    expect(ratios.revenueChurn).toBeNull();
    expect(ratios.customerChurn).toBeNull();
    expect(ratios.monthOnMonth).toBeNull();
    expect(ratios.arpaFils).toBeNull();
  });
});

describe("B7 — ARPA over paying accounts at the end", () => {
  it("is AED 190 on 388,254 over 2,046", () => {
    expect(ratiosOf(august()).arpaFils).toBe(18_976);
  });

  it("puts the month-on-month at +9.4%", () => {
    expect(formatPercent(ratiosOf(august()).monthOnMonth!, { decimals: 1 })).toBe("9.4%");
  });
});

describe("every movement is on exactly one line", () => {
  const base: MovementFacts = { kind: "expansion", cause: "plan_change", fromPlanId: "basic", toPlanId: "pro", note: null };

  it("tells a term switch from an upgrade", () => {
    expect(lineOf(base)).toBe("upgrades");
    expect(lineOf({ ...base, cause: "term_change", fromPlanId: "pro", toPlanId: "pro" })).toBe("term_changes");
    expect(lineOf({ ...base, kind: "contraction", cause: "term_change", fromPlanId: "pro", toPlanId: "pro" })).toBe("term_changes");
    expect(lineOf({ ...base, kind: "contraction" })).toBe("downgrades");
  });

  it("tells a lapse from a cancellation (B8)", () => {
    expect(lineOf({ ...base, kind: "churn", cause: "dunning_drop" })).toBe("lapsed");
    expect(lineOf({ ...base, kind: "churn", cause: "cancellation" })).toBe("cancellations");
    // A drop to Free by plan change predates 11f's routing through the cancel flow.
    expect(lineOf({ ...base, kind: "churn", cause: "plan_change" })).toBe("cancellations");
  });

  it("keeps a returning account off the new line", () => {
    expect(lineOf({ ...base, kind: "new_business", fromPlanId: null })).toBe("new_business");
    expect(lineOf({ ...base, kind: "reactivation", fromPlanId: null })).toBe("reactivation");
  });

  it("reads an unlabelled row the way the migration's backfill did", () => {
    expect(causeOf({ ...base, cause: null, fromPlanId: "pro", toPlanId: "pro" })).toBe("term_change");
    expect(causeOf({ ...base, kind: "churn", cause: null, note: "Dunning drop after 14 days past due" })).toBe("dunning_drop");
    expect(causeOf({ ...base, kind: "churn", cause: null, note: "Cancellation reached its end date" })).toBe("cancellation");
    expect(causeOf({ ...base, cause: null })).toBe("plan_change");
  });

  it("sums signed deltas, so a line's sign is the movement's", () => {
    const lines = sumLines([
      { ...base, deltaFils: 55_000 },
      { ...base, kind: "churn", cause: "cancellation", deltaFils: -34_900 },
      { ...base, kind: "churn", cause: "dunning_drop", deltaFils: -89_900 },
    ]);
    expect(lines.upgrades).toBe(55_000);
    expect(lines.cancellations).toBe(-34_900);
    expect(lines.lapsed).toBe(-89_900);
    expect(WATERFALL_LINES.reduce((sum, line) => sum + lines[line], 0)).toBe(55_000 - 34_900 - 89_900);
  });
});

describe("months are Dubai months", () => {
  const now = new Date("2026-09-14T08:00:00Z");

  it("opens on the last whole month", () => {
    const period = periodFor(null, now);
    expect(period.key).toBe("2026-08");
    expect(period.from.toISOString()).toBe("2026-07-31T20:00:00.000Z");
    expect(period.monthEnd.toISOString()).toBe("2026-08-31T20:00:00.000Z");
    expect(period.to).toEqual(period.monthEnd);
    expect(period.partial).toBe(false);
    expect(period.daysInMonth).toBe(31);
    expect(period.daysElapsed).toBe(31);
  });

  it("labels the month in progress as partial, with the days so far", () => {
    const period = periodFor("2026-09", now);
    expect(period.partial).toBe(true);
    expect(period.to).toEqual(now);
    expect(period.daysInMonth).toBe(30);
    expect(period.daysElapsed).toBe(14);
    expect(currentPeriod(now).key).toBe("2026-09");
  });

  it("puts 11pm on the 31st in Dubai into the next month", () => {
    expect(dubaiMonthOf(new Date("2026-08-31T19:59:59Z"))).toEqual({ year: 2026, month: 8 });
    expect(dubaiMonthOf(new Date("2026-08-31T20:00:00Z"))).toEqual({ year: 2026, month: 9 });
  });

  it("falls back to the last whole month on a key it cannot read, or one that has not started", () => {
    expect(periodFor("2026-13", now).key).toBe("2026-08");
    expect(periodFor("august", now).key).toBe("2026-08");
    expect(periodFor("2026-10", now).key).toBe("2026-08");
  });

  it("rolls across a year", () => {
    const january = new Date("2027-01-05T08:00:00Z");
    expect(periodFor(null, january).key).toBe("2026-12");
    expect(previousPeriod(periodFor("2027-01", january), january).key).toBe("2026-12");
    expect(recentPeriods(3, january).map((p) => p.key)).toEqual(["2027-01", "2026-12", "2026-11"]);
  });
});

describe("B4 — placement, apart from MRR", () => {
  const period = periodFor("2026-08", new Date("2026-09-14T08:00:00Z"));

  it("is the slot's monthly price for a whole month live", () => {
    expect(placementFils({ monthlyPriceAed: 450, startsOn: new Date("2026-07-01"), endsOn: null }, period)).toBe(45_000);
  });

  it("is pro rata for part of one, and nothing outside it", () => {
    const half = new Date(period.from.getTime() + (period.monthEnd.getTime() - period.from.getTime()) / 2);
    expect(placementFils({ monthlyPriceAed: 450, startsOn: half, endsOn: null }, period)).toBe(22_500);
    expect(placementFils({ monthlyPriceAed: 450, startsOn: new Date("2026-06-01"), endsOn: new Date("2026-07-15") }, period)).toBe(0);
  });
});

describe("B6 — which sentence the cross-reference may say", () => {
  it("claims they were getting enquiries only when one measured under the threshold", () => {
    expect(replyFindingKind({ total: 19, below: 17, atOrAbove: 2, unmeasured: 0 })).toBe("below");
    expect(replyFindingKind({ total: 4, below: 0, atOrAbove: 3, unmeasured: 1 })).toBe("none_below");
    expect(replyFindingKind({ total: 2, below: 0, atOrAbove: 0, unmeasured: 2 })).toBe("all_unmeasured");
    expect(replyFindingKind({ total: 0, below: 0, atOrAbove: 0, unmeasured: 0 })).toBe("none");
  });
});
