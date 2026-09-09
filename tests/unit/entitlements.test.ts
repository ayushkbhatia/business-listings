import { describe, expect, it } from "vitest";
import {
  allowance,
  capFor,
  cheapestPlanUnlocking,
  cheapestPlanGranting,
  monthStart,
  snapshotOf,
  type PlanCaps,
} from "@/lib/plan/entitlements";

/** The three real plans, matching prisma/seed-data.mts. */
const FREE: PlanCaps = {
  id: "free", name: "Free", monthlyPriceAed: 0, enquiriesPerMonth: 3, productLimit: 10,
  locationLimit: 1, photoLimit: 5,
  categoryLimit: null, storageMb: 1024, teamSeats: 1, rankingMultiplier: 1, customDomain: false,
  analytics: false, csvImport: false, sponsoredEligible: false,
  sortOrder: 0,
};
const BASIC: PlanCaps = {
  id: "basic", name: "Basic", monthlyPriceAed: 349, enquiriesPerMonth: 40, productLimit: 150,
  locationLimit: 3, photoLimit: 40,
  categoryLimit: null, storageMb: 1024, teamSeats: 3, rankingMultiplier: 1.15, customDomain: false,
  analytics: true, csvImport: true, sponsoredEligible: false,
  sortOrder: 1,
};
const PRO: PlanCaps = {
  id: "pro", name: "Pro", monthlyPriceAed: 899, enquiriesPerMonth: null, productLimit: null,
  locationLimit: 10, photoLimit: 200,
  categoryLimit: null, storageMb: 1024, teamSeats: 10, rankingMultiplier: 1.35, customDomain: true,
  analytics: true, csvImport: true, sponsoredEligible: true,
  sortOrder: 2,
};
const PLANS = [FREE, BASIC, PRO];

describe("allowance", () => {
  it("counts down to the cap", () => {
    expect(allowance(FREE, "enquiries", 1)).toEqual({ remaining: 2, atCap: false, cap: 3, used: 1 });
  });

  it("is at the cap on the boundary, not one past it", () => {
    expect(allowance(FREE, "enquiries", 3).atCap).toBe(true);
    expect(allowance(FREE, "enquiries", 2).atCap).toBe(false);
  });

  it("never reports a negative remaining", () => {
    // A downgrade legitimately leaves a seller over their cap, and
    // "you have -12 products left" is not a sentence.
    expect(allowance(FREE, "products", 22)).toEqual({
      remaining: 0, atCap: true, cap: 10, used: 22,
    });
  });

  it("treats a null cap as unlimited rather than as zero", () => {
    expect(allowance(PRO, "enquiries", 4_000)).toEqual({
      remaining: null, atCap: false, cap: null, used: 4_000,
    });
  });

  it("reads a cap of zero as a cap, not as unlimited", () => {
    // The bug this guards is `cap || unlimited`. No plan sells zero today, and
    // the first one that does must not accidentally sell infinity.
    const none: PlanCaps = { ...FREE, id: "none", productLimit: 0 };
    expect(allowance(none, "products", 0)).toEqual({
      remaining: 0, atCap: true, cap: 0, used: 0,
    });
  });

  it("reads every metered resource off the right column", () => {
    expect(capFor(BASIC, "enquiries")).toBe(40);
    expect(capFor(BASIC, "products")).toBe(150);
    expect(capFor(BASIC, "locations")).toBe(3);
    expect(capFor(BASIC, "photos")).toBe(40);
    expect(capFor(BASIC, "seats")).toBe(3);
  });
});

describe("what to offer, if anything", () => {
  it("offers the cheapest plan that actually raises the cap", () => {
    expect(cheapestPlanUnlocking(PLANS, "enquiries", 3, "free")?.id).toBe("basic");
  });

  it("skips a plan whose cap is still below what they are using", () => {
    // 200 products: Basic's 150 would not help, so the honest answer is Pro.
    expect(cheapestPlanUnlocking(PLANS, "products", 200, "free")?.id).toBe("pro");
  });

  it("offers nothing when the current plan is already unlimited", () => {
    expect(cheapestPlanUnlocking(PLANS, "enquiries", 9_999, "pro")).toBeNull();
  });

  it("never offers a cheaper plan as an upgrade", () => {
    expect(cheapestPlanUnlocking(PLANS, "locations", 3, "basic")?.id).toBe("pro");
    expect(cheapestPlanUnlocking(PLANS, "photos", 40, "pro")).toBeNull();
  });

  it("offers the cheapest plan carrying a feature", () => {
    expect(cheapestPlanGranting(PLANS, "customDomain", "free")?.id).toBe("pro");
    expect(cheapestPlanGranting(PLANS, "customDomain", "basic")?.id).toBe("pro");
  });

  it("offers nothing for a feature the seller already has", () => {
    // Rendering a lock here would be an advert for something already bought.
    expect(cheapestPlanGranting(PLANS, "customDomain", "pro")).toBeNull();
  });
});

describe("monthStart", () => {
  it("is the first of the month at midnight UTC", () => {
    expect(monthStart(new Date("2026-08-24T19:41:00Z")).toISOString()).toBe(
      "2026-08-01T00:00:00.000Z",
    );
  });

  it("does not move a date already on the first", () => {
    expect(monthStart(new Date("2026-08-01T00:00:00Z")).toISOString()).toBe(
      "2026-08-01T00:00:00.000Z",
    );
  });
});

describe("a snapshot freezes entitlements and nothing else", () => {
  /*
     The billing term is a payment fact, not an entitlement one.

     An annual Pro seller is entitled to exactly what a monthly Pro seller is —
     the same products, the same locations, the same ranking. If the term ever
     reached a snapshot then `effectiveCaps` would start handing two sellers on
     one plan different caps, and the difference would be how they chose to pay.
     That is the failure this asserts against, and it is cheap to introduce by
     spreading a subscription row into `snapshotOf` by accident.
  */
  it("carries no billing term", () => {
    const frozen = snapshotOf(PRO, new Date("2026-09-04T00:00:00Z"));
    expect(Object.keys(frozen)).not.toContain("term");
    expect(Object.keys(frozen)).not.toContain("periodStartedAt");
    expect(Object.keys(frozen)).not.toContain("anchorDay");
  });

  it("carries no price of any kind", () => {
    // A snapshot is what the seller may do, not what they pay. The price lives
    // on the plan row, which is why a grandfathered account is still on Pro at
    // Pro's price — `effectiveCaps` says so in its own comment.
    const frozen = snapshotOf(PRO, new Date("2026-09-04T00:00:00Z"));
    expect(Object.keys(frozen)).not.toContain("monthlyPriceAed");
    expect(Object.keys(frozen)).not.toContain("annualMonthsCharged");
  });

  it("freezes every cap the plan carries", () => {
    const frozen = snapshotOf(PRO, new Date("2026-09-04T00:00:00Z"));
    expect(frozen.productLimit).toBe(PRO.productLimit);
    expect(frozen.teamSeats).toBe(PRO.teamSeats);
    expect(frozen.customDomain).toBe(PRO.customDomain);
  });
});
