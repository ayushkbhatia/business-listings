import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  applyEndedCancellations,
  cancelSubscription,
  changePlan,
  quotePlanChange,
} from "@/lib/billing/service";
import type { Actor } from "@/lib/auth/roles";

/**
 * Handoff 3 criterion 10, against a real database.
 *
 *   "Plan change prorates correctly and unlocks entitlements within a minute;
 *    cancel drops to Free at period end, hides products without deleting them,
 *    and keeps the verified badge."
 *
 * The third clause is the one worth being careful about. Everything a seller
 * fears about cancelling is in it: that their catalogue is deleted, that their
 * badge is taken away, that it happens the moment they click. None of those is
 * true and each is asserted separately.
 */

const SLUG = "brightwork-technical-services-llc";

let businessId: string;
let actor: Actor;
let originalPlanId: string | null;
let originalTier: number;

beforeAll(async () => {
  const business = await prisma.business.findUniqueOrThrow({
    where: { slug: SLUG },
    select: {
      id: true,
      planId: true,
      verificationTier: true,
      team: { where: { roles: { has: "seller_owner" } }, select: { id: true, roles: true }, take: 1 },
    },
  });
  businessId = business.id;
  originalPlanId = business.planId;
  originalTier = business.verificationTier;
  const owner = business.team[0]!;
  actor = { id: owner.id, roles: owner.roles, businessId };
});

afterEach(async () => {
  await prisma.invoice.deleteMany({ where: { businessId, ref: { startsWith: "PLAN-" } } });
});

afterAll(async () => {
  await prisma.invoice.deleteMany({ where: { businessId, ref: { startsWith: "PLAN-" } } });
  await prisma.business.update({
    where: { id: businessId },
    data: { planId: originalPlanId, verificationTier: originalTier },
  });
  await prisma.$disconnect();
});

describe("criterion 10 — proration, shown before it is charged", () => {
  it("quotes without writing anything", async () => {
    const before = await prisma.invoice.count({ where: { businessId } });
    const result = await quotePlanChange(actor, businessId, "basic");
    expect(result.ok).toBe(true);
    expect(await prisma.invoice.count({ where: { businessId } })).toBe(before);
  });

  it("shows the credit and the charge as separate lines", async () => {
    // Board 11f: proration shown line by line. One net figure is a number the
    // seller has to take on trust.
    const result = await quotePlanChange(actor, businessId, "basic");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quote.proration.creditLine.kind).toBe("credit");
    expect(result.quote.proration.chargeLine.kind).toBe("charge");
    expect(result.quote.netAed).toMatch(/^-?\d+\.\d{2}$/);
  });

  it("says the provider cannot actually take money yet", async () => {
    // A stub that pretends to succeed is how a staging environment convinces
    // somebody the billing works.
    const result = await quotePlanChange(actor, businessId, "basic");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quote.providerIsLive).toBe(false);
  });

  it("refuses a plan that is not one we sell", async () => {
    const result = await quotePlanChange(actor, businessId, "platinum");
    expect(result).toEqual({ ok: false, error: "That plan is not one we sell." });
  });

  it("refuses a change to the plan already held", async () => {
    const current = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { planId: true },
    });
    const result = await quotePlanChange(actor, businessId, current.planId ?? "free");
    expect(result).toEqual({ ok: false, error: "That is the plan you are on." });
  });
});

describe("criterion 10 — entitlements move with the plan", () => {
  it("changes the plan and the entitlements in the same request", async () => {
    const result = await changePlan(actor, businessId, "basic");
    expect(result.ok).toBe(true);

    const after = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { planId: true, plan: { select: { productLimit: true, teamSeats: true } } },
    });
    // "Within a minute" is generous. This is the same request.
    expect(after.planId).toBe("basic");
    expect(after.plan?.productLimit).toBe(150);
    expect(after.plan?.teamSeats).toBe(3);
  });

  it("writes an invoice carrying both the charge and the credit", async () => {
    await changePlan(actor, businessId, "pro");
    const invoice = await prisma.invoice.findFirstOrThrow({
      where: { businessId, ref: { startsWith: "PLAN-" } },
      orderBy: { createdAt: "desc" },
      select: { status: true, lines: { select: { kind: true, amountAed: true } } },
    });

    expect(invoice.status).toBe("issued");
    expect(invoice.lines.some((l) => l.kind === "subscription")).toBe(true);
    // Coming from Basic there are unused days to credit.
    expect(invoice.lines.some((l) => l.kind === "subscription_credit")).toBe(true);
    // The credit is negative on the invoice, not a payment out. This platform
    // holds no funds and refunds none.
    const credit = invoice.lines.find((l) => l.kind === "subscription_credit");
    expect(String(credit?.amountAed)).toMatch(/^-/);
  });

  it("keeps the renewal date where it was", async () => {
    const before = await prisma.subscription.findUniqueOrThrow({
      where: { businessId },
      select: { renewsAt: true },
    });
    await changePlan(actor, businessId, "basic");
    const after = await prisma.subscription.findUniqueOrThrow({
      where: { businessId },
      select: { renewsAt: true },
    });
    // A change on the 12th does not restart the month.
    expect(after.renewsAt.toISOString()).toBe(before.renewsAt.toISOString());
  });
});

