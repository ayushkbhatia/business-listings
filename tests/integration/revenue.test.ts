import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { applyEndedCancellations, changePlan } from "@/lib/billing/service";
import { scheduleCancellation } from "@/lib/billing/cancellation";
import type { Actor } from "@/lib/auth/roles";
import { mrrByMonth, mrrNow, reconcile } from "@/lib/billing/revenue";
import { classify } from "@/lib/billing/mrr";
import { monthlyValueFils } from "@/lib/billing/period";

/**
 * Board 4g.
 *
 * The load-bearing test is the reconciliation. A revenue screen is believable
 * exactly as far as somebody can check it, and this codebase has already found
 * three metrics that were fabricated in the seed and read by nothing. So the
 * ledger's running total has to equal the live subscription table, and if a
 * fifth writer ever moves a plan without recording the movement, this fails.
 */

const made: string[] = [];

afterAll(async () => {
  await prisma.business.deleteMany({ where: { id: { in: made } } });
  // By slug too, so a crashed run does not leave an account behind carrying
  // movements the next run would count.
  await prisma.business.deleteMany({ where: { slug: { startsWith: "ledger-walk-" } } });
  await prisma.$disconnect();
});

/** A claimed listing on Free, with an owner who may change its plan. */
async function freeListing(): Promise<{ businessId: string; actor: Actor }> {
  const stamp = String(Date.now());
  const categoryId = (
    await prisma.category.findFirstOrThrow({ where: { parentId: null }, select: { id: true } })
  ).id;

  const business = await prisma.business.create({
    data: {
      tradeName: `Ledger Walk ${stamp}`,
      displayName: `Ledger Walk ${stamp}`,
      slug: `ledger-walk-${stamp}`,
      licenceNumber: `DED-${stamp.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
      primaryCategoryId: categoryId,
      claimStatus: "claimed",
      planId: "free",
      publishedAt: new Date(),
    },
    select: { id: true },
  });
  made.push(business.id);

  const owner = await prisma.user.create({
    data: {
      id: crypto.randomUUID(),
      fullName: "Ledger Owner",
      roles: ["seller_owner"],
      businessId: business.id,
    },
    select: { id: true, roles: true },
  });

  return {
    businessId: business.id,
    actor: { id: owner.id, roles: owner.roles, businessId: business.id },
  };
}

describe("every writer records, and the four are the whole list", () => {
  /*
   * The reconciliation on the revenue screen is only as good as this: a plan
   * that moves without a movement row is drift nobody sees until the numbers
   * are already wrong. So one account is driven the whole way round through the
   * real services — signup, upgrade, cancellation, the drop at period end — and
   * its ledger is checked against what it pays at each step.
   *
   * Scoped to one account on purpose. A global assertion would depend on which
   * order the runner happened to pick the files in.
   */
  it("walks one account from signup to churn", async () => {
    const { businessId, actor } = await freeListing();

    const signup = await changePlan(actor, businessId, "basic");
    expect(signup.ok).toBe(true);

    const afterSignup = await prisma.mrrMovement.findMany({
      where: { businessId },
      orderBy: { occurredAt: "asc" },
    });
    expect(afterSignup).toHaveLength(1);
    expect(afterSignup[0]!.kind).toBe("new_business");
    expect(afterSignup[0]!.mrrAfterFils).toBe(34_900);
    // Board 4g: every writer says why, not only which way.
    expect(afterSignup[0]!.cause).toBe("plan_change");

    const upgrade = await changePlan(actor, businessId, "pro");
    expect(upgrade.ok).toBe(true);

    const afterUpgrade = await prisma.mrrMovement.findMany({
      where: { businessId },
      orderBy: { occurredAt: "asc" },
    });
    expect(afterUpgrade).toHaveLength(2);
    expect(afterUpgrade[1]!.kind).toBe("expansion");
    expect(afterUpgrade[1]!.deltaFils).toBe(89_900 - 34_900);
    expect(afterUpgrade[1]!.mrrAfterFils).toBe(89_900);

    // Cancelling is not churn. The seller keeps what they paid for until the
    // period ends, and the money does not stop until it does.
    const cancelled = await scheduleCancellation(actor, businessId, {
      reason: "not_enough_enquiries",
    });
    expect(cancelled.ok).toBe(true);
    expect(await prisma.mrrMovement.count({ where: { businessId } })).toBe(2);

    // Move the end date into the past and let the job find it.
    await prisma.subscription.update({
      where: { businessId },
      data: { endsAt: new Date(Date.now() - 60_000) },
    });
    await applyEndedCancellations();

    const all = await prisma.mrrMovement.findMany({
      where: { businessId },
      orderBy: { occurredAt: "asc" },
    });
    expect(all).toHaveLength(3);
    expect(all[2]!.kind).toBe("churn");
    expect(all[2]!.mrrAfterFils).toBe(0);
    // A cancellation, pointing at the request that carries the reason — which
    // is how board 4g's reasons sum to its cancellations line.
    expect(all[2]!.cause).toBe("cancellation");
    expect(all[2]!.subscriptionChangeId).not.toBeNull();
    const request = await prisma.subscriptionChange.findUniqueOrThrow({
      where: { id: all[2]!.subscriptionChangeId! },
      select: { kind: true, cancelReason: true },
    });
    expect(request).toEqual({ kind: "cancellation", cancelReason: "not_enough_enquiries" });

    // The account's ledger nets to nothing, and it pays nothing.
    expect(all.reduce((sum, row) => sum + row.deltaFils, 0)).toBe(0);
    const live = await prisma.subscription.findUniqueOrThrow({
      where: { businessId },
      select: { status: true, planId: true },
    });
    expect(live.status).toBe("cancelled");
    expect(live.planId).toBe("free");
  }, 120_000);

  it("tells a seller coming back from a new one", async () => {
    const { businessId, actor } = await freeListing();

    await changePlan(actor, businessId, "basic");
    await scheduleCancellation(actor, businessId, { reason: "not_enough_enquiries" });
    await prisma.subscription.update({
      where: { businessId },
      data: { endsAt: new Date(Date.now() - 60_000) },
    });
    await applyEndedCancellations();

    await changePlan(actor, businessId, "basic");

    const kinds = (
      await prisma.mrrMovement.findMany({
        where: { businessId },
        orderBy: { occurredAt: "asc" },
        select: { kind: true },
      })
    ).map((row) => row.kind);

    // Counting a returning seller as new inflates the number the whole screen
    // exists to tell the truth about.
    expect(kinds).toEqual(["new_business", "churn", "reactivation"]);
  }, 120_000);
});

describe("MRR, from the ledger and from the table", () => {
  it("reports whether it agrees with the subscription table, either way", async () => {
    /*
     * Not asserted to agree here. Other files in this suite change plans as
     * their subject matter and clean up after themselves, so a global equality
     * would pass or fail on which order the runner picked — and a test that
     * depends on that is worse than none. The invariant itself is proved per
     * account above, where every writer can be watched.
     *
     * What is asserted is that the check is honest: the two figures are the
     * real sums, and `agrees` is not a separate opinion about them.
     */
    const result = await reconcile();
    const ledger = await prisma.mrrMovement.aggregate({ _sum: { deltaFils: true } });
    const live = await mrrNow();

    expect(result.ledgerFils).toBe(ledger._sum.deltaFils ?? 0);
    expect(result.liveFils).toBe(live.mrrFils);
    expect(result.differenceFils).toBe(result.ledgerFils - result.liveFils);
    expect(result.agrees).toBe(result.differenceFils === 0);
  });

  it("counts active and past due, and nothing else", async () => {
    /*
       Summed by what each account is worth a month, not by the list price.

       This read `Σ plan.monthlyPriceAed` and was right while every subscription
       was monthly. An annual account pays ten months for twelve, so it is worth
       ten twelfths of the list price a month — and the first seeded annual
       subscription made this fail by exactly the discount, which is the test
       doing its job rather than the number being wrong.

       `monthlyValueFils` is the same function `mrrNow` and `recordMovement`
       both call. Reimplementing the arithmetic here would let the assertion
       agree with a bug.
    */
    const now = await mrrNow();
    const expected = await prisma.subscription.findMany({
      where: { status: { in: ["active", "past_due"] } },
      select: {
        term: true,
        plan: { select: { monthlyPriceAed: true, annualMonthsCharged: true } },
      },
    });
    const sum = expected.reduce(
      (total, row) =>
        total +
        monthlyValueFils(
          {
            monthlyPriceAed: Number(row.plan.monthlyPriceAed),
            annualMonthsCharged: row.plan.annualMonthsCharged,
          },
          row.term,
        ),
      0,
    );
    expect(now.mrrFils).toBe(sum);
  });

  it("values an annual account below a monthly one on the same plan", async () => {
    // The trade an annual price makes, stated rather than left to be inferred:
    // less recurring revenue, in exchange for a year of cash and a year of
    // retention. A revenue screen that hid it would be the wrong screen.
    const pro = await prisma.plan.findUniqueOrThrow({
      where: { id: "pro" },
      select: { monthlyPriceAed: true, annualMonthsCharged: true },
    });
    const caps = {
      monthlyPriceAed: Number(pro.monthlyPriceAed),
      annualMonthsCharged: pro.annualMonthsCharged,
    };
    expect(monthlyValueFils(caps, "annual")).toBeLessThan(monthlyValueFils(caps, "monthly"));
  });

  it("leaves the free plan out of revenue", async () => {
    const now = await mrrNow();
    expect(now.byPlan.some((plan) => plan.planId === "free")).toBe(false);
    for (const plan of now.byPlan) expect(plan.mrrFils).toBeGreaterThan(0);
  });

  it("annualises rather than booking", async () => {
    const now = await mrrNow();
    expect(now.annualisedFils).toBe(now.mrrFils * 12);
  });

  it("divides ARPA only when somebody pays", async () => {
    const now = await mrrNow();
    if (now.payingAccounts === 0) {
      expect(now.arpaFils).toBe(0);
    } else {
      expect(now.arpaFils).toBe(Math.round(now.mrrFils / now.payingAccounts));
    }
  });
});

/*
   The twelve-month `waterfall()` and its tests are gone with board 4g. Its NRR
   included new business, which is the defect the handoff corrected; the month
   the board reads now, and its reconciliation, are held by
   `tests/integration/revenue-board.test.ts` and `tests/unit/revenue-period.test.ts`.
*/
describe("MRR month by month", () => {
  it("walks the months without losing a fils", async () => {
    const points = await mrrByMonth(24);
    expect(points).toHaveLength(24);
    const last = points.at(-1)!;
    const nextMonth = new Date(
      Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1),
    );
    const ledger = await prisma.mrrMovement.aggregate({
      where: { occurredAt: { lt: nextMonth } },
      _sum: { deltaFils: true },
    });
    // The last month is the current one, and it closes where the ledger does.
    expect(last.closingFils).toBe(ledger._sum.deltaFils ?? 0);
    // Each point is the previous one plus that month's net.
    for (let index = 1; index < points.length; index += 1) {
      expect(points[index]!.closingFils).toBe(points[index - 1]!.closingFils + points[index]!.netFils);
    }
  });
});

describe("classifying a change", () => {
  it("tells a first signup from a seller coming back", () => {
    expect(classify(0, 34_900, false)).toBe("new_business");
    expect(classify(0, 34_900, true)).toBe("reactivation");
  });

  it("calls a drop to zero churn and a drop to less contraction", () => {
    expect(classify(89_900, 0, false)).toBe("churn");
    expect(classify(89_900, 34_900, false)).toBe("contraction");
  });

  it("is not a movement when the price did not move", () => {
    // Two plans at the same price is a plan change and not a revenue event.
    expect(classify(34_900, 34_900, false)).toBeNull();
  });
});

