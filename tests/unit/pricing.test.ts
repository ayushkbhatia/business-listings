import { describe, expect, it } from "vitest";
import {
  ANNUAL_BILLING_LIVE,
  ANNUAL_MONTHS_CHARGED,
  ANNUAL_MONTHS_FREE,
  MONTHS_IN_YEAR,
  annualPriceAed,
  ctaFor,
  isPurchasable,
  priceForPeriod,
  purchasable,
  rankingShare,
  recommendedPlanId,
  rowsThatDiffer,
  type ComparisonRow,
  type PricingPlan,
} from "@/lib/billing/pricing";
import {
  annualPriceLabelOf,
  comparisonRowsOf,
  featuresOf,
  homeSummaryOf,
  priceLabelOf,
} from "@/lib/billing/plan-features";
import { DEFAULT_WEIGHTS, PLAN_TIER_CEILING } from "@/lib/search/ranking";
import { en } from "@/lib/i18n/en";

/**
 * Board 1l's acceptance criteria, as far as a test with no database can reach.
 *
 * The page itself holds no arithmetic — everything it claims is derived here —
 * so this is where the claims are checked. What needs Postgres is in
 * `tests/integration/pricing.test.ts`; what needs a browser is
 * `tests/e2e/pricing.spec.ts`.
 */

function plan(over: Partial<PricingPlan> = {}): PricingPlan {
  return {
    id: "basic",
    name: "Basic",
    monthlyPriceAed: 349,
    enquiriesPerMonth: 40,
    productLimit: 150,
    locationLimit: 3,
    photoLimit: 40,
    teamSeats: 3,
    rankingMultiplier: 1.15,
    customDomain: false,
    siteVisitIncluded: false,
    sortOrder: 1,
    withdrawnAt: null,
    ...over,
  };
}

const FREE = plan({ id: "free", name: "Free", monthlyPriceAed: 0, rankingMultiplier: 1, sortOrder: 0 });
const BASIC = plan();
const PRO = plan({
  id: "pro",
  name: "Pro",
  monthlyPriceAed: 899,
  enquiriesPerMonth: null,
  productLimit: null,
  rankingMultiplier: 1.35,
  customDomain: true,
  siteVisitIncluded: true,
  sortOrder: 2,
});
const PLANS = [FREE, BASIC, PRO];

describe("criterion 4 — a year is ten months, and the discount is stated in months", () => {
  it("is exactly ten times the monthly price", () => {
    expect(annualPriceAed(BASIC)).toBe(BASIC.monthlyPriceAed * 10);
    expect(annualPriceAed(PRO)).toBe(PRO.monthlyPriceAed * 10);
  });

  it("leaves free free", () => {
    expect(annualPriceAed(FREE)).toBe(0);
    expect(annualPriceLabelOf(FREE)).toBe(priceLabelOf(FREE));
  });

  it("expresses the discount as two months rather than a percentage", () => {
    expect(ANNUAL_MONTHS_FREE).toBe(MONTHS_IN_YEAR - ANNUAL_MONTHS_CHARGED);
    expect(ANNUAL_MONTHS_FREE).toBe(2);
    // A percentage anywhere in the copy would be the version nobody can check.
    expect(en["pricing.period_saving"]).not.toContain("%");
    expect(en["pricing.annual_explained"]).not.toContain("%");
  });

  it("switches which price the period shows, from one column", () => {
    expect(priceForPeriod(PRO, "monthly")).toBe(899);
    expect(priceForPeriod(PRO, "annual")).toBe(8_990);
  });

  /*
     The claim on the page and the mechanism under it, held together.

     Nothing in this product can charge a year — `Plan` has one price column and
     proration divides by a thirty-day period — so the annual view says so. If
     somebody flips this constant without building the billing, the page will
     quietly stop saying it, so the constant and the sentence are asserted
     together and one cannot move without the other failing.
  */
  it("says annual is not live, while it is not", () => {
    expect(ANNUAL_BILLING_LIVE).toBe(false);
    expect(en["pricing.annual_not_live"]).toMatch(/charged monthly/i);
  });
});

