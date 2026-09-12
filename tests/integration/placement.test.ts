import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { takeSlot } from "@/lib/placement/service";
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
  await prisma.$disconnect();
});

describe("a slot is sold to a plan that includes one, and to nobody else", () => {
  it("refuses an owner whose plan is not sponsored-eligible", async () => {
    const { businessId, ownerId } = await makeSeller(ineligiblePlanId);
    const result = await takeSlot(actor(ownerId, businessId, "seller_owner"), businessId, categoryId);

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

    const result = await takeSlot(actor(ownerId, businessId, "seller_owner"), businessId, ownCategory.id);
    expect(result).toMatchObject({ ok: true, queued: false });

    const slot = await prisma.placementSlot.findFirstOrThrow({ where: { businessId } });
    expect(slot.categoryId).toBe(ownCategory.id);
    // The national slot. The emirate dimension is designed and unbuilt, and
    // board 11e (step 6.3) is where it lands — pinned here so it is a change
    // somebody makes rather than one that happens.
    expect(slot.emirate).toBeNull();

    await prisma.placementSlot.deleteMany({ where: { businessId } });
    await prisma.category.deleteMany({ where: { id: ownCategory.id } });
  }, 30_000);

  it("refuses a seat that may not buy placement at all", async () => {
    const { businessId, ownerId } = await makeSeller(eligiblePlanId);
    // `placement.purchase` is owner and finance. A sales seat is neither, and
    // the capability is asserted before the plan is even read.
    await expect(
      takeSlot(actor(ownerId, businessId, "seller_sales"), businessId, categoryId),
    ).rejects.toBeInstanceOf(PermissionError);
  }, 30_000);

  it("refuses an owner buying for somebody else's business", async () => {
    const mine = await makeSeller(eligiblePlanId);
    const theirs = await makeSeller(eligiblePlanId);

    const result = await takeSlot(
      actor(mine.ownerId, mine.businessId, "seller_owner"),
      theirs.businessId,
      categoryId,
    );
    expect(result).toMatchObject({ ok: false });
    const slots = await prisma.placementSlot.count({ where: { businessId: theirs.businessId } });
    expect(slots).toBe(0);
  }, 30_000);
});
