import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { takeSlot } from "@/lib/placement/service";
import { priceScopes, runDemandBands } from "@/lib/placement/demand";
import { PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";

/**
 * Sponsored placement — the only path in this product that sells anything, and
 * until now the only service directory with no test of any kind.
 *
 * `rg -l "lib/placement" tests/` returned nothing across unit, integration and
 * e2e. `takeSlot` creates a slot, joins a queue and refuses three ways, and
 * none of those four outcomes was asserted anywhere.
 *
 * What this file pins is the gate that was missing rather than wrong.
 * `placement.purchase` says a seat may buy for its own business; it says
 * nothing about whether the business's plan includes placement. Nothing read
 * `Plan.sponsoredEligible` on this route, so a Free-plan owner could take a
 * slot — a slot that is seeded false for Free, has an editor at /admin/plans,
 * renders as its own row on the plan comparison grid, and is promised in
 * onboarding copy.
 *
 * Plans of this file's own, because `commercials.test.ts` learned the same
 * lesson: editing a shared seed plan leaves the development database on numbers
 * nobody chose, and the second run then asserts against the first run's edits.
 */

const actor = (id: string, businessId: string, ...roles: Role[]): Actor => ({
  id,
  roles,
  businessId,
});

let categoryId: string;
let eligiblePlanId: string;
let ineligiblePlanId: string;
const madeBusinesses: string[] = [];
const madePlans: string[] = [];
const madeCategories: string[] = [];
const stamp = () => `${Date.now().toString(36)}${Math.floor(performance.now())}`;

async function makePlan(sponsoredEligible: boolean): Promise<string> {
  const id = `placement-test-${sponsoredEligible ? "on" : "off"}-${stamp()}`;
  await prisma.plan.create({
    data: {
      id,
      name: `Placement fixture ${sponsoredEligible ? "eligible" : "ineligible"}`,
      monthlyPriceAed: 299,
      enquiriesPerMonth: null,
      productLimit: null,
      serviceLimit: null,
      locationLimit: null,
      photoLimit: null,
      teamSeats: 5,
      sponsoredEligible,
      sortOrder: 900,
    },
  });
  madePlans.push(id);
  return id;
}

async function makeSeller(planId: string): Promise<{ businessId: string; ownerId: string }> {
  const mark = stamp();
  const business = await prisma.business.create({
    data: {
      displayName: `Placement Fixture ${mark}`,
      tradeName: `Placement Fixture ${mark} LLC`,
      slug: `placement-fixture-${mark}`,
      licenceNumber: `DED-P${mark.slice(-6)}`,
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
  return { businessId: business.id, ownerId: crypto.randomUUID() };
}

beforeAll(async () => {
  const category = await prisma.category.findFirstOrThrow({
    where: { slug: "valves-and-fittings" },
    select: { id: true },
  });
  categoryId = category.id;
  eligiblePlanId = await makePlan(true);
  ineligiblePlanId = await makePlan(false);
});

afterAll(async () => {
  for (const businessId of madeBusinesses.splice(0)) {
    await prisma.placementWaitlist.deleteMany({ where: { businessId } });
    await prisma.placementSlot.deleteMany({ where: { businessId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
  }
  for (const id of madePlans.splice(0)) {
    await prisma.plan.deleteMany({ where: { id } });
  }
  /*
     The categories this file made, and everything hanging off them: a scope's
     demand band, its click counter and its position rows all cascade from the
     category, so one delete takes the lot.
  */
  for (const id of madeCategories.splice(0)) {
    await prisma.category.deleteMany({ where: { id } });
  }
  await prisma.$disconnect();
});

describe("a slot is sold to a plan that includes one, and to nobody else", () => {
  it("refuses an owner whose plan is not sponsored-eligible", async () => {
    const { businessId, ownerId } = await makeSeller(ineligiblePlanId);
    const result = await takeSlot(
      actor(ownerId, businessId, "seller_owner"),
      businessId,
      categoryId,
      "dubai",
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Names the plan, because "not on your plan" without saying which plan is
    // a refusal a seller cannot act on.
    expect(result.error).toContain("Placement fixture ineligible");

    // The refusal is the row not existing, not a message over a row that does.
    const slots = await prisma.placementSlot.count({ where: { businessId } });
    expect(slots).toBe(0);
  }, 30_000);

  it("sells to an owner whose plan includes it", async () => {
    const { businessId, ownerId } = await makeSeller(eligiblePlanId);
    // A category of this pair's own, so the two tests cannot race for one slot.
    const ownCategory = await prisma.category.create({
      data: {
        slug: `placement-cat-${stamp()}`,
        name: "Placement fixture trade",
        code: "PLF",
      },
      select: { id: true },
    });

    const result = await takeSlot(
      actor(ownerId, businessId, "seller_owner"),
      businessId,
      ownCategory.id,
      "dubai",
    );
    expect(result).toMatchObject({ ok: true, queued: false });

    const slot = await prisma.placementSlot.findFirstOrThrow({ where: { businessId } });
    expect(slot.categoryId).toBe(ownCategory.id);
    /*
       One trade in one emirate, which is the inventory board `11e` sells and
       which landed with the demand pricing. It used to be the national slot,
       pinned here as a limitation; the national scope is now read-only —
       `takeSlot` refuses to create another one.
    */
    expect(slot.emirate).toBe("dubai");
    // And the band it was sold in, stored beside the price it was sold at.
    expect(slot.band).not.toBeNull();
    expect(slot.monthlyPriceAed).toBeGreaterThanOrEqual(300);

    await prisma.placementSlot.deleteMany({ where: { businessId } });
    await prisma.category.deleteMany({ where: { id: ownCategory.id } });
  }, 30_000);

  it("refuses a seat that may not buy placement at all", async () => {
    const { businessId, ownerId } = await makeSeller(eligiblePlanId);
    // `placement.purchase` is owner and finance. A sales seat is neither, and
    // the capability is asserted before the plan is even read.
    await expect(
      takeSlot(actor(ownerId, businessId, "seller_sales"), businessId, categoryId, "dubai"),
    ).rejects.toBeInstanceOf(PermissionError);
  }, 30_000);

  it("refuses an owner buying for somebody else's business", async () => {
    const mine = await makeSeller(eligiblePlanId);
    const theirs = await makeSeller(eligiblePlanId);

    const result = await takeSlot(
      actor(mine.ownerId, mine.businessId, "seller_owner"),
      theirs.businessId,
      categoryId,
      "dubai",
    );
    expect(result).toMatchObject({ ok: false });
    const slots = await prisma.placementSlot.count({ where: { businessId: theirs.businessId } });
    expect(slots).toBe(0);
  }, 30_000);
});

/**
 * Board `11e` — the inventory and the price, which arrived together.
 *
 * A slot used to be one category, everywhere, at a flat AED 450. It is now one
 * trade in one emirate at a price cut from what buyers did there, and the two
 * halves of that are what these assert: that the scope is really the unit, and
 * that the figure a seller is charged is the one they were quoted and stays it.
 */
describe("one trade in one emirate is the unit", () => {
  const freshCategory = async (): Promise<string> => {
    const mark = stamp();
    const category = await prisma.category.create({
      data: { slug: `placement-scope-${mark}`, name: `Placement scope ${mark}`, code: "PLS" },
      select: { id: true },
    });
    madeCategories.push(category.id);
    return category.id;
  };

  it("sells the same trade twice, in two emirates", async () => {
    /*
       The whole point of the emirate dimension. Under the national model the
       second of these was refused — one slot per category, everywhere — and a
       Sharjah supplier could be locked out of their own city by a Dubai one.
    */
    const scope = await freshCategory();
    const first = await makeSeller(eligiblePlanId);
    const second = await makeSeller(eligiblePlanId);

    expect(
      await takeSlot(actor(first.ownerId, first.businessId, "seller_owner"), first.businessId, scope, "dubai"),
    ).toMatchObject({ ok: true, queued: false });
    expect(
      await takeSlot(actor(second.ownerId, second.businessId, "seller_owner"), second.businessId, scope, "sharjah"),
    ).toMatchObject({ ok: true, queued: false });

    const slots = await prisma.placementSlot.findMany({
      where: { categoryId: scope },
      select: { emirate: true },
    });
    expect(slots.map((slot) => slot.emirate).sort()).toEqual(["dubai", "sharjah"]);
  }, 30_000);

  it("queues the second seller for the same emirate rather than selling it twice", async () => {
    const scope = await freshCategory();
    const first = await makeSeller(eligiblePlanId);
    const second = await makeSeller(eligiblePlanId);

    await takeSlot(actor(first.ownerId, first.businessId, "seller_owner"), first.businessId, scope, "dubai");
    const queued = await takeSlot(
      actor(second.ownerId, second.businessId, "seller_owner"),
      second.businessId,
      scope,
      "dubai",
    );
    expect(queued).toMatchObject({ ok: true, queued: true });

    expect(await prisma.placementSlot.count({ where: { categoryId: scope } })).toBe(1);
    const line = await prisma.placementWaitlist.findMany({ where: { categoryId: scope } });
    expect(line).toHaveLength(1);
    expect(line[0]!.emirate).toBe("dubai");
  }, 30_000);

  it("sells one slot when two sellers press the button at once (B9)", async () => {
    /*
       The race the advisory lock closes.

       This was a read followed by a write with nothing between them, and the
       comment above it claimed a partial unique index enforced the rule — the
       index it named is on `placement_waitlist`, not on `placement_slot`.
       Both callers would have seen the scope free and both would have bought
       it, and `getSponsoredBusinessId` carries its own comment about what it
       does on the day that has happened.
    */
    const scope = await freshCategory();
    const first = await makeSeller(eligiblePlanId);
    const second = await makeSeller(eligiblePlanId);

    const [a, b] = await Promise.all([
      takeSlot(actor(first.ownerId, first.businessId, "seller_owner"), first.businessId, scope, "dubai"),
      takeSlot(actor(second.ownerId, second.businessId, "seller_owner"), second.businessId, scope, "dubai"),
    ]);

    expect(await prisma.placementSlot.count({ where: { categoryId: scope } })).toBe(1);
    // One sale and one queue place, in whichever order they arrived.
    const outcomes = [a, b].map((result) => (result.ok ? result.queued : "refused"));
    expect([...outcomes].sort()).toEqual([false, true]);
  }, 30_000);

  it("refuses a country-wide purchase, which is no longer a thing we sell", async () => {
    const scope = await freshCategory();
    const seller = await makeSeller(eligiblePlanId);
    const result = await takeSlot(
      actor(seller.ownerId, seller.businessId, "seller_owner"),
      seller.businessId,
      scope,
      null,
    );
    expect(result).toMatchObject({ ok: false });
    expect(await prisma.placementSlot.count({ where: { categoryId: scope } })).toBe(0);
  }, 30_000);

  it("lets a legacy country-wide slot block an emirate underneath it", async () => {
    /*
       Slots bought before the emirate existed still run, and one of them covers
       every emirate in its category. Selling Dubai under it would sell a slot
       `getSponsoredBusinessId` would never give the buyer — it takes the
       earliest live slot over the scope, which is the national one.
    */
    const scope = await freshCategory();
    const holder = await makeSeller(eligiblePlanId);
    const other = await makeSeller(eligiblePlanId);
    await prisma.placementSlot.create({
      data: {
        businessId: holder.businessId,
        categoryId: scope,
        emirate: null,
        monthlyPriceAed: 450,
        startsOn: new Date(Date.now() - 86_400_000),
        endsOn: new Date(Date.now() + 10 * 86_400_000),
      },
    });

    const result = await takeSlot(
      actor(other.ownerId, other.businessId, "seller_owner"),
      other.businessId,
      scope,
      "dubai",
    );
    expect(result).toMatchObject({ ok: true, queued: true });
    expect(await prisma.placementSlot.count({ where: { categoryId: scope } })).toBe(1);
  }, 30_000);
});

describe("the price is the band's, and it is frozen at booking", () => {
  it("stamps the band and the price it was sold at", async () => {
    const mark = stamp();
    const category = await prisma.category.create({
      data: { slug: `placement-price-${mark}`, name: `Placement price ${mark}`, code: "PLP" },
      select: { id: true },
    });
    madeCategories.push(category.id);

    // A scope with real traffic behind it, banded by the real classifier.
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    const seller = await makeSeller(eligiblePlanId);
    await prisma.categoryPositionDay.create({
      data: {
        businessId: seller.businessId,
        categoryId: category.id,
        emirate: "dubai",
        day,
        position: 1,
        impressions: 9_000,
      },
    });
    await runDemandBands();

    const banded = await prisma.scopeDemandBand.findFirstOrThrow({
      where: { categoryId: category.id, emirate: "dubai" },
    });
    const card = await prisma.placementBand.findUniqueOrThrow({ where: { band: banded.band } });

    const result = await takeSlot(
      actor(seller.ownerId, seller.businessId, "seller_owner"),
      seller.businessId,
      category.id,
      "dubai",
    );
    expect(result).toMatchObject({ ok: true, queued: false });

    const slot = await prisma.placementSlot.findFirstOrThrow({
      where: { businessId: seller.businessId, categoryId: category.id },
    });
    expect(slot.band).toBe(banded.band);
    expect(slot.monthlyPriceAed).toBe(card.monthlyPriceAed);

    /*
       And it stays. A band moves on the first of each month; the slot does not
       — an invoice line that re-derived its own price would restate a charge
       that has already been sent.
    */
    await prisma.placementBand.update({
      where: { band: banded.band },
      data: { monthlyPriceAed: card.monthlyPriceAed + 111 },
    });
    const after = await prisma.placementSlot.findFirstOrThrow({ where: { id: slot.id } });
    expect(after.monthlyPriceAed).toBe(card.monthlyPriceAed);
    await prisma.placementBand.update({
      where: { band: banded.band },
      data: { monthlyPriceAed: card.monthlyPriceAed },
    });
  }, 60_000);

  it("prices an unmeasured scope at the floor, and says it is unmeasured", async () => {
    // The cold-start state, and it is a designed one: nobody has visited this
    // trade, so it is band 1 at the floor and the row says so rather than
    // printing a nought that reads as a measurement.
    const mark = stamp();
    const category = await prisma.category.create({
      data: { slug: `placement-quiet-${mark}`, name: `Placement quiet ${mark}`, code: "PLQ" },
      select: { id: true },
    });
    madeCategories.push(category.id);

    const [price] = await priceScopes([{ categoryId: category.id, emirate: "fujairah" }]);
    expect(price?.band).toBe(1);
    expect(price?.measuredTo).toBeNull();
    expect(price?.appearances).toBeNull();

    const floor = await prisma.placementBand.findUniqueOrThrow({ where: { band: 1 } });
    expect(price?.monthlyPriceAed).toBe(floor.monthlyPriceAed);
  }, 30_000);
});
