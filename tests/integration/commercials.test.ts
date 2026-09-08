import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { runDunning } from "@/lib/billing/dunning-job";
import { GRACE_AFTER_FINAL_DAYS, SCHEDULE } from "@/lib/billing/dunning";
import { consoleProvider, setPaymentProvider, type PaymentProvider } from "@/lib/billing/provider";
import { editPlanEntitlements, effectiveFor, planLibrary } from "@/lib/billing/entitlements-service";
import { effectiveCaps, readSnapshot, snapshotOf } from "@/lib/plan/entitlements";
import { PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";

/**
 * Criterion 10, and the grandfathering criterion 12e assumes.
 *
 *   10. "Dunning runs the D0/D3/D7/D14 sequence and never deletes a listing or
 *        removes a badge."
 *
 * The second half is a negative and those pass by accident, so the test below
 * takes a full census of the account before and after the whole sequence and
 * asserts that everything except the plan is identical.
 */

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });

let financeId: string;
let opsLeadId: string;
let moderatorId: string;
let categoryId: string;
let areaId: string;
/**
 * A plan of this test's own.
 *
 * The entitlement tests edit caps, and editing `basic` would leave the shared
 * development database on numbers nobody chose — the second run of this file
 * then failed with `nothing_changed` because the first run had already moved
 * them. A plan per run is isolated and re-runnable.
 */
let planId: string;
/** Every fixture listing this file made, so it can take them away again. */
const madeBusinesses: string[] = [];
let seq = 0;

/** A gateway that is live and declines. Which is the case dunning exists for. */
const decliningProvider: PaymentProvider = {
  name: "test-declining",
  live: true,
  async charge() {
    return { ok: false, error: "Card declined." };
  },
  async cancel() {
    return { ok: true };
  },
};

/**
 * Take away every row this file has ever made, in dependency order.
 *
 * Run before as well as after: a crashed run leaves a plan behind, and a plan
 * with subscriptions on it cannot be deleted, so the next run would fail in
 * `beforeAll` rather than anywhere useful.
 */
async function removeFixtures(businessIds: string[]) {
  if (businessIds.length > 0) {
    await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
  }
  /*
   * By slug, not only by plan.
   *
   * A dropped listing is on Free — that is what the sequence does — so deleting
   * by `planId` misses exactly the fixtures this file cares most about. They
   * survived a crashed run carrying MRR movements dated fifteen days into the
   * future, and `revenue.test.ts` failed on a waterfall that ended before them.
   */
  await prisma.business.deleteMany({ where: { slug: { startsWith: "dun-" } } });
  await prisma.business.deleteMany({ where: { planId: { startsWith: "test-dunning-" } } });
  await prisma.subscription.deleteMany({ where: { planId: { startsWith: "test-dunning-" } } });
  await prisma.plan.deleteMany({ where: { id: { startsWith: "test-dunning-" } } });

  /*
   * And the buyer, which the lines above cannot reach.
   *
   * A dunning enquiry hangs off its *buyer*, not off the listing it was sent
   * to, so deleting the business took only the recipient row. The requirement
   * survived — 49 of them after seven runs — and being newly created it is
   * newer than everything the seed wrote. `readOpenRfqTeasers` reads the
   * sixteen most recent open requests and these fill the window, so from the
   * third consecutive run without a reseed the home panel came back empty and
   * `home.test.ts` failed on a count, naming neither this file nor dunning.
   *
   * By buyer rather than by enquiry, because `Enquiry.buyer` is `Cascade`: one
   * delete takes the requirement, its recipients, its lines and its review.
   */
  const dunning = await prisma.enquiry.findMany({
    where: { ref: { startsWith: "ENQ-DUN-" } },
    select: { buyerId: true },
  });
  if (dunning.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: dunning.map((row) => row.buyerId) } } });
  }
}

beforeAll(async () => {
  financeId = (
    await prisma.user.findFirstOrThrow({
      where: { roles: { has: "staff_finance" } },
      select: { id: true },
    })
  ).id;
  opsLeadId = (
    await prisma.user.findFirstOrThrow({
      where: { roles: { has: "staff_ops_lead" } },
      // One of two seeded ops leads, and always the same one: board 6f
      // needs a second for dual control, and `findFirst` has no defined
      // order without this.
      orderBy: { id: "asc" as const },
      select: { id: true },
    })
  ).id;
  moderatorId = (
    await prisma.user.findFirstOrThrow({
      where: { roles: { has: "staff_moderator" } },
      select: { id: true },
    })
  ).id;
  categoryId = (
    await prisma.category.findFirstOrThrow({ where: { parentId: null }, select: { id: true } })
  ).id;
  areaId = (await prisma.area.findFirstOrThrow({ select: { id: true } })).id;

  await removeFixtures([]);

  const basic = await prisma.plan.findUniqueOrThrow({ where: { id: "basic" } });
  planId = `test-dunning-${Date.now()}`;
  await prisma.plan.create({
    data: {
      ...basic,
      id: planId,
      name: `Test ${planId}`,
      sortOrder: 90,
    },
  });

  setPaymentProvider(decliningProvider);
});

