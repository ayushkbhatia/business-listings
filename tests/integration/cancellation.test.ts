import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { actorFromDevSeller } from "@/lib/auth/dev-seller";
import type { Actor } from "@/lib/auth/roles";
import {
  CANCEL_REASONS,
  cancellationView,
  pendingCancellationFor,
  scheduleCancellation,
} from "@/lib/billing/cancellation";
import { applyEndedCancellations, changePlan, resumeSubscription } from "@/lib/billing/service";
import { applyDueChanges, saveKeep } from "@/lib/billing/schedule";
import { billingSummary } from "@/lib/billing/summary";
import { effectiveCaps } from "@/lib/plan/entitlements";

/**
 * Boards 11h + 11j against a real database.
 *
 * The unit suite proves the consequence table is arithmetic over the config.
 * This proves the four things only Postgres can answer: that confirming writes
 * the cancellation and the seller's choice as one thing, that the choice is
 * honoured at period end, that resuming takes back both halves, and that a seat
 * without `plan.change` cannot do any of it.
 */

/** A seller with a paid subscription and no other suite pinned to it. */
const SLUG = "harbour-point-trading-llc";

/**
 * Products this suite owns, so the Free cap has something to bite on.
 *
 * The fixture has eight and the Free cap holds ten, so nothing would be reduced
 * and the picker would have nothing to pick between. Adding rows is safe;
 * repurposing the fixture's own is not — a shared seed row asserted on by
 * another board is how an unrelated suite starts failing on an innocent change.
 */
const PRODUCT_PREFIX = "zz-cancel-";
const EXTRA_PRODUCTS = 8;

let businessId = "";
let owner: Actor;
let originalRenewsAt: Date;
let originalPlanId: string;
let originalStatuses: { id: string; status: "draft" | "live" | "out_of_stock" }[] = [];

beforeAll(async () => {
  const business = await prisma.business.findUniqueOrThrow({
    where: { slug: SLUG },
    select: {
      id: true,
      planId: true,
      primaryCategoryId: true,
      subscription: { select: { renewsAt: true } },
      team: {
        where: { roles: { has: "seller_owner" } },
        select: { id: true, roles: true },
        take: 1,
      },
    },
  });
  businessId = business.id;
  const seat = business.team[0];
  if (!seat) throw new Error(`${SLUG} has no owner seat`);
  if (!business.subscription) throw new Error(`${SLUG} has no subscription`);
  originalRenewsAt = business.subscription.renewsAt;
  originalPlanId = business.planId ?? "basic";
  owner = actorFromDevSeller({ userId: seat.id, roles: seat.roles, businessId });

  await prisma.product.createMany({
    data: Array.from({ length: EXTRA_PRODUCTS }, (_, i) => ({
      businessId,
      name: `${PRODUCT_PREFIX}${i}`,
      slug: `${PRODUCT_PREFIX}${i}`,
      sku: `${PRODUCT_PREFIX}${i}`,
      categoryId: business.primaryCategoryId,
      availability: "in_stock" as const,
      status: "live" as const,
      specValues: {},
    })),
  });

  originalStatuses = await prisma.product.findMany({
    where: { businessId },
    select: { id: true, status: true },
  });
});

/*
   Every column this suite touches goes back.

   The seed rows are shared: `import.test.ts` learned the hard way that a
   fixture left in a different state fails an unrelated board's assertion, and
   the cancel path writes to four tables. Restoring is not tidiness here.
*/
afterEach(async () => {
  await prisma.subscriptionChange.deleteMany({ where: { businessId } });
  await prisma.subscription.updateMany({
    where: { businessId },
    data: {
      cancelledAt: null,
      endsAt: null,
      status: "active",
      // And out of the trial the last block puts it in — `trialing` left behind
      // would take this fixture out of every other suite's `active` assumption
      // and into `expireTrials`, which drops it to Free on the next sweep.
      trialEndsAt: null,
      planId: originalPlanId,
      renewsAt: originalRenewsAt,
      entitlementSnapshot: Prisma.DbNull,
      hiddenByPlan: Prisma.DbNull,
    },
  });
  await prisma.business.update({ where: { id: businessId }, data: { planId: originalPlanId } });

  // Product statuses, one by one. `applyEndedCancellations` drafts whatever is
  // over the cap, and a fixture left hidden is a catalogue another suite counts.
  for (const product of originalStatuses) {
    await prisma.product.update({
      where: { id: product.id },
      data: { status: product.status },
    });
  }
});

