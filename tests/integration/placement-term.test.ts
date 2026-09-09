import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  endPlacementsFor,
  SLOT_TERM_DAYS,
  unusedPlacementFils,
} from "@/lib/placement/term";
import { applyEndedCancellations } from "@/lib/billing/service";
import { slotsFor } from "@/lib/placement/service";

/**
 * Decision D2 — a sponsored slot belongs to the subscription that bought it.
 *
 * The rule has three enders (cancellation, downgrade, dunning) and one
 * function, because three enders is three chances for one of them to forget the
 * waitlist. What is asserted here is the function and the path most likely to
 * be exercised in production, plus the arithmetic a seller would argue with.
 *
 * Before this decision the tree said both things at once: `lib/billing/cancel-table.ts`
 * told a cancelling seller their placement "runs to 30 Sep under its own term"
 * and stamped the same row `ends`, in red. Nothing ended it either way.
 */

const PREFIX = "placement-term-test-";
let categoryId: string;
let planId: string;
const madeBusinesses: string[] = [];
let seq = 0;
const stamp = () => `${Date.now().toString(36)}${(seq += 1)}`;

async function makeSeller(): Promise<string> {
  const mark = stamp();
  const business = await prisma.business.create({
    data: {
      displayName: `${PREFIX}${mark}`,
      tradeName: `${PREFIX}${mark} LLC`,
      slug: `${PREFIX}${mark}`,
      licenceNumber: `DED-T${mark.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
      primaryCategoryId: categoryId,
      claimStatus: "claimed",
      planId,
      publishedAt: new Date(),
      verificationTier: 2,
      verifiedAt: new Date(),
    },
    select: { id: true },
  });
  madeBusinesses.push(business.id);
  return business.id;
}

const madeCategories: string[] = [];

/**
 * A category of this test's own.
 *
 * The queue is keyed on the category, so two tests sharing one share a queue —
 * and `freed` is a question about *your* position in it. The first version of
 * this file shared a category and the last test read the first test's queue.
 */
async function freshCategory(): Promise<string> {
  const category = await prisma.category.create({
    data: { slug: `${PREFIX}cat-${stamp()}`, name: "Placement term fixture", code: "PTF" },
    select: { id: true },
  });
  madeCategories.push(category.id);
  return category.id;
}

async function giveSlot(businessId: string, endsOn: Date, priceAed = 450, scope = categoryId) {
  return prisma.placementSlot.create({
    data: {
      businessId,
      categoryId: scope,
      monthlyPriceAed: priceAed,
      startsOn: new Date(Date.now() - 5 * 86_400_000),
      endsOn,
    },
    select: { id: true },
  });
}

beforeAll(async () => {
  categoryId = await freshCategory();

  const plan = await prisma.plan.create({
    data: {
      id: `${PREFIX}plan-${stamp()}`,
      name: "Placement term fixture plan",
      monthlyPriceAed: 899,
      teamSeats: 5,
      sponsoredEligible: true,
      sortOrder: 960,
    },
    select: { id: true },
  });
  planId = plan.id;
});

afterAll(async () => {
  for (const businessId of madeBusinesses.splice(0)) {
    await prisma.placementWaitlist.deleteMany({ where: { businessId } });
    await prisma.placementSlot.deleteMany({ where: { businessId } });
    await prisma.subscription.deleteMany({ where: { businessId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
  }
  for (const id of madeCategories.splice(0)) {
    await prisma.placementSlot.deleteMany({ where: { categoryId: id } });
    await prisma.placementWaitlist.deleteMany({ where: { categoryId: id } });
    await prisma.category.deleteMany({ where: { id } });
  }
  await prisma.plan.deleteMany({ where: { id: planId } });
  await prisma.$disconnect();
});

describe("what a seller is owed for days they will not get", () => {
  it("prices the remainder of a thirty-day term", () => {
    const now = new Date("2026-09-10T00:00:00.000Z");
    const endsOn = new Date("2026-09-25T00:00:00.000Z");
    const owed = unusedPlacementFils(450, endsOn, now);
    expect(owed.days).toBe(15);
    // 450 × 15/30 = 225.00
    expect(owed.fils).toBe(22_500);
  });

  it("owes nothing for a slot with no end date", () => {
    expect(unusedPlacementFils(450, null, new Date())).toEqual({ days: 0, fils: 0 });
  });

  it("owes nothing once the term has already run out", () => {
    const now = new Date("2026-09-30T00:00:00.000Z");
    expect(unusedPlacementFils(450, new Date("2026-09-20T00:00:00.000Z"), now).fils).toBe(0);
  });

  it("prices from what the slot actually cost, not from the list price", () => {
    // The seed carries a Dubai slot at 1,200 against a 450 list price. A credit
    // computed from the constant would short that seller by nearly two thirds.
    const now = new Date("2026-09-10T00:00:00.000Z");
    const endsOn = new Date("2026-09-25T00:00:00.000Z");
    expect(unusedPlacementFils(1200, endsOn, now).fils).toBe(60_000);
  });

  it("agrees with the term the slot is sold in", () => {
    expect(SLOT_TERM_DAYS).toBe(30);
  });
});

describe("ending a slot", () => {
  it("stops it, and tells whoever is first in the queue", async () => {
    const holder = await makeSeller();
    const waiting = await makeSeller();
    const alsoWaiting = await makeSeller();
    const now = new Date();

    const slot = await giveSlot(holder, new Date(now.getTime() + 20 * 86_400_000));
    // Two in the queue, in the order they joined. Only the first is told.
    await prisma.placementWaitlist.create({
      data: { businessId: waiting, categoryId, createdAt: new Date(now.getTime() - 60_000) },
    });
    await prisma.placementWaitlist.create({
      data: { businessId: alsoWaiting, categoryId, createdAt: now },
    });

    const ended = await prisma.$transaction((tx) =>
      endPlacementsFor(tx, holder, now, "cancelled"),
    );

    expect(ended).toHaveLength(1);
    expect(ended[0]!.nextInQueue).toBe(waiting);
    expect(ended[0]!.reason).toBe("cancelled");
    expect(ended[0]!.unusedDays).toBeGreaterThan(0);

    // The row keeps its dates rather than being deleted, so revenue reporting
    // can still say what was sold and for how long.
    const after = await prisma.placementSlot.findUniqueOrThrow({ where: { id: slot.id } });
    expect(after.endsOn?.getTime()).toBe(now.getTime());

    const told = await prisma.placementWaitlist.findFirstOrThrow({
      where: { businessId: waiting, categoryId },
    });
    expect(told.notifiedAt).not.toBeNull();

    const notTold = await prisma.placementWaitlist.findFirstOrThrow({
      where: { businessId: alsoWaiting, categoryId },
    });
    expect(notTold.notifiedAt).toBeNull();
  }, 60_000);

  it("ends a slot scoped to an emirate, which the buying screen cannot even see", async () => {
    /*
       `slotsFor` and `takeSlot` are national-only until the per-emirate picker
       lands. The ender must not inherit that blind spot — the seed carries a
       Dubai slot, so a seller keeping the top of a category after cancelling is
       a case that exists rather than one being defended against.
    */
    const holder = await makeSeller();
    const now = new Date();
    await prisma.placementSlot.create({
      data: {
        businessId: holder,
        categoryId,
        emirate: "dubai",
        monthlyPriceAed: 1200,
        startsOn: new Date(now.getTime() - 86_400_000),
        endsOn: new Date(now.getTime() + 10 * 86_400_000),
      },
    });

    const ended = await prisma.$transaction((tx) =>
      endPlacementsFor(tx, holder, now, "downgraded"),
    );
    expect(ended).toHaveLength(1);
    expect(ended[0]!.emirate).toBe("dubai");
    expect(ended[0]!.monthlyPriceAed).toBe(1200);
  }, 60_000);

  it("shows an emirate-scoped slot as held, rather than as available", async () => {
    /*
       The read had the same blind spot as the write, and only the write's was
       a documented limitation.

       `slotsFor` filtered on `emirate === null`, so the seller holding the
       seeded Dubai slot was shown that category as "Available, AED 450 a
       month" — their own slot, invisible, at the wrong price, with a button
       offering to sell them a second one.
    */
    const scope = await freshCategory();
    const holder = await makeSeller();
    const now = new Date();
    await prisma.placementSlot.create({
      data: {
        businessId: holder,
        categoryId: scope,
        emirate: "dubai",
        monthlyPriceAed: 1200,
        startsOn: new Date(now.getTime() - 86_400_000),
        endsOn: new Date(now.getTime() + 10 * 86_400_000),
      },
    });

    const view = await slotsFor(holder, [scope], now);
    expect(view[0]?.mine).toBe(true);
    expect(view[0]?.emirate).toBe("dubai");
    // From the row, not from `SLOT_MONTHLY_AED`.
    expect(view[0]?.monthlyPriceAed).toBe(1200);
  }, 60_000);

  it("does nothing to a slot that already ended", async () => {
    const holder = await makeSeller();
    const now = new Date();
    await giveSlot(holder, new Date(now.getTime() - 86_400_000));

    const ended = await prisma.$transaction((tx) => endPlacementsFor(tx, holder, now, "lapsed"));
    expect(ended).toEqual([]);
  }, 60_000);
});

describe("the cancellation that reaches its date takes the slot with it", () => {
  it("ends the placement and frees it for the queue", async () => {
    const scope = await freshCategory();
    const holder = await makeSeller();
    const waiting = await makeSeller();
    const now = new Date();

    await prisma.subscription.create({
      data: {
        businessId: holder,
        planId,
        status: "active",
        startedAt: new Date(now.getTime() - 90 * 86_400_000),
        renewsAt: new Date(now.getTime() - 86_400_000),
        // Cancelled, and its date has arrived.
        cancelledAt: new Date(now.getTime() - 10 * 86_400_000),
        endsAt: new Date(now.getTime() - 60_000),
      },
    });
    await giveSlot(holder, new Date(now.getTime() + 15 * 86_400_000), 450, scope);
    await prisma.placementWaitlist.create({
      data: { businessId: waiting, categoryId: scope },
    });

    const result = await applyEndedCancellations(now);
    expect(result.placementsEnded).toBeGreaterThanOrEqual(1);

    const live = await prisma.placementSlot.count({
      where: {
        businessId: holder,
        startsOn: { lte: now },
        OR: [{ endsOn: null }, { endsOn: { gt: now } }],
      },
    });
    expect(live).toBe(0);

    // And the seller who was waiting is told, on the screen that reads it.
    const view = await slotsFor(waiting, [scope], new Date(now.getTime() + 1000));
    expect(view[0]?.freed).toBe(true);
  }, 60_000);
});