afterAll(async () => {
  setPaymentProvider(consoleProvider);
  await removeFixtures(madeBusinesses);
  await prisma.$disconnect();
});

/** A paying, verified listing with reviews and a catalogue — everything to lose. */
async function payingListing(name: string) {
  seq += 1;
  const stamp = `${Date.now()}${String(seq).padStart(2, "0")}`;

  const business = await prisma.business.create({
    data: {
      tradeName: `${name} ${stamp}`,
      displayName: `${name} ${stamp}`,
      slug: `dun-${name.toLowerCase().replace(/\s+/g, "-")}-${stamp}`,
      licenceNumber: `DED-${stamp.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
      primaryCategoryId: categoryId,
      claimStatus: "claimed",
      planId,
      publishedAt: new Date(),
      verificationTier: 2,
      verifiedAt: new Date(),
      locations: {
        create: {
          type: "head_office",
          emirate: "dubai",
          areaId,
          addressLine: "Unit 5, Street 9",
          published: true,
        },
      },
      products: {
        create: {
          categoryId,
          name: `Valve ${stamp}`,
          slug: `valve-${stamp}`,
          status: "live",
          availability: "in_stock",
          searchText: `valve ${stamp}`,
        },
      },
    },
    select: { id: true },
  });

  const buyer = await prisma.user.create({
    data: { id: crypto.randomUUID(), fullName: "Dunning Buyer", roles: ["buyer"] },
    select: { id: true },
  });
  const enquiry = await prisma.enquiry.create({
    data: {
      ref: `ENQ-DUN-${stamp}`,
      buyerId: buyer.id,
      requirement: "Valves.",
      closesAt: new Date(Date.now() + 7 * 86_400_000),
    },
    select: { id: true },
  });
  await prisma.enquiryRecipient.create({
    data: { enquiryId: enquiry.id, businessId: business.id, state: "delivered" },
  });
  await prisma.review.create({
    data: {
      businessId: business.id,
      buyerId: buyer.id,
      enquiryId: enquiry.id,
      overall: 5,
      quotedAccurate: 5,
      onTime: 5,
      asDescribed: 5,
      responsiveness: 5,
      body: "Delivered on the day they said.",
      editableUntil: new Date(Date.now() + 14 * 86_400_000),
    },
  });

  const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });
  const subscription = await prisma.subscription.create({
    data: {
      businessId: business.id,
      planId,
      status: "past_due",
      startedAt: new Date(Date.now() - 90 * 86_400_000),
      renewsAt: new Date(Date.now() - 1 * 86_400_000),
      entitlementSnapshot: snapshotOf(
        {
          ...plan,
          monthlyPriceAed: Number(plan.monthlyPriceAed),
          rankingMultiplier: Number(plan.rankingMultiplier),
        },
        new Date(),
      ) as unknown as object,
    },
    select: { id: true },
  });

  madeBusinesses.push(business.id);
  return { businessId: business.id, subscriptionId: subscription.id };
}

/** Everything a wrong dunning run could take away. */
async function census(businessId: string) {
  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    select: {
      publishedAt: true,
      verificationTier: true,
      verifiedAt: true,
      suspendedAt: true,
      claimStatus: true,
      slug: true,
      displayName: true,
    },
  });
  const [products, liveProducts, reviews, recipients, locations, media] = await Promise.all([
    prisma.product.count({ where: { businessId } }),
    prisma.product.count({ where: { businessId, status: "live" } }),
    prisma.review.count({ where: { businessId, removedAt: null } }),
    prisma.enquiryRecipient.count({ where: { businessId } }),
    prisma.location.count({ where: { businessId } }),
    prisma.media.count({ where: { businessId } }),
  ]);
  return { ...business, products, liveProducts, reviews, recipients, locations, media };
}

describe("dunning never takes anything away but the plan", () => {
  it("runs D0 to D14 and leaves the account whole", async () => {
    const { businessId, subscriptionId } = await payingListing("Whole");
    const before = await census(businessId);
    const failed = new Date();
    const day = (n: number) => new Date(failed.getTime() + n * 86_400_000);

    // D0 retry, D3 email, D7 WhatsApp, D14 final, then the drop.
    await runDunning(day(0));
    await runDunning(day(SCHEDULE.emailed));
    await runDunning(day(SCHEDULE.messaged));
    await runDunning(day(SCHEDULE.final));
    await runDunning(day(SCHEDULE.final + GRACE_AFTER_FINAL_DAYS));

    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { id: subscriptionId },
      select: { planId: true, dunningStage: true },
    });
    expect(subscription.dunningStage).toBe("dropped");
    expect(subscription.planId).toBe("free");

    const after = await census(businessId);

    // The plan moved. Nothing else did.
    expect(after).toEqual(before);
  }, 120_000);

  it("keeps the verification badge, because a card is not a licence", async () => {
    const { businessId } = await payingListing("Badge Kept");
    const failed = new Date();
    for (const d of [0, SCHEDULE.emailed, SCHEDULE.messaged, SCHEDULE.final, SCHEDULE.final + GRACE_AFTER_FINAL_DAYS]) {
      await runDunning(new Date(failed.getTime() + d * 86_400_000));
    }

    const after = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { verificationTier: true, verifiedAt: true, publishedAt: true },
    });
    expect(after.verificationTier).toBe(2);
    expect(after.verifiedAt).not.toBeNull();
    // Free is a real plan, not a suspension. The listing stays live.
    expect(after.publishedAt).not.toBeNull();
  }, 120_000);

  it("advances one stage at a time, and records every attempt", async () => {
    const { subscriptionId } = await payingListing("Staged");
    const failed = new Date();

    await runDunning(failed);
    expect(
      (await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } })).dunningStage,
    ).toBe("retry");

    // A run the next day does nothing: the email is not due until D3.
    await runDunning(new Date(failed.getTime() + 86_400_000));
    expect(
      (await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } })).dunningStage,
    ).toBe("retry");

    const attempts = await prisma.paymentAttempt.count({ where: { subscriptionId } });
    expect(attempts).toBeGreaterThan(0);
  }, 120_000);

  it("does not pretend the console provider took money", async () => {
    /*
     * `consoleProvider.charge` returns `ok: true` for everything. If dunning
     * trusted that, every past-due subscription would be marked active again on
     * the first run — no card touched, no seller told, the sequence never
     * starting. So a provider that is not live does not get asked.
     */
    setPaymentProvider(consoleProvider);
    try {
      const { subscriptionId } = await payingListing("No Gateway");
      const failed = new Date();

      await runDunning(failed);

      const subscription = await prisma.subscription.findUniqueOrThrow({
        where: { id: subscriptionId },
        select: { dunningStage: true, status: true },
      });
      // The sequence advanced.
      expect(subscription.dunningStage).toBe("retry");
      expect(subscription.status).toBe("past_due");
      // And no attempt is recorded, because none was made.
      expect(await prisma.paymentAttempt.count({ where: { subscriptionId } })).toBe(0);
    } finally {
      setPaymentProvider(decliningProvider);
    }
  }, 60_000);

  it("is idempotent — a second run in the same hour does nothing", async () => {
    const { subscriptionId } = await payingListing("Idempotent");
    const failed = new Date();

    await runDunning(failed);
    const first = await prisma.paymentAttempt.count({ where: { subscriptionId } });
    await runDunning(failed);
    const second = await prisma.paymentAttempt.count({ where: { subscriptionId } });

    expect(second).toBe(first);
  }, 120_000);
});

describe("grandfathering, which did not work", () => {
  it("refuses the old snapshot shape rather than reading it as unlimited", () => {
    /*
     * `{ planId, capturedAt }` was what all three writers stored, with no cap
     * values at all. Reading it as a snapshot would give every existing
     * subscription `undefined` for every cap, which `capFor` reads as
     * unlimited — every seller on every plan, uncapped, silently.
     */
    expect(readSnapshot({ planId: "pro", capturedAt: "2026-01-01T00:00:00Z" })).toBeNull();
    expect(readSnapshot(null)).toBeNull();
    expect(readSnapshot("pro")).toBeNull();
  });

  it("keeps a seller on the caps they signed up for", async () => {
    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    const caps = {
      ...plan,
      monthlyPriceAed: Number(plan.monthlyPriceAed),
      rankingMultiplier: Number(plan.rankingMultiplier),
    };
    const frozen = snapshotOf(caps, new Date());

    // The plan changes underneath them.
    const moved = { ...caps, productLimit: 5 };
    const effective = effectiveCaps(moved, frozen);

    expect(effective.productLimit).toBe(caps.productLimit);
    // And the name and price are today's, because those are facts about the
    // plan rather than about what somebody bought.
    expect(effective.name).toBe(moved.name);
  });

  it("can set the storage cap, which had a column and no editor", async () => {
    /*
       `storageMb` was the one cap with a column, a snapshot key, a meter on
       `3m`, a row on `11f`'s grid and an enforcement point in the media library
       — and no way to set it. The value deciding whether a seller can upload
       was reachable only by writing the row by hand, which skips the audit row
       every other entitlement change writes.
    */
    const result = await editPlanEntitlements({
      actor: actor(financeId, "staff_finance"),
      planId,
      changes: { storageMb: 50 },
      applyToExisting: false,
      reason: "Setting the storage cap so the media library has a number to enforce.",
    });
    expect(result).toMatchObject({ ok: true });

    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    expect(plan.storageMb).toBe(50);
  }, 60_000);

  it("reads an empty storage box as unlimited, like every other cap", async () => {
    // Null is unlimited throughout, and it is what every plan carried before
    // this field had an editor. `capFor` guards on `=== null` for the same
    // reason: zero is a real cap and must not read as unlimited.
    await editPlanEntitlements({
      actor: actor(financeId, "staff_finance"),
      planId,
      changes: { storageMb: null },
      applyToExisting: false,
      reason: "Lifting the storage cap while we decide what it should be.",
    });

    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    expect(plan.storageMb).toBeNull();
  }, 60_000);

  it("leaves existing accounts alone unless somebody ticks apply-to-existing", async () => {
    const { businessId } = await payingListing("Grandfathered");
    const before = await effectiveFor(businessId);
    expect(before).not.toBeNull();

    const result = await editPlanEntitlements({
      actor: actor(financeId, "staff_finance"),
      planId,
      changes: { productLimit: 7 },
      applyToExisting: false,
      reason: "Trimming the Basic catalogue cap for new accounts from next month.",
    });
    expect(result).toMatchObject({ ok: true, existingUpdated: 0 });

    const after = await effectiveFor(businessId);
    expect(after!.productLimit).toBe(before!.productLimit);

    // And a new subscription would get the new number.
    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    expect(plan.productLimit).toBe(7);
  }, 60_000);

  it("moves them when somebody does tick it, and says how many", async () => {
    const { businessId } = await payingListing("Applied");

    const result = await editPlanEntitlements({
      actor: actor(financeId, "staff_finance"),
      planId,
      changes: { productLimit: 9 },
      applyToExisting: true,
      reason: "Applying the new Basic cap to everybody, agreed with the founders.",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.existingUpdated).toBeGreaterThan(0);

    const after = await effectiveFor(businessId);
    expect(after!.productLimit).toBe(9);
  }, 60_000);

  it("records the count it moved on the audit row", async () => {
    await editPlanEntitlements({
      actor: actor(financeId, "staff_finance"),
      planId,
      changes: { productLimit: 11 },
      applyToExisting: true,
      reason: "Second change, to check the audit row carries the blast radius.",
    });

    const row = await prisma.auditEvent.findFirstOrThrow({
      where: { action: "entitlements_changed", subject: `Plan:${planId}` },
      orderBy: { createdAt: "desc" },
      select: { after: true },
    });
    const after = row.after as { applyToExisting: boolean; existingUpdated: number };
    expect(after.applyToExisting).toBe(true);
    expect(after.existingUpdated).toBeGreaterThan(0);
  }, 60_000);

  it("counts who is grandfathered, so an edit shows its blast radius", async () => {
    const library = await planLibrary();
    const mine = library.find((plan) => plan.id === planId)!;
    expect(mine.subscriptions).toBeGreaterThan(0);
    expect(mine.grandfathered).toBeGreaterThanOrEqual(0);
  });

  it("refuses a moderator — plan.entitlements.write is ops lead or finance", async () => {
    await expect(
      editPlanEntitlements({
        actor: actor(moderatorId, "staff_moderator"),
        planId,
        changes: { productLimit: 3 },
        applyToExisting: false,
        reason: "Not my row.",
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("lets an ops lead do it too", async () => {
    const result = await editPlanEntitlements({
      actor: actor(opsLeadId, "staff_ops_lead"),
      planId,
      changes: { photoLimit: 22 },
      applyToExisting: false,
      reason: "Raising the Basic photo cap after the storefront work.",
    });
    expect(result.ok).toBe(true);
  });

  it("refuses a cap that is not a whole number in range", async () => {
    const result = await editPlanEntitlements({
      actor: actor(financeId, "staff_finance"),
      planId,
      changes: { productLimit: -1 },
      applyToExisting: false,
      reason: "Minus one products.",
    });
    expect(result).toMatchObject({ ok: false, error: "out_of_range" });
  });

  it("refuses a change that changes nothing", async () => {
    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    const result = await editPlanEntitlements({
      actor: actor(financeId, "staff_finance"),
      planId,
      changes: { productLimit: plan.productLimit },
      applyToExisting: false,
      reason: "Same number.",
    });
    expect(result).toMatchObject({ ok: false, error: "nothing_changed" });
  });
});