describe("criterion 12 — a withdrawn plan is not for sale and is not taken away", () => {
  const withdrawn = plan({ id: "legacy", withdrawnAt: new Date("2026-01-01T00:00:00Z") });
  const now = new Date("2026-09-04T00:00:00Z");

  it("drops it from what can be started", () => {
    expect(isPurchasable(withdrawn, now)).toBe(false);
    expect(purchasable([...PLANS, withdrawn], now).map((p) => p.id)).toEqual([
      "free",
      "basic",
      "pro",
    ]);
  });

  it("keeps a plan whose withdrawal is still in the future", () => {
    const soon = plan({ withdrawnAt: new Date("2026-12-01T00:00:00Z") });
    expect(isPurchasable(soon, now)).toBe(true);
  });

  it("never removes the row, so a subscriber's plan still resolves", () => {
    // The filter is the caller's and the reader still has the object. Nothing
    // in this module deletes, blanks or renames a withdrawn plan.
    expect(withdrawn.name).toBe("Basic");
    expect(withdrawn.monthlyPriceAed).toBe(349);
  });
});

describe("criterion 8 — one promoted card, and it is not the dearest", () => {
  it("promotes the cheapest paid plan", () => {
    expect(recommendedPlanId(PLANS)).toBe("basic");
  });

  it("promotes nothing when there is nothing to choose between", () => {
    expect(recommendedPlanId([FREE])).toBe(null);
  });

  it("still promotes the only paid plan when there is one", () => {
    expect(recommendedPlanId([FREE, PRO])).toBe("pro");
  });

  it("moves with price rather than with an id", () => {
    // A fourth tier cheaper than Basic takes the promotion without anybody
    // editing a `plan.id === "basic"` in three files.
    const starter = plan({ id: "starter", name: "Starter", monthlyPriceAed: 149 });
    expect(recommendedPlanId([...PLANS, starter])).toBe("starter");
  });
});

describe("criteria 5 and 6 — the ranking claim is bounded and moves with the config", () => {
  it("reports the plan-tier weight against the whole ranking", () => {
    const share = rankingShare(DEFAULT_WEIGHTS);
    expect(share.points).toBe(DEFAULT_WEIGHTS.planTier);
    expect(share.total).toBe(100);
    expect(share.others).toBe(94);
  });

  it("does not assume the weights add up to a hundred", () => {
    // Staff can set any of the six to any whole number; only plan tier has a
    // ceiling. A share computed against a hardcoded 100 would misstate the
    // claim the moment somebody moved another weight.
    const share = rankingShare({ ...DEFAULT_WEIGHTS, relevance: 50 });
    expect(share.total).toBe(116);
    expect(share.others).toBe(110);
  });

  it("renders the multiplier from the plan, trimmed, never a hardcoded 3×", () => {
    const rows = comparisonRowsOf(PLANS, DEFAULT_WEIGHTS);
    const ranking = rows.find((row) => row.key === "ranking")!;
    expect(ranking.cells.map((cell) => cell.label)).toEqual(["1×", "1.15×", "1.35×"]);
  });

  it("qualifies the row in place, with the live weight in the sentence", () => {
    const rows = comparisonRowsOf(PLANS, { ...DEFAULT_WEIGHTS, planTier: 9 });
    const ranking = rows.find((row) => row.key === "ranking")!;
    expect(ranking.note).toContain("9 of 103 points");
    expect(ranking.note).toMatch(/plan-tier component/i);
  });

  it("keeps the cap the claim depends on, with its reason", () => {
    expect(PLAN_TIER_CEILING).toBe(10);
    expect(DEFAULT_WEIGHTS.planTier).toBeLessThanOrEqual(PLAN_TIER_CEILING);
    expect(Math.min(...Object.values(DEFAULT_WEIGHTS))).toBe(DEFAULT_WEIGHTS.planTier);
  });
});

