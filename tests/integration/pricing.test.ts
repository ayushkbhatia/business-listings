import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { readPricingPlans, readViewerPlanId } from "@/lib/db/queries/pricing";
import { isPurchasable, purchasable, recommendedPlanId } from "@/lib/billing/pricing";
import { comparisonRowsOf, featuresOf, homeSummaryOf } from "@/lib/billing/plan-features";
import { effectiveCaps, snapshotOf } from "@/lib/plan/entitlements";
import { liveWeights } from "@/lib/search/settings";
import { DEFAULT_WEIGHTS } from "@/lib/search/ranking";

/**
 * Board 1l against a real database.
 *
 * The unit suite proves the arithmetic. This proves the two things only
 * Postgres can answer: that the read hands the page every column it claims
 * from, and that withdrawing a plan takes it off sale without taking it away
 * from anybody.
 */

/** Restored in `afterAll` — this file withdraws a plan and must put it back. */
const withdrawn: { id: string; previous: Date | null }[] = [];

afterAll(async () => {
  for (const row of withdrawn) {
    await prisma.plan.update({ where: { id: row.id }, data: { withdrawnAt: row.previous } });
  }
});

describe("criterion 1 — every figure the page prints exists on the row", () => {
  it("selects each column the cards, the table and the offers need", async () => {
    const plans = await readPricingPlans();
    expect(plans.length).toBeGreaterThan(0);

    for (const plan of plans) {
      // Not a shape assertion for its own sake: a `select` that quietly drops a
      // column gives the page `undefined`, and `undefined` reads as "unlimited"
      // through `capFor`. A missing column would render as a more generous plan
      // than the one being sold.
      expect(Object.keys(plan).sort()).toEqual(
        [
          // What a year costs, in months. Added when the renewal cycle landed:
          // the page reads it to decide whether a plan can be sold by the year
          // at all, and null means it cannot.
          "annualMonthsCharged",
          "customDomain",
          "enquiriesPerMonth",
          "id",
          "locationLimit",
          "monthlyPriceAed",
          "name",
          "photoLimit",
          "productLimit",
          "rankingMultiplier",
          "sortOrder",
          "teamSeats",
          "withdrawnAt",
        ].sort(),
      );
      expect(typeof plan.monthlyPriceAed).toBe("number");
      expect(typeof plan.rankingMultiplier).toBe("number");
    }
  });

  it("puts a real number behind every line the seeded plans render", async () => {
    const plans = await readPricingPlans();
    const weights = await liveWeights();

    for (const plan of plans) {
      for (const feature of featuresOf(plan)) {
        expect(feature.label.trim(), plan.id).not.toBe("");
        expect(feature.label, plan.id).not.toMatch(/undefined|NaN|null/);
      }
      expect(homeSummaryOf(plan), plan.id).not.toMatch(/undefined|NaN|null/);
    }

    for (const row of comparisonRowsOf(plans, weights)) {
      expect(row.cells.map((cell) => cell.planId)).toEqual(plans.map((plan) => plan.id));
      for (const cell of row.cells) expect(cell.label).not.toMatch(/undefined|NaN/);
    }
  });

  it("reads the weights the search actually ranks by", async () => {
    // Falls back to the constant when the settings row is absent, which is what
    // a fresh database has. Either way the page is reading the same object the
    // query does rather than a copy of it.
    const weights = await liveWeights();
    for (const key of Object.keys(DEFAULT_WEIGHTS) as (keyof typeof DEFAULT_WEIGHTS)[]) {
      expect(typeof weights[key], key).toBe("number");
    }
  });
});

describe("criterion 12 — withdrawing a plan is about what can be started", () => {
  it("takes it off the page and leaves its subscribers alone", async () => {
    const plans = await readPricingPlans();
    const target = plans.find((plan) => plan.monthlyPriceAed > 0);
    if (!target) throw new Error("the seed has no paid plan to withdraw");

    // Somebody on it before the withdrawal, with their caps frozen.
    const holder = await prisma.business.findFirst({
      where: { planId: target.id },
      select: { id: true, planId: true },
    });

    withdrawn.push({ id: target.id, previous: target.withdrawnAt });
    await prisma.plan.update({
      where: { id: target.id },
      data: { withdrawnAt: new Date("2026-01-01T00:00:00Z") },
    });

    const after = await readPricingPlans();
    const row = after.find((plan) => plan.id === target.id)!;

    // The row is still there, with everything on it.
    expect(row).toBeDefined();
    expect(row.monthlyPriceAed).toBe(target.monthlyPriceAed);
    expect(row.name).toBe(target.name);

    // And it is off the page.
    expect(isPurchasable(row)).toBe(false);
    expect(purchasable(after).map((plan) => plan.id)).not.toContain(target.id);

    // The subscriber is untouched: same plan, same caps.
    if (holder) {
      expect(await readViewerPlanId(holder.id)).toBe(target.id);
      const frozen = snapshotOf(row, new Date("2026-01-01T00:00:00Z"));
      expect(effectiveCaps(row, frozen).productLimit).toBe(row.productLimit);
    }
  });

  it("moves the promotion to a plan that is still for sale", async () => {
    const after = purchasable(await readPricingPlans());
    const recommended = recommendedPlanId(after);
    if (recommended !== null) {
      expect(after.map((plan) => plan.id)).toContain(recommended);
    }
  });
});

describe("a business with no plan row is on Free, not on nothing", () => {
  it("resolves a null planId to the free plan", async () => {
    const unchosen = await prisma.business.findFirst({
      where: { planId: null },
      select: { id: true },
    });
    // The 41,000 imported licence records have never chosen anything, so this
    // is the common case rather than an edge one.
    if (unchosen) expect(await readViewerPlanId(unchosen.id)).toBe("free");
  });

  it("returns null for a business that is not there", async () => {
    expect(await readViewerPlanId("no-such-business")).toBe(null);
  });
});
