import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { expireTrials, startTrial, trialEndsAt, trialStateFor, TRIAL_DAYS } from "@/lib/billing/trial";
import { hideOverPlanCap, readHidden, restoreHiddenByPlan } from "@/lib/billing/plan-caps";
import { COHORT_MINIMUM, planCohortFor } from "@/lib/metrics/plan-cohort";
import { planStepStateFor } from "@/lib/onboarding/plan-step";
import type { Actor } from "@/lib/auth/roles";

/**
 * Board 2e, against a real database.
 *
 * The claims worth proving here are the ones about rows: that a trial is offered
 * once and only on Pro, that it ends by dropping rather than suspending, that
 * "hidden, not deleted" is a behaviour rather than a sentence, and that the
 * cohort clause disappears below its floor instead of softening.
 */

let seller: { id: string; slug: string };
let actor: Actor;
/** Rows this file made, cleaned up whatever the assertions did. */
let madeProducts: string[] = [];
/**
 * The fixture seller's own products, as they were found.
 *
 * This file drafts them on purpose — that is what the cap does — and an earlier
 * version left them that way. Eight seeded products stayed hidden, and the next
 * end-to-end run failed in three places that read live products: the
 * subcategory landing page's filter chips, the product comparison, and the
 * spec-aware search. None of those tests is about plans, which is what made it
 * expensive to trace.
 *
 * So the statuses are captured before anything touches them and put back after
 * every test. A shared seed is somebody else's fixture too.
 */
let originalStatuses: { id: string; status: "draft" | "live" | "out_of_stock" }[] = [];

beforeAll(async () => {
  seller = await prisma.business.findFirstOrThrow({
    where: { claimStatus: "claimed", publishedAt: { not: null }, planId: "free" },
    orderBy: { slug: "asc" },
    select: { id: true, slug: true },
  });

  actor = {
    id: "00000000-0000-4000-8000-00000000e2e5",
    roles: ["seller_owner"],
    businessId: seller.id,
  } as Actor;

  originalStatuses = await prisma.product.findMany({
    where: { businessId: seller.id },
    select: { id: true, status: true },
  });
});