describe("the comparison table compares, or it is not there", () => {
  it("drops a row every plan answers the same way", () => {
    const rows: ComparisonRow[] = [
      {
        key: "same",
        header: "Same",
        cells: PLANS.map((p) => ({ planId: p.id, label: "Included", state: "included" as const })),
      },
      {
        key: "differs",
        header: "Differs",
        cells: PLANS.map((p) => ({
          planId: p.id,
          label: p.id === "pro" ? "Included" : "Not included",
          state: "value" as const,
        })),
      },
    ];
    expect(rowsThatDiffer(rows).map((row) => row.key)).toEqual(["differs"]);
  });

  it("loses the custom-domain row once every plan carries one", () => {
    const levelled = PLANS.map((p) => ({ ...p, customDomain: true }));
    const keys = comparisonRowsOf(levelled, DEFAULT_WEIGHTS).map((row) => row.key);
    expect(keys).not.toContain("custom_domain");
    expect(keys).toContain("ranking");
  });
});

describe("criterion 10 — what the button does, per reader", () => {
  const asProspect = (p: typeof FREE) =>
    ctaFor({ plan: p, currentPlanId: null, currentMonthlyPriceAed: null, recommended: false });

  it("sends somebody with no listing to the claim flow, carrying the plan", () => {
    expect(asProspect(FREE)).toMatchObject({ kind: "claim", href: "/onboarding/claim?plan=free" });
    expect(asProspect(PRO)).toMatchObject({ kind: "start", href: "/onboarding/claim?plan=pro" });
  });

  it("marks the reader's own plan and gives it nowhere to go", () => {
    const cta = ctaFor({
      plan: BASIC,
      currentPlanId: "basic",
      currentMonthlyPriceAed: 349,
      recommended: false,
    });
    expect(cta.kind).toBe("current");
    expect(cta.href).toBeUndefined();
  });

  it("routes an upgrade and a downgrade to the screen that shows the cost", () => {
    const up = ctaFor({
      plan: PRO,
      currentPlanId: "basic",
      currentMonthlyPriceAed: 349,
      recommended: false,
    });
    const down = ctaFor({
      plan: FREE,
      currentPlanId: "basic",
      currentMonthlyPriceAed: 349,
      recommended: false,
    });
    expect(up).toMatchObject({ kind: "upgrade", href: "/dashboard/billing/change?to=pro" });
    expect(down).toMatchObject({ kind: "downgrade", href: "/dashboard/billing/change?to=free" });
  });

  it("never makes a downgrade a primary button", () => {
    for (const recommended of [true, false]) {
      const cta = ctaFor({
        plan: FREE,
        currentPlanId: "pro",
        currentMonthlyPriceAed: 899,
        recommended,
      });
      expect(cta.kind).toBe("downgrade");
      expect(cta.variant).toBe("ghost");
    }
  });
});

describe("criteria 9 and 11 — free is a product, and nothing offers a trial", () => {
  it("offers no trial anywhere in the pricing copy", () => {
    /*
       `SubStatus` has a `trialing` value and nothing in the product ever writes
       it — no trial length on `Plan`, no start, no end, no code path. A page
       that offered one would be checkable and wrong on the first day, so none
       of its copy names one. `subscription.status.trialing` is the admin
       console's label for a status the database can hold, which is a different
       thing from this page offering a trial.
    */
    for (const [key, value] of Object.entries(en)) {
      if (!key.startsWith("pricing.")) continue;
      const strings = typeof value === "string" ? [value] : Object.values(value);
      for (const s of strings) {
        if (key === "pricing.free_is_permanent") continue;
        expect(s, key).not.toMatch(/\btrials?\b/i);
      }
    }
  });

  it("says free does not expire, rather than implying it by omission", () => {
    expect(en["pricing.free_is_permanent"]).toMatch(/not a trial/i);
    expect(en["pricing.free_is_permanent"]).toMatch(/does not expire/i);
  });

  it("puts no countdown or expiry on the free card", () => {
    const lines = featuresOf(FREE).map((feature) => feature.label);
    for (const line of lines) {
      expect(line).not.toMatch(/\b(expires?|remaining|days left|upgrade)\b/i);
    }
  });

  it("names what free lacks rather than leaving it out", () => {
    const absent = featuresOf(FREE).filter((feature) => !feature.included);
    expect(absent.map((feature) => feature.label)).toEqual([
      "No ranking lift in search",
      "Your own web address",
      "A verification site visit",
    ]);
  });
});