describe("criterion 10 — cancel is at period end, and keeps what it says", () => {
  afterEach(async () => {
    await prisma.subscription.updateMany({
      where: { businessId },
      data: { cancelledAt: null, endsAt: null, status: "active" },
    });
  });

  it("does not take anything away on the day it is clicked", async () => {
    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { businessId },
      select: { renewsAt: true, planId: true },
    });

    const result = await cancelSubscription(actor, businessId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const after = await prisma.subscription.findUniqueOrThrow({
      where: { businessId },
      select: { planId: true, status: true, endsAt: true },
    });
    // Still on the plan they paid for, until the date they paid to.
    expect(after.planId).toBe(subscription.planId);
    expect(after.status).toBe("active");
    expect(after.endsAt?.toISOString()).toBe(subscription.renewsAt.toISOString());
  });

  it("names what is kept, and it is the longer list", async () => {
    // Everything a seller fears about cancelling is in this list.
    const result = await cancelSubscription(actor, businessId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.kept).toEqual(["listing", "products", "reviews", "badge"]);
    expect(result.summary.kept.length).toBeGreaterThan(result.summary.lost.length);
  });

  it("refuses to cancel twice", async () => {
    await cancelSubscription(actor, businessId);
    const again = await cancelSubscription(actor, businessId);
    expect(again).toEqual({ ok: false, error: "That subscription is already ending." });
  });

  it("drops to Free only once the period has run out", async () => {
    await cancelSubscription(actor, businessId);
    // Nothing due yet.
    expect(await applyEndedCancellations(new Date())).toMatchObject({ dropped: 0 });

    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { businessId },
      select: { endsAt: true },
    });
    const afterEnd = new Date(subscription.endsAt!.getTime() + 1000);
    expect(await applyEndedCancellations(afterEnd)).toMatchObject({ dropped: 1 });

    const business = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { planId: true, verificationTier: true },
    });
    expect(business.planId).toBe("free");
  });

  it("hides products without deleting them, and keeps the badge", async () => {
    const before = await prisma.product.count({ where: { businessId } });
    expect(before).toBeGreaterThan(0);
    const tierBefore = (
      await prisma.business.findUniqueOrThrow({
        where: { id: businessId },
        select: { verificationTier: true },
      })
    ).verificationTier;

    await prisma.product.updateMany({ where: { businessId }, data: { status: "live" } });
    await cancelSubscription(actor, businessId);

    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { businessId },
      select: { endsAt: true },
    });
    await applyEndedCancellations(new Date(subscription.endsAt!.getTime() + 1000));

    const after = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: {
        verificationTier: true,
        _count: { select: { products: true } },
      },
    });

    // Not one product deleted. A seller who comes back next quarter finds
    // their catalogue where they left it.
    expect(after._count.products).toBe(before);
    expect(await prisma.product.count({ where: { businessId, status: "live" } })).toBe(0);
    expect(await prisma.product.count({ where: { businessId, status: "draft" } })).toBe(before);

    // The badge records what we checked. Cancelling a subscription does not
    // un-check it.
    expect(after.verificationTier).toBe(tierBefore);
  });

  it("is idempotent, so the job can run every hour", async () => {
    await cancelSubscription(actor, businessId);
    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { businessId },
      select: { endsAt: true },
    });
    const after = new Date(subscription.endsAt!.getTime() + 1000);

    expect(await applyEndedCancellations(after)).toMatchObject({ dropped: 1 });
    expect(await applyEndedCancellations(after)).toMatchObject({ dropped: 0 });
  });
});