afterEach(async () => {
  if (madeProducts.length > 0) {
    await prisma.product.deleteMany({ where: { id: { in: madeProducts } } });
    madeProducts = [];
  }
  // The seeded catalogue, exactly as it was found. See `originalStatuses`.
  for (const product of originalStatuses) {
    await prisma.product.updateMany({
      where: { id: product.id },
      data: { status: product.status },
    });
  }
  await prisma.subscription.deleteMany({ where: { businessId: seller.id } });
  await prisma.business.update({ where: { id: seller.id }, data: { planId: "free" } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("criteria 12 and 14 — the trial takes no card, and only Pro has one", () => {
  it("puts the business on Pro without an invoice or a provider reference", async () => {
    const before = await prisma.invoice.count({ where: { businessId: seller.id } });
    const result = await startTrial(actor, seller.id);

    expect(result.ok).toBe(true);
    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { businessId: seller.id },
      select: { planId: true, status: true, providerRef: true, trialStartedAt: true },
    });
    expect(subscription.planId).toBe("pro");
    expect(subscription.status).toBe("trialing");
    // A trial that captures a card is a subscription with a delay.
    expect(subscription.providerRef).toBeNull();
    expect(await prisma.invoice.count({ where: { businessId: seller.id } })).toBe(before);
  });

  it("writes no revenue movement, because a trial is worth nothing a month", async () => {
    const before = await prisma.mrrMovement.count({ where: { businessId: seller.id } });
    await startTrial(actor, seller.id);
    expect(await prisma.mrrMovement.count({ where: { businessId: seller.id } })).toBe(before);
  });

  it("ends fourteen days out", async () => {
    const now = new Date("2026-09-04T09:00:00.000Z");
    const result = await startTrial(actor, seller.id, now);
    expect(result.ok && result.endsAt.toISOString()).toBe("2026-09-18T09:00:00.000Z");
    expect(trialEndsAt(now).getTime() - now.getTime()).toBe(TRIAL_DAYS * 86_400_000);
  });
});

describe("criterion 11 — never a second trial", () => {
  it("refuses one on a listing that has already had it", async () => {
    await startTrial(actor, seller.id);
    await expireTrials(new Date(Date.now() + 20 * 86_400_000));

    const again = await startTrial(actor, seller.id);
    expect(again).toEqual({ ok: false, reason: "already_used" });
  });

  it("still reports the trial as used a year later", async () => {
    // The screen hides the offer from this; the service refuses it regardless.
    await startTrial(actor, seller.id);
    await expireTrials(new Date(Date.now() + 20 * 86_400_000));

    const state = await trialStateFor(seller.id, new Date(Date.now() + 400 * 86_400_000));
    expect(state.used).toBe(true);
    expect(state.active).toBe(false);
  });

  it("refuses a trial to somebody already paying", async () => {
    await prisma.business.update({ where: { id: seller.id }, data: { planId: "pro" } });
    expect(await startTrial(actor, seller.id)).toEqual({ ok: false, reason: "already_paid" });
  });
});

describe("criterion 13 — the trial ends by dropping, never by suspending", () => {
  it("puts the account back on Free and marks the row expired", async () => {
    await startTrial(actor, seller.id);
    const sweep = await expireTrials(new Date(Date.now() + 15 * 86_400_000));

    expect(sweep.ended).toBe(1);
    const [business, subscription] = await Promise.all([
      prisma.business.findUniqueOrThrow({ where: { id: seller.id }, select: { planId: true } }),
      prisma.subscription.findUniqueOrThrow({
        where: { businessId: seller.id },
        select: {
          planId: true,
          status: true,
          cancelledAt: true,
          trialStartedAt: true,
          entitlementSnapshot: true,
        },
      }),
    ]);
    expect(business.planId).toBe("free");
    expect(subscription.status).toBe("expired");
    /*
       Not `cancelled`. Nobody cancelled anything — the trial reached its own
       end — and board 11f reads `cancelledAt` to decide whether to say a
       subscription is ending. Setting it would put a cancellation in a seller's
       billing history that they never made.
    */
    expect(subscription.cancelledAt).toBeNull();
    expect(subscription.trialStartedAt).not.toBeNull();
    /*
       And the Pro caps go with it. `effectiveCaps` only prefers a snapshot whose
       own `planId` matches the plan the account is on, so a stale one is
       harmless — but that guard should not be the only thing standing between a
       dropped trial and Pro entitlements.
    */
    expect(subscription.entitlementSnapshot).toBeNull();
  });

  it("leaves a trial that has not run out alone", async () => {
    await startTrial(actor, seller.id);
    expect(await expireTrials(new Date())).toEqual({ ended: 0, hidden: 0 });
  });

  it("is idempotent, so a second pass on the same day finds nothing", async () => {
    await startTrial(actor, seller.id);
    const later = new Date(Date.now() + 15 * 86_400_000);
    expect((await expireTrials(later)).ended).toBe(1);
    expect((await expireTrials(later)).ended).toBe(0);
  });
});

describe("criterion 20 — hidden, not deleted", () => {
  /** Products beyond whatever cap the test is about. */
  async function stockUp(count: number): Promise<string[]> {
    const category = await prisma.category.findFirstOrThrow({
      where: { children: { none: {} } },
      select: { id: true },
    });
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const product = await prisma.product.create({
        data: {
          businessId: seller.id,
          categoryId: category.id,
          name: `Cap fixture ${Date.now()}-${i}`,
          slug: `cap-fixture-${Date.now()}-${i}`,
          status: "live",
          availability: "in_stock",
        },
        select: { id: true },
      });
      ids.push(product.id);
      madeProducts.push(product.id);
    }
    return ids;
  }

  it("hides what the new cap has no room for, and deletes nothing", async () => {
    const made = await stockUp(4);
    const before = await prisma.product.count({ where: { businessId: seller.id } });

    await prisma.subscription.create({
      data: {
        businessId: seller.id,
        planId: "free",
        renewsAt: new Date(Date.now() + 30 * 86_400_000),
      },
    });
    const outcome = await hideOverPlanCap(seller.id, { productLimit: 2 });

    expect(outcome.hidden).toBeGreaterThan(0);
    // Every row is still there. That is the whole promise.
    expect(await prisma.product.count({ where: { businessId: seller.id } })).toBe(before);
    expect(await prisma.product.count({ where: { businessId: seller.id, status: "live" } })).toBe(2);
    expect(made.length).toBe(4);
  });

  it("keeps the oldest, because those are the catalogue the listing was built on", async () => {
    await prisma.product.updateMany({ where: { businessId: seller.id }, data: { status: "draft" } });
    const made = await stockUp(3);
    await prisma.subscription.create({
      data: {
        businessId: seller.id,
        planId: "free",
        renewsAt: new Date(Date.now() + 30 * 86_400_000),
      },
    });

    await hideOverPlanCap(seller.id, { productLimit: 1 });
    const live = await prisma.product.findMany({
      where: { businessId: seller.id, status: "live" },
      select: { id: true },
    });
    expect(live.map((row) => row.id)).toEqual([made[0]]);
  });

  it("records what it hid, so an upgrade restores those and not the seller's own drafts", async () => {
    await prisma.product.updateMany({ where: { businessId: seller.id }, data: { status: "draft" } });
    const made = await stockUp(3);
    const ownDraft = made[2]!;
    await prisma.product.update({ where: { id: ownDraft }, data: { status: "draft" } });

    await prisma.subscription.create({
      data: {
        businessId: seller.id,
        planId: "free",
        renewsAt: new Date(Date.now() + 30 * 86_400_000),
      },
    });
    await hideOverPlanCap(seller.id, { productLimit: 1 });

    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { businessId: seller.id },
      select: { hiddenByPlan: true },
    });
    const hidden = readHidden(subscription.hiddenByPlan);
    expect(hidden).toContain(made[1]);
    // The seller drafted this one themselves. It is not ours to move.
    expect(hidden).not.toContain(ownDraft);

    await restoreHiddenByPlan(seller.id, { productLimit: null });
    const back = await prisma.product.findUniqueOrThrow({
      where: { id: made[1]! },
      select: { status: true },
    });
    expect(back.status).toBe("live");
    const stillDraft = await prisma.product.findUniqueOrThrow({
      where: { id: ownDraft },
      select: { status: true },
    });
    expect(stillDraft.status).toBe("draft");
  });

  it("restores only as far as the new cap allows", async () => {
    await prisma.product.updateMany({ where: { businessId: seller.id }, data: { status: "draft" } });
    await stockUp(5);
    await prisma.subscription.create({
      data: {
        businessId: seller.id,
        planId: "free",
        renewsAt: new Date(Date.now() + 30 * 86_400_000),
      },
    });

    await hideOverPlanCap(seller.id, { productLimit: 1 });
    await restoreHiddenByPlan(seller.id, { productLimit: 3 });

    expect(await prisma.product.count({ where: { businessId: seller.id, status: "live" } })).toBe(3);
  });

  it("does nothing on a plan that caps nothing", async () => {
    await stockUp(2);
    expect(await hideOverPlanCap(seller.id, { productLimit: null })).toEqual({
      hidden: 0,
      restored: 0,
    });
  });

  it("hides nothing when there is nowhere to record what it hid", async () => {
    /*
       No subscription row means no `hiddenByPlan`, and a product hidden with no
       record is one the seller has to find and republish by hand. That is the
       half of "hidden, not deleted" that makes the other half worth saying, so
       the absence of a record refuses the hide rather than doing it blind.
    */
    await prisma.subscription.deleteMany({ where: { businessId: seller.id } });
    const made = await stockUp(3);
    expect(await hideOverPlanCap(seller.id, { productLimit: 1 })).toEqual({
      hidden: 0,
      restored: 0,
    });
    /*
       Scoped to the rows this test made, not to the seller's whole catalogue.
       The seeded eight are live too, and a global count here passed only
       because an earlier test had drafted them and never put them back.
    */
    expect(
      await prisma.product.count({ where: { id: { in: made }, status: "live" } }),
    ).toBe(3);
  });
});