afterAll(async () => {
  await prisma.product.deleteMany({ where: { businessId, sku: { startsWith: PRODUCT_PREFIX } } });
  await prisma.$disconnect();
});

const cancel = (reason: (typeof CANCEL_REASONS)[number] = "too_expensive", note?: string) =>
  scheduleCancellation(owner, businessId, note === undefined ? { reason } : { reason, note });

/**
 * The view, narrowed to the cancellable outcome.
 *
 * `cancellationView` returns a union since board 11c's follow-up audit — a
 * trial is its own outcome rather than a null, because a seller who clicked
 * Cancel deserves the sentence rather than a 404. Every assertion below is
 * about the cancellable branch, and this fails loudly rather than returning
 * early: `if (!view) return` is a test that reports a pass and proves nothing.
 */
async function cancellable(actor = owner) {
  const view = await cancellationView(actor, businessId);
  expect(view, "expected a cancellable subscription").not.toBeNull();
  if (!view || view.kind !== "cancellable") {
    throw new Error(`expected a cancellable outcome, got ${view ? view.kind : "null"}`);
  }
  return view;
}

describe("criterion 1 — every date comes from one value", () => {
  it("dates the cancellation from the renewal, and the paid period from the day before", async () => {
    const view = await cancellable();

    expect(view.freeStartsOn.toISOString()).toBe(originalRenewsAt.toISOString());
    expect(view.freeStartsOn.getTime() - view.paidTo.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("puts the same date on the subscription and on the change row", async () => {
    /*
       The two halves are written together, and they have to agree: `endsAt` is
       what the renewal job and the revenue waterfall read, and `effectiveAt` is
       what the picker's deadline and the daily job read. A pair that disagreed
       would drop the plan on one date and apply the seller's choice on another.
    */
    const result = await cancel();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [subscription, change] = await Promise.all([
      prisma.subscription.findUniqueOrThrow({
        where: { businessId },
        select: { endsAt: true, cancelledAt: true, status: true, planId: true },
      }),
      prisma.subscriptionChange.findFirstOrThrow({
        where: { businessId, kind: "cancellation" },
        select: { effectiveAt: true, toPlanId: true, requestedById: true },
      }),
    ]);

    expect(subscription.endsAt?.toISOString()).toBe(change.effectiveAt.toISOString());
    expect(subscription.cancelledAt).not.toBeNull();
    // Nothing has moved yet. That is the rule the whole flow runs on.
    expect(subscription.status).toBe("active");
    expect(subscription.planId).toBe(originalPlanId);
    expect(change.toPlanId).toBe("free");
    expect(change.requestedById).toBe(owner.id);
  });
});

describe("criterion 6 and 7 — the reason, and the reason that is a fork", () => {
  it("records the reason and the note", async () => {
    const result = await cancel("something_else", "  We are merging with another supplier.  ");
    expect(result.ok).toBe(true);

    const change = await prisma.subscriptionChange.findFirstOrThrow({
      where: { businessId, kind: "cancellation" },
      select: { cancelReason: true, cancelNote: true },
    });
    expect(change.cancelReason).toBe("something_else");
    // Trimmed, so a box of spaces is not a recorded reason.
    expect(change.cancelNote).toBe("We are merging with another supplier.");
  });

  it("refuses `something else` with nothing written", async () => {
    expect(await cancel("something_else", "   ")).toEqual({ ok: false, error: "note_required" });
    expect(await pendingCancellationFor(businessId)).toBeNull();
  });

  it("accepts every other reason with no note at all", async () => {
    // Confirming is never blocked on the box. The required mark is on the
    // reason and on nothing else.
    const result = await cancel("poor_quality_enquiries");
    expect(result.ok).toBe(true);
    const change = await prisma.subscriptionChange.findFirstOrThrow({
      where: { businessId, kind: "cancellation" },
      select: { cancelNote: true },
    });
    expect(change.cancelNote).toBeNull();
  });

  it("cancels nothing when the reason is that the business is closing", async () => {
    /*
       Criterion 7, at the layer that counts. The screen changes the button and
       never posts, and this is the fence that makes the claim true rather than
       a rule a screen happens to follow — `11i` is not built, and a flow that
       cancelled first and offered the fork afterwards would have taken the
       listing to Free on the way to a route that does not exist.
    */
    expect(await cancel("business_closing")).toEqual({
      ok: false,
      error: "closing_is_not_a_cancellation",
    });

    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { businessId },
      select: { cancelledAt: true, endsAt: true },
    });
    expect(subscription.cancelledAt).toBeNull();
    expect(subscription.endsAt).toBeNull();
    expect(await prisma.subscriptionChange.count({ where: { businessId } })).toBe(0);
  });
});

describe("one pending row, whichever kind", () => {
  it("withdraws a scheduled downgrade rather than sitting beside it", async () => {
    /*
       Board 11f Q8, enforced by a partial unique index. Two pending changes
       make the effective-date arithmetic uncheckable, and a seller who
       scheduled Basic and then cancelled has not asked for both on one date.
    */
    await prisma.subscriptionChange.create({
      data: {
        businessId,
        kind: "plan_change",
        fromPlanId: "pro",
        toPlanId: "basic",
        fromTerm: "monthly",
        toTerm: "monthly",
        effectiveAt: originalRenewsAt,
      },
    });

    expect((await cancel()).ok).toBe(true);

    const pending = await prisma.subscriptionChange.findMany({
      where: { businessId, appliedAt: null, withdrawnAt: null },
      select: { kind: true },
    });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.kind).toBe("cancellation");
  });

  it("refuses a second cancellation", async () => {
    await cancel();
    expect(await cancel()).toEqual({ ok: false, error: "already_cancelling" });
  });
});

