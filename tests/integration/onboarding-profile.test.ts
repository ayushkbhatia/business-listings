import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  activityCovers,
  addExtraCategory,
  allowanceFor,
  clearActivityFlag,
  flaggedCategories,
  removeExtraCategory,
} from "@/lib/onboarding/categories";
import { patchProfileField, profileStateFor } from "@/lib/onboarding/profile";
import { findFanoutCandidates } from "@/lib/enquiry/service";
import { COHORT_MINIMUM, readEnquiryLift } from "@/lib/metrics/enquiry-lift";
import { STRONG_ENOUGH } from "@/lib/metrics/profile-strength";

/**
 * Board 2c, against a real database.
 *
 * The claims worth proving here are the ones about rows: what a plan cap
 * actually refuses, what an unmatched category actually costs a listing, and
 * that the two counters on one screen cannot disagree.
 */

let seller: { id: string; slug: string; planId: string | null };
let spare: { id: string; name: string };

beforeAll(async () => {
  /*
     A plan with room for at least one extra.

     `categoryLimit: { not: null }` alone found a Free listing, whose whole
     allowance is the primary — so every add was correctly refused and the tests
     were asserting against a cap rather than against the behaviour they name.
     `gt: 1` is the fixture these tests actually mean.
  */
  seller = await prisma.business.findFirstOrThrow({
    where: { claimStatus: "claimed", plan: { categoryLimit: { gt: 1 } } },
    orderBy: { slug: "asc" },
    select: { id: true, slug: true, planId: true },
  });

  spare = await prisma.category.findFirstOrThrow({
    where: { children: { none: {} } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
});

afterEach(async () => {
  await prisma.businessCategory.deleteMany({ where: { businessId: seller.id } });
});

afterAll(async () => {
  await prisma.businessCategory.deleteMany({ where: { businessId: seller.id } });
  await prisma.$disconnect();
});

describe("criterion 4 and 7 — two counters, one pair of arrays", () => {
  it("counts extras against the cap minus the primary", () => {
    // "2 of 2 extra used on Basic" — the allowance, not the total. A single
    // counter would have to be wrong on one of them.
    expect(allowanceFor(3, "Basic", 2)).toMatchObject({
      total: 3,
      extras: 2,
      extrasUsed: 2,
      canAddMore: false,
    });
  });

  it("gives Free an allowance of zero, present rather than hidden", () => {
    // Criterion 6. A seller cannot want what they cannot see, and this is the
    // field the plan ladder is actually about.
    expect(allowanceFor(1, "Free", 0)).toMatchObject({
      total: 1,
      extras: 0,
      canAddMore: false,
      extrasExhaustedByPlan: true,
    });
  });

  it("treats a null cap as unlimited", () => {
    expect(allowanceFor(null, "Pro", 9)).toMatchObject({
      total: null,
      extras: null,
      canAddMore: true,
      extrasExhaustedByPlan: false,
    });
  });

  it("derives both counters from the same arrays, so they cannot disagree", async () => {
    const before = await profileStateFor(seller.id);
    expect(before).not.toBeNull();

    await addExtraCategory(seller.id, spare.id);
    const after = await profileStateFor(seller.id);

    const allowance = allowanceFor(after!.categoryLimit, after!.planName, after!.extras.length);
    // The extras counter and the meter's total are one array apart, always.
    expect(allowance.extrasUsed).toBe(after!.extras.length);
    expect(after!.extras.length).toBe((before?.extras.length ?? 0) + 1);
  });
});

describe("the cap is real on the server, not only in the interface", () => {
  it("refuses an extra past the plan's allowance", async () => {
    /*
       Board 2c's third fix, as a property: a control that would be refused on
       click is a lie, and a cap that is real only in the API's rejection is a
       screen that disagrees with its own product. Both halves have to hold.
    */
    const business = await prisma.business.findUniqueOrThrow({
      where: { id: seller.id },
      select: { plan: { select: { categoryLimit: true } }, primaryCategoryId: true },
    });
    const extras = Math.max(0, (business.plan?.categoryLimit ?? 1) - 1);

    const leaves = await prisma.category.findMany({
      where: { children: { none: {} }, id: { not: business.primaryCategoryId } },
      orderBy: { name: "asc" },
      take: extras + 1,
      select: { id: true },
    });

    for (let i = 0; i < extras; i += 1) {
      expect((await addExtraCategory(seller.id, leaves[i]!.id)).ok, `extra ${i}`).toBe(true);
    }
    expect(await addExtraCategory(seller.id, leaves[extras]!.id)).toEqual({
      ok: false,
      reason: "at_cap",
    });
  });

  it("refuses the primary category as an extra, and a duplicate", async () => {
    const business = await prisma.business.findUniqueOrThrow({
      where: { id: seller.id },
      select: { primaryCategoryId: true },
    });
    expect(await addExtraCategory(seller.id, business.primaryCategoryId)).toEqual({
      ok: false,
      reason: "is_primary",
    });

    await addExtraCategory(seller.id, spare.id);
    expect(await addExtraCategory(seller.id, spare.id)).toEqual({
      ok: false,
      reason: "already_there",
    });
  });

  it("removes what it added", async () => {
    await addExtraCategory(seller.id, spare.id);
    await removeExtraCategory(seller.id, spare.id);
    expect((await profileStateFor(seller.id))!.extras).toEqual([]);
  });
});

describe("criterion 8 — a category the licence does not cover", () => {
  it("takes the chip and flags it rather than refusing", async () => {
    // Silently accepting would let a paint trader receive electrical RFQs;
    // silently refusing would tell a legitimate seller their own licence is
    // wrong on a text match against registry prose.
    await prisma.business.update({
      where: { id: seller.id },
      data: { licenceActivity: "Ladies tailoring and embroidery" },
    });

    const result = await addExtraCategory(seller.id, spare.id);
    expect(result).toEqual({ ok: true, unverifiedActivity: true });

    const flagged = await flaggedCategories(seller.id);
    expect(flagged.map((row) => row.categoryId)).toContain(spare.id);
  });

  it("leaves the listing out of that category's fan-out until it is cleared", async () => {
    await prisma.business.update({
      where: { id: seller.id },
      data: { licenceActivity: "Ladies tailoring and embroidery" },
    });
    await addExtraCategory(seller.id, spare.id);

    const flaggedOut = await findFanoutCandidates({
      categoryId: spare.id,
      categoryIds: [spare.id],
      emirate: "dubai",
      lineCount: 1,
      want: 8,
    });
    expect(flaggedOut.map((c) => c.businessId)).not.toContain(seller.id);

    const staff = await prisma.user.findFirstOrThrow({
      where: { roles: { hasSome: ["staff_ops_lead", "staff_moderator"] } },
      select: { id: true },
    });
    await clearActivityFlag(seller.id, spare.id, staff.id);

    const cleared = await findFanoutCandidates({
      categoryId: spare.id,
      categoryIds: [spare.id],
      emirate: "dubai",
      lineCount: 1,
      want: 8,
    });
    // The listing is a candidate now. Whether it is *selected* is the ranker's
    // business; being in the pool is what the flag was withholding.
    expect(cleared.map((c) => c.businessId)).toContain(seller.id);
  });

  it("flags nothing where the licence carried no activity at all", async () => {
    /*
       An import that carried no activity column has told us nothing, and a flag
       raised on silence would put every one of those listings in front of a
       reviewer to say so.
    */
    await prisma.business.update({
      where: { id: seller.id },
      data: { licenceActivity: null },
    });
    expect(await addExtraCategory(seller.id, spare.id)).toEqual({
      ok: true,
      unverifiedActivity: false,
    });
  });

  it("matches on the taxonomy's own synonyms, not a second vocabulary", () => {
    const category = { name: "HVAC & ventilation", synonyms: ["chiller", "ducting"] };
    expect(activityCovers("General contracting and ducting works", category)).toBe(true);
    expect(activityCovers("Chiller maintenance", category)).toBe(true);
    expect(activityCovers("Ladies tailoring", category)).toBe(false);
  });
});

describe("the fields, patched one at a time", () => {
  it("saves a display name and refuses a legal suffix", async () => {
    const suffixed = await patchProfileField(seller.id, "displayName", "Something Cool LLC");
    expect(suffixed).toMatchObject({ ok: false, problem: { kind: "legal_suffix" } });

    const before = await prisma.business.findUniqueOrThrow({
      where: { id: seller.id },
      select: { displayName: true },
    });
    const saved = await patchProfileField(seller.id, "displayName", "Something Cool");
    expect(saved.ok).toBe(true);

    await prisma.business.update({
      where: { id: seller.id },
      data: { displayName: before.displayName },
    });
  });

  it("refuses a description over the cap and keeps the old one", async () => {
    const before = await prisma.business.findUniqueOrThrow({
      where: { id: seller.id },
      select: { description: true },
    });
    const refused = await patchProfileField(seller.id, "description", "x".repeat(601));
    expect(refused).toMatchObject({ ok: false, problem: { kind: "description_too_long" } });

    const after = await prisma.business.findUniqueOrThrow({
      where: { id: seller.id },
      select: { description: true },
    });
    expect(after.description).toBe(before.description);
  });

  it("takes an established year that predates the licence", async () => {
    // A 2014 licence on a business established in 1998 is ordinary — a
    // relocation, or a re-registered entity. Board 1d renders it as
    // self-reported rather than as a verified fact, which is the honest place
    // for that doubt to live.
    expect((await patchProfileField(seller.id, "establishedYear", "1998")).ok).toBe(true);
    expect(await patchProfileField(seller.id, "establishedYear", "1959")).toMatchObject({
      ok: false,
      problem: { kind: "established_out_of_range" },
    });
  });

  it("touches only the field it was given", async () => {
    /*
       Board 2c patches the changed field and nothing else. Posting the whole
       form on every idle is what turns two open tabs into one of them quietly
       writing its ten-minute-old copy over the other's work.
    */
    const before = await prisma.business.findUniqueOrThrow({
      where: { id: seller.id },
      select: { displayName: true, description: true, teamSize: true },
    });

    await patchProfileField(seller.id, "establishedYear", "2011");

    const after = await prisma.business.findUniqueOrThrow({
      where: { id: seller.id },
      select: { displayName: true, description: true, teamSize: true },
    });
    expect(after).toEqual(before);
  });
});

describe("criterion 15 — the 2.4× claim is a query, and it has no answer yet", () => {
  it("returns null until both cohorts clear the floor", async () => {
    /*
       CLAUDE.md's honesty rule: every number is a query. This is a cold-start
       surface, so at launch the query has no answer and the callout falls back
       to the mechanism — which is true on day one because it describes the
       filter behaviour on the results page rather than a measured result.
    */
    const lift = await readEnquiryLift();
    if (lift === null) {
      /*
         Assert the reason, not a proxy for it. Counting every published listing
         says nothing about the split: the query cuts on strength, and a
         directory with a hundred listings can still have four above the
         threshold. Count the two sides the way the query does.
      */
      const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const where = {
        suspendedAt: null,
        publishedAt: { not: null, lte: since },
        claimStatus: "claimed" as const,
        profileStrength: { not: null },
      };
      const [strong, weak] = await Promise.all([
        prisma.business.count({ where: { ...where, profileStrength: { gte: STRONG_ENOUGH } } }),
        prisma.business.count({ where: { ...where, profileStrength: { lt: STRONG_ENOUGH } } }),
      ]);
      expect(Math.min(strong, weak)).toBeLessThan(COHORT_MINIMUM);
      return;
    }

    expect(lift.strongListings).toBeGreaterThanOrEqual(COHORT_MINIMUM);
    expect(lift.weakListings).toBeGreaterThanOrEqual(COHORT_MINIMUM);
    expect(lift.threshold).toBe(STRONG_ENOUGH);
    expect(lift.multiple).toBeGreaterThanOrEqual(1.1);
  });
});