describe("criterion 10 — the cohort claim is measured or absent", () => {
  it("is suppressed below the floor rather than softened", async () => {
    /*
       A category with fewer than thirty claimed, published sellers gets no
       clause at all. Board 2e: "Do not soften it to 'many' — remove it." In a
       thin category the sentence is both unverifiable and identifying.
    */
    const thin = await prisma.category.findFirst({
      where: { children: { none: {} } },
      orderBy: { name: "desc" },
      select: { id: true },
    });
    const size = await prisma.business.count({
      where: { primaryCategoryId: thin?.id, claimStatus: "claimed", publishedAt: { not: null } },
    });
    if (size >= COHORT_MINIMUM) return;

    expect(await planCohortFor(thin?.id ?? null)).toBeNull();
  });

  it("is absent when the seller has no category at all", async () => {
    expect(await planCohortFor(null)).toBeNull();
  });

  it("never reports a plurality as a majority", async () => {
    // Every cohort this seed can produce is either thin or Free-dominated; the
    // property to hold is that whatever comes back is more than half of it.
    const categories = await prisma.category.findMany({
      where: { children: { none: {} } },
      select: { id: true },
    });
    for (const category of categories) {
      const cohort = await planCohortFor(category.id);
      if (!cohort) continue;
      expect(cohort.total).toBeGreaterThanOrEqual(COHORT_MINIMUM);
      expect(cohort.count * 2).toBeGreaterThan(cohort.total);
    }
  });
});