describe("the choice, and what happens if nobody makes one", () => {
  it("saves the seller's picks onto the cancellation", async () => {
    // `11f`'s picker, unchanged, writing into the row a cancellation created.
    await cancel();
    const live = await prisma.product.findMany({
      where: { businessId, status: "live" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    const keep = live.slice(-1).map((product) => product.id);

    expect(await saveKeep(owner, businessId, "products", keep, 10)).toEqual({ ok: true, kept: 1 });

    const pending = await pendingCancellationFor(businessId);
    expect(pending?.keepProductIds).toEqual(keep);
  });

  it("honours the picks at period end, and stores the rest", async () => {
    await cancel();
    const live = await prisma.product.findMany({
      where: { businessId, status: "live" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (live.length < 2) return;
    const keep = [live[live.length - 1]!.id];
    await saveKeep(owner, businessId, "products", keep, 10);

    const after = new Date(originalRenewsAt.getTime() + 1000);
    expect(await applyEndedCancellations(after)).toMatchObject({ dropped: 1, choicesApplied: 1 });

    // The one the seller kept is the one still live, and nothing was deleted.
    const stillLive = await prisma.product.findMany({
      where: { businessId, status: "live" },
      select: { id: true },
    });
    expect(stillLive.map((p) => p.id)).toEqual(keep);
    expect(await prisma.product.count({ where: { businessId } })).toBe(
      await prisma.product.count({ where: { businessId } }),
    );
  });

  it("keeps the oldest, never none, when the picker is never opened", async () => {
    /*
       Build note `B2`, which the boards never asked and which decides whether a
       paying customer's listing goes dark on the fourteenth. The spec's
       recommendation is most-viewed; there is no per-product view count in the
       schema, so the answer is the one the platform already gives everywhere
       else — `hideOverPlanCap`'s oldest-first, which is also what the chooser
       preselects, so the screen shows what will happen if nothing is touched.
    */
    await prisma.product.updateMany({ where: { businessId }, data: { status: "live" } });
    const oldest = await prisma.product.findMany({
      where: { businessId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });

    await cancel();
    await applyEndedCancellations(new Date(originalRenewsAt.getTime() + 1000));

    const cap =
      (await prisma.plan.findUniqueOrThrow({ where: { id: "free" }, select: { productLimit: true } }))
        .productLimit ?? oldest.length;
    const staysLive = Math.min(cap, oldest.length);

    const live = await prisma.product.findMany({
      where: { businessId, status: "live" },
      select: { id: true },
    });
    expect(live).toHaveLength(staysLive);
    expect(staysLive).toBeGreaterThan(0);
    expect(new Set(live.map((p) => p.id))).toEqual(
      new Set(oldest.slice(0, staysLive).map((p) => p.id)),
    );
  });
});

describe("what the daily job does with the row", () => {
  it("marks it applied, so the plan is not moved twice", async () => {
    await cancel();
    const after = new Date(originalRenewsAt.getTime() + 1000);
    await applyEndedCancellations(after);

    const change = await prisma.subscriptionChange.findFirstOrThrow({
      where: { businessId, kind: "cancellation" },
      select: { appliedAt: true },
    });
    expect(change.appliedAt).not.toBeNull();

    // And the step that applies plan changes leaves it alone either way.
    expect(await applyDueChanges(after)).toMatchObject({ applied: 0 });
    expect(await applyEndedCancellations(after)).toMatchObject({ dropped: 0 });
  });

  it("clears the entitlement snapshot, so the caps are Free's", async () => {
    /*
       A defect this board fixed rather than a feature it added.

       `effectiveCaps` prefers the snapshot over the live plan, so a Pro account
       whose cancellation landed kept Pro's caps on every screen and in every
       guard — `allowance()` is the same function the media upload and the seat
       invitation read. The row said Free and the entitlements said Pro.
    */
    await prisma.subscription.update({
      where: { businessId },
      data: {
        entitlementSnapshot: {
          planId: "pro",
          capturedAt: new Date().toISOString(),
          enquiriesPerMonth: null,
          productLimit: null,
          locationLimit: null,
          photoLimit: null,
          teamSeats: 10,
          customDomain: true,
        },
      },
    });

    await cancel();
    await applyEndedCancellations(new Date(originalRenewsAt.getTime() + 1000));

    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { businessId },
      select: { entitlementSnapshot: true },
    });
    expect(subscription.entitlementSnapshot).toBeNull();

    const free = await prisma.plan.findUniqueOrThrow({ where: { id: "free" } });
    const caps = effectiveCaps(
      {
        ...free,
        monthlyPriceAed: Number(free.monthlyPriceAed),
        rankingMultiplier: Number(free.rankingMultiplier),
      },
      subscription.entitlementSnapshot,
    );
    expect(caps.productLimit).toBe(free.productLimit);
  });
});

describe("what else is refused while it is scheduled", () => {
  it("refuses a plan change, so nobody pays for a plan that is already ending", async () => {
    /*
       A downgrade would be refused by the one-pending index anyway. An
       *upgrade* would not: it applies on payment, so the seller would be charged
       for Pro today and still drop to Free on the date, because nothing on that
       path read `cancelledAt`.
    */
    await cancel();
    const result = await changePlan(owner, businessId, "pro");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("cancelling");

    // And nothing was charged for it.
    expect(
      await prisma.invoice.count({ where: { businessId, issuedAt: { gte: new Date(Date.now() - 60_000) } } }),
    ).toBe(0);
  });
});

describe("resuming takes back both halves", () => {
  it("clears the pair and withdraws the row together", async () => {
    /*
       A withdrawn row with `endsAt` still set is a period end nothing acts on;
       a cleared `endsAt` with the row still pending is an account that renews
       while a cancellation waits to apply. Both are silent.
    */
    await cancel();
    expect(await resumeSubscription(owner, businessId)).toMatchObject({ ok: true });

    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { businessId },
      select: { cancelledAt: true, endsAt: true, status: true },
    });
    expect(subscription.cancelledAt).toBeNull();
    expect(subscription.endsAt).toBeNull();
    expect(subscription.status).toBe("active");
    expect(await pendingCancellationFor(businessId)).toBeNull();
  });

  it("takes the seller's picks with it, so a second cancellation asks again", async () => {
    await cancel();
    const live = await prisma.product.findMany({
      where: { businessId, status: "live" },
      take: 1,
      select: { id: true },
    });
    await saveKeep(owner, businessId, "products", live.map((p) => p.id), 10);
    await resumeSubscription(owner, businessId);

    await cancel();
    const pending = await pendingCancellationFor(businessId);
    expect(pending?.keepProductIds).toBeNull();
  });

  it("lets the period end pass with nothing dropped", async () => {
    await cancel();
    await resumeSubscription(owner, businessId);
    expect(
      await applyEndedCancellations(new Date(originalRenewsAt.getTime() + 1000)),
    ).toMatchObject({ dropped: 0 });
  });
});

describe("what `3m` renders while it is scheduled", () => {
  it("shows the cancellation rather than a downgrade, and offers the picker", async () => {
    /*
       The amendment `3m` needed. Its banner said when the subscription ended
       and offered `Resume Pro`, and that was all — so *"you pick which stay
       live"*, which both boards promise, was a sentence with nowhere to act on
       it.
    */
    await prisma.product.updateMany({ where: { businessId }, data: { status: "live" } });
    await cancel();

    const summary = await billingSummary(owner, businessId);
    expect(summary.endsAt).not.toBeNull();
    expect(summary.pendingChange?.kind).toBe("cancellation");
    expect(summary.pendingKeeps.map((row) => row.kind)).toContain("products");

    const products = summary.pendingKeeps.find((row) => row.kind === "products");
    expect(products?.keeps).toBeLessThan(products?.used ?? 0);
    // Not chosen yet, and the banner says which way that falls.
    expect(products?.chosen).toBeNull();
  });
});

describe("criterion 9 — owner only, and unreachable once it is done", () => {
  it("refuses a finance seat, which reads the invoices and does not decide", async () => {
    const finance: Actor = { id: owner.id, roles: ["seller_finance"], businessId };
    await expect(cancellationView(finance, businessId)).rejects.toThrow();
    await expect(
      scheduleCancellation(finance, businessId, { reason: "too_expensive" }),
    ).rejects.toThrow();
  });

  it("refuses a manager and a sales seat", async () => {
    for (const role of ["seller_manager", "seller_sales"] as const) {
      const actor: Actor = { id: owner.id, roles: [role], businessId };
      await expect(cancellationView(actor, businessId)).rejects.toThrow();
    }
  });

  it("stops rendering once the cancellation has landed", async () => {
    // Criterion 10. `cancellationView` reports the scheduled state, and both
    // routes redirect to billing on it.
    await cancel();
    const view = await cancellable();
    expect(view.scheduled).not.toBeNull();

    await applyEndedCancellations(new Date(originalRenewsAt.getTime() + 1000));
    // Now on Free with a cancelled subscription: there is nothing left to cancel.
    expect(await cancellationView(owner, businessId)).toBeNull();
  });
});

describe("a trial is not a subscription to cancel", () => {
  /**
   * Board 11c's follow-up audit, and the worst of the batch: it put money on the
   * revenue board that nobody had paid.
   *
   * `scheduleCancellation` excluded only `cancelled` and `expired`, so a
   * `trialing` subscription passed both guards and `:393` wrote
   * `status: "active"` over it. Three consequences, all of them silent:
   * `expireTrials` selects `status: "trialing"` and never saw it again;
   * `mrrNow` counts `active`, so a trial started counting as recurring revenue;
   * and `applyEndedCancellations` then booked a churn `MrrMovement` at the full
   * monthly value — the exact row `trial.ts` refuses to write for a trial that
   * simply ends.
   */
  const trialEndsAt = new Date(Date.now() + 9 * 86_400_000);

  async function onTrial() {
    await prisma.subscription.updateMany({
      where: { businessId },
      data: { status: "trialing", trialEndsAt, cancelledAt: null, endsAt: null },
    });
  }

  it("tells the seller rather than 404ing at them", async () => {
    await onTrial();
    const view = await cancellationView(owner, businessId);
    expect(view).not.toBeNull();
    expect(view?.kind).toBe("trial");
    if (view?.kind !== "trial") throw new Error("unreachable");
    // The date the sentence names, from the subscription rather than invented.
    expect(view.trialEndsOn.toISOString()).toBe(trialEndsAt.toISOString());
  });

  it("is refused by the service, not only by the screen", async () => {
    await onTrial();
    expect(await cancel("too_expensive")).toEqual({ ok: false, error: "on_trial" });
  });

  it("leaves the trial where the sweep can still find it", async () => {
    await onTrial();
    await cancel("too_expensive");

    const after = await prisma.subscription.findUniqueOrThrow({
      where: { businessId },
      select: { status: true, cancelledAt: true, endsAt: true, trialEndsAt: true },
    });
    // Still a trial, still ending on its own date, and nothing scheduled.
    expect(after.status).toBe("trialing");
    expect(after.cancelledAt).toBeNull();
    expect(after.endsAt).toBeNull();
    expect(after.trialEndsAt).not.toBeNull();

    // No change row, so nothing for the daily job to apply.
    const changes = await prisma.subscriptionChange.count({
      where: { businessId, appliedAt: null, withdrawnAt: null },
    });
    expect(changes).toBe(0);
  });

  it("books no revenue movement for money nobody paid", async () => {
    const before = await prisma.mrrMovement.count({ where: { businessId } });
    await onTrial();
    await cancel("too_expensive");
    expect(await prisma.mrrMovement.count({ where: { businessId } })).toBe(before);
  });
});