describe("criterion 2 — one fixture, one set of figures, every surface", () => {
  /*
     The four surfaces that quote a plan all render from the same module: the
     home band `1a` through `homeSummaryOf`, this page `1l` and the plan step
     `2e` and the change screen `11f` through `featuresOf` and `priceLabelOf`.
     What this asserts is that they cannot disagree — the same cap produces the
     same words, character for character, wherever it is printed.
  */
  it("prints a cap identically on the home band and on a plan card", () => {
    const card = featuresOf(BASIC).map((feature) => feature.label);
    for (const part of homeSummaryOf(BASIC).split(" · ")) {
      expect(card, part).toContain(part);
    }
  });

  it("prints an unlimited cap identically too", () => {
    const card = featuresOf(PRO).map((feature) => feature.label);
    for (const part of homeSummaryOf(PRO).split(" · ")) {
      expect(card, part).toContain(part);
    }
  });

  it("formats a four-figure cap the same way in both places", () => {
    // The home band used to interpolate the raw integer while the cards ran it
    // through `formatCount`, so this pair read "1,500 products" and "1500
    // products". Three-digit seed data hid it.
    const big = plan({ productLimit: 1_500 });
    expect(homeSummaryOf(big)).toContain("1,500 products");
    expect(featuresOf(big).map((f) => f.label)).toContain("1,500 products");
  });

  it("prints the same price on a card and in the comparison columns", () => {
    expect(priceLabelOf(BASIC)).toBe("AED 349");
    expect(annualPriceLabelOf(BASIC)).toBe("AED 3,490");
  });

  it("renders the multiplier the same way on a card and in the table", () => {
    const card = featuresOf(PRO).map((feature) => feature.label);
    const cell = comparisonRowsOf(PLANS, DEFAULT_WEIGHTS)
      .find((row) => row.key === "ranking")!
      .cells.find((c) => c.planId === "pro")!;
    expect(card).toContain("Ranked 1.35× in search");
    expect(cell.label).toBe("1.35×");
  });
});

describe("the cold-start state is a designed state", () => {
  it("has a title that names no price when nothing paid is on sale", () => {
    // "from AED 0 a month" is arithmetically true and says nothing. The page
    // switches sentence rather than filling a placeholder with a zero.
    expect(en["pricing.seo_title_free"]).not.toMatch(/AED|\d/);
    expect(en["pricing.seo_description_free"]).not.toMatch(/AED \d/);
    // And it keeps the claim that is still true with no paid tier.
    expect(en["pricing.seo_description_free"]).toMatch(/no commission/i);
  });

  it("promotes nothing and compares nothing when only Free is for sale", () => {
    expect(recommendedPlanId([FREE])).toBe(null);
    expect(comparisonRowsOf([FREE], DEFAULT_WEIGHTS)).toEqual([]);
  });

  it("keeps every plan out of the page when all of them are withdrawn", () => {
    const gone = PLANS.map((p) => ({ ...p, withdrawnAt: new Date("2026-01-01T00:00:00Z") }));
    expect(purchasable(gone, new Date("2026-09-04T00:00:00Z"))).toEqual([]);
  });
});

describe("criterion 7 — nothing on this page names a commission", () => {
  it("says there is none, and names no rate", () => {
    const copy = Object.entries(en)
      .filter(([key]) => key.startsWith("pricing."))
      .flatMap(([, value]) => (typeof value === "string" ? [value] : Object.values(value)));

    expect(copy.join(" ")).toMatch(/no commission/i);
    for (const line of copy) {
      expect(line).not.toMatch(/(?<!\bno )\bcommissions?\b/i);
      expect(line).not.toMatch(/\b\d+(\.\d+)?%/);
      expect(line).not.toMatch(/\bper[- ]lead (fee|charge) of\b/i);
    }
  });
});