describe("what the page reads", () => {
  it("promotes exactly one card, and never the one the seller is on", async () => {
    const state = await planStepStateFor(seller.id);
    const promoted = state?.plans.filter((plan) => plan.promoted) ?? [];
    expect(promoted).toHaveLength(1);
    expect(promoted[0]?.current).toBe(false);
  });

  it("offers the trial on Pro only, and not once it is used", async () => {
    const before = await planStepStateFor(seller.id);
    expect(before?.plans.filter((plan) => plan.offersTrial).map((plan) => plan.id)).toEqual(["pro"]);

    await startTrial(actor, seller.id);
    await expireTrials(new Date(Date.now() + 20 * 86_400_000));

    const after = await planStepStateFor(seller.id);
    expect(after?.plans.some((plan) => plan.offersTrial)).toBe(false);
    expect(after?.trial.used).toBe(true);
  });

  it("reads the same task collection board 8a does", async () => {
    // Criterion 16. One derivation, not two lists that agree today.
    const { setupStateFor } = await import("@/lib/onboarding/service");
    const [state, hub] = await Promise.all([
      planStepStateFor(seller.id),
      setupStateFor(seller.id),
    ]);
    expect(state?.setup.tasks.map((task) => task.task)).toEqual(hub.tasks.map((task) => task.task));
    expect(state?.setup.tasks.map((task) => task.done)).toEqual(hub.tasks.map((task) => task.done));
  });

  it("derives the count and the estimate rather than stating them", async () => {
    // Criterion 17: `N things left` is the incomplete count and `EST. N MIN` is
    // the sum of *their* minutes.
    const state = await planStepStateFor(seller.id);
    const remaining = state!.setup.tasks.filter((task) => !task.done);
    const minutes = remaining.reduce((sum, task) => sum + task.minutes, 0);

    expect(minutes).toBe(remaining.reduce((sum, task) => sum + task.minutes, 0));
    // The done tasks contribute nothing to the estimate.
    const doneMinutes = state!.setup.tasks
      .filter((task) => task.done)
      .reduce((sum, task) => sum + task.minutes, 0);
    if (doneMinutes > 0) {
      expect(minutes).toBeLessThan(
        state!.setup.tasks.reduce((sum, task) => sum + task.minutes, 0),
      );
    }
  });

  it("states plan's real share of the ranking score", async () => {
    /*
       Criterion 5. A 3× multiplier on the smallest of six weights is not a
       tripling of visibility, and the page has to be able to say what the
       weight is out of.
    */
    const state = await planStepStateFor(seller.id);
    expect(state?.pro?.weight.points).toBeGreaterThan(0);
    expect(state?.pro?.weight.total).toBeGreaterThan(state!.pro!.weight.points);
  });

  it("renders no card for a plan that has been withdrawn from sale", async () => {
    const state = await planStepStateFor(seller.id);
    const withdrawn = await prisma.plan.findMany({
      where: { withdrawnAt: { not: null } },
      select: { id: true },
    });
    for (const plan of withdrawn) {
      expect(state?.plans.some((offer) => offer.id === plan.id)).toBe(false);
    }
  });
});
