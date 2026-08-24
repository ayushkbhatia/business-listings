import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { createEnquiry } from "@/lib/enquiry/service";
import { getOverview, usageOf } from "@/lib/db/queries/overview";
import { monthStart } from "@/lib/plan/entitlements";

/**
 * Handoff 3 criterion 5, against a real database.
 *
 *   "A Free-plan seller at their cap sees the missed-enquiry list with real
 *    dates and requirements, and every locked panel names what unlocks it."
 *
 * The half that can go wrong silently is the first: `selectRecipients` has
 * always computed who it skipped and `createEnquiry` used to return that to the
 * caller and write nothing, so the number the free dashboard exists to argue
 * from did not survive the request that produced it. These tests fail if that
 * regresses, because the board would then be empty rather than wrong, which is
 * far harder to notice.
 */

const FREE_AT_CAP_SLUG = "al-manara-equipment-trading-llc";

let buyerId: string;
let categoryId: string;
const createdEnquiryIds: string[] = [];

beforeAll(async () => {
  const buyer = await prisma.user.findFirstOrThrow({
    where: { roles: { has: "buyer" } },
    select: { id: true },
  });
  buyerId = buyer.id;

  const category = await prisma.category.findFirstOrThrow({
    where: { slug: "valves-and-fittings" },
    select: { id: true },
  });
  categoryId = category.id;
});

afterAll(async () => {
  for (const id of createdEnquiryIds.splice(0)) {
    await prisma.enquiry.deleteMany({ where: { id } });
  }
  await prisma.$disconnect();
});

describe("criterion 5 — the seed sits exactly on the cap it demonstrates", () => {
  it("has a free seller with as many enquiries this month as the plan allows", async () => {
    const business = await prisma.business.findUniqueOrThrow({
      where: { slug: FREE_AT_CAP_SLUG },
      select: { id: true, planId: true },
    });
    expect(business.planId).toBe("free");

    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: "free" } });
    const received = await prisma.enquiryRecipient.count({
      where: { businessId: business.id, createdAt: { gte: monthStart(new Date()) } },
    });

    // Not "at least". A board that says a three-enquiry limit was reached, over
    // a counter reading eight, is arguing against its own numbers.
    expect(received).toBe(plan.enquiriesPerMonth);
  });

  it("shows the missed enquiries with what the buyer actually asked for", async () => {
    const business = await prisma.business.findUniqueOrThrow({
      where: { slug: FREE_AT_CAP_SLUG },
      select: { id: true },
    });

    const overview = await getOverview(business.id);
    expect(overview).not.toBeNull();
    expect(overview!.missedThisMonth).toBeGreaterThan(0);

    for (const missed of overview!.missed) {
      expect(missed.ref).toMatch(/^ENQ-/);
      // A row reading "Historical enquiry" makes the board's argument badly.
      expect(missed.requirement.length).toBeGreaterThan(20);
      expect(missed.lines.length).toBeGreaterThan(0);
      expect(missed.missedAt.getTime()).toBeGreaterThanOrEqual(monthStart(new Date()).getTime());
      expect(missed.reason).toBe("at_monthly_cap");
    }
  });

  it("reports the seller as at their cap, with nothing left", async () => {
    // Reads through the same helper the screen uses, so the panel and the
    // counter beside it cannot disagree.
    const business = await prisma.business.findUniqueOrThrow({
      where: { slug: FREE_AT_CAP_SLUG },
      select: { id: true },
    });
    const overview = await getOverview(business.id);
    const enquiries = usageOf(overview!, "enquiries");
    expect(enquiries.atCap).toBe(true);
    expect(enquiries.remaining).toBe(0);
  });
});

describe("criterion 5 — a skipped seller is recorded, not just skipped", () => {
  it("writes a MissedEnquiry row when the fan-out passes a capped seller over", async () => {
    const capped = await prisma.business.findUniqueOrThrow({
      where: { slug: FREE_AT_CAP_SLUG },
      select: { id: true },
    });

    const before = await prisma.missedEnquiry.count({ where: { businessId: capped.id } });

    const result = await createEnquiry({
      buyerId,
      categoryId,
      requirement: "Gate valves DN200, flanged, for a pump room in Mussafah.",
      lines: [{ description: "Resilient seated gate valve DN200", qty: 12 }],
      fanoutTo: 5,
      closesInDays: 7,
      // Pinned deliberately. Even a seller the buyer asked for is skipped when
      // they cannot reply — putting them on the enquiry costs the buyer a slot
      // and gets the seller nothing.
      pinnedBusinessIds: [capped.id],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdEnquiryIds.push(result.enquiryId);

    expect(result.recipients.map((r) => r.businessId)).not.toContain(capped.id);
    expect(result.skipped.map((s) => s.businessId)).toContain(capped.id);

    const after = await prisma.missedEnquiry.count({ where: { businessId: capped.id } });
    expect(after).toBe(before + 1);

    const row = await prisma.missedEnquiry.findUniqueOrThrow({
      where: { enquiryId_businessId: { enquiryId: result.enquiryId, businessId: capped.id } },
    });
    expect(row.reason).toBe("at_monthly_cap");
  });

  it("puts the new miss on the seller's overview, with its line items", async () => {
    const capped = await prisma.business.findUniqueOrThrow({
      where: { slug: FREE_AT_CAP_SLUG },
      select: { id: true },
    });

    const result = await createEnquiry({
      buyerId,
      categoryId,
      requirement: "Butterfly valves DN300 and gearboxes for a chilled water plant.",
      lines: [
        { description: "Butterfly valve, lugged, DN300", qty: 8, unit: "pcs" },
        { description: "Gearbox operator", qty: 8, unit: "pcs" },
      ],
      fanoutTo: 5,
      closesInDays: 14,
      pinnedBusinessIds: [capped.id],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdEnquiryIds.push(result.enquiryId);

    const overview = await getOverview(capped.id);
    const missed = overview!.missed.find((m) => m.enquiryId === result.enquiryId);
    expect(missed).toBeDefined();
    expect(missed!.requirement).toContain("Butterfly valves DN300");
    expect(missed!.lines).toHaveLength(2);
    expect(missed!.stillOpen).toBe(true);
  });

  it("does not turn a missed enquiry into a lead", async () => {
    // The reason this is a separate table rather than a RecipientState. If a
    // miss could appear as a delivery, the leads inbox, the nav badges and the
    // response-time median would each have to remember to exclude it.
    const capped = await prisma.business.findUniqueOrThrow({
      where: { slug: FREE_AT_CAP_SLUG },
      select: { id: true },
    });

    const missedIds = (
      await prisma.missedEnquiry.findMany({
        where: { businessId: capped.id },
        select: { enquiryId: true },
      })
    ).map((m) => m.enquiryId);
    expect(missedIds.length).toBeGreaterThan(0);

    const overlap = await prisma.enquiryRecipient.count({
      where: { businessId: capped.id, enquiryId: { in: missedIds } },
    });
    expect(overlap).toBe(0);
  });
});

describe("criterion 5 — every locked panel names what unlocks it", () => {
  it("offers a real, cheaper-than-Pro plan to a free seller who is capped", async () => {
    const business = await prisma.business.findUniqueOrThrow({
      where: { slug: FREE_AT_CAP_SLUG },
      select: { id: true },
    });
    const overview = await getOverview(business.id);

    const { cheapestPlanUnlocking, cheapestPlanWith } = await import("@/lib/plan/entitlements");

    const forEnquiries = cheapestPlanUnlocking(
      overview!.allPlans,
      "enquiries",
      overview!.usage.enquiriesThisMonth,
      overview!.plan.id,
    );
    expect(forEnquiries?.id).toBe("basic");
    // The line on the panel is "{plan}, AED {price}", so both have to be real.
    expect(forEnquiries?.monthlyPriceAed).toBeGreaterThan(0);

    // Two features that are genuinely a column, so the sentence is checkable.
    expect(cheapestPlanWith(overview!.allPlans, "customDomain", "free")?.id).toBe("pro");
    expect(cheapestPlanWith(overview!.allPlans, "siteVisitIncluded", "free")?.id).toBe("pro");
  });

  it("offers nothing to a seller already on the best plan for it", async () => {
    const pro = await prisma.business.findFirstOrThrow({
      where: { planId: "pro" },
      select: { id: true },
    });
    const overview = await getOverview(pro.id);
    const { cheapestPlanWith } = await import("@/lib/plan/entitlements");

    // Rendering a lock here would be an advert for something already bought.
    expect(cheapestPlanWith(overview!.allPlans, "customDomain", "pro")).toBeNull();
    expect(usageOf(overview!, "enquiries").cap).toBeNull();
  });
});

describe("criterion 11 — profile strength has no seller-writable path", () => {
  it("is whatever the job computes, and nothing else", async () => {
    /*
     * Run the job first. The column is batch-derived, so it goes stale between
     * runs exactly as `responseTimeMedianMs` does — asserting the seeded value
     * still matches would be asserting that nothing has happened since the
     * seed, which the e2e seats alone make false by adding a team member.
     *
     * The invariant worth holding is narrower and stronger: after the job runs,
     * the column equals what the pure function returns for that business. No
     * form, no action and no API path can put anything else there.
     */
    const { measureProfileStrength } = await import("@/lib/metrics/strength-job");
    await measureProfileStrength();

    const { profileStrength } = await import("@/lib/metrics/profile-strength");

    const business = await prisma.business.findUniqueOrThrow({
      where: { slug: FREE_AT_CAP_SLUG },
      select: {
        id: true,
        profileStrength: true,
        description: true,
        establishedYear: true,
        teamSize: true,
        languages: true,
        categories: { select: { categoryId: true } },
        locations: { select: { hours: true } },
        _count: { select: { team: true, products: true } },
      },
    });

    const products = await prisma.product.findMany({
      where: { businessId: business.id },
      select: { specValues: true },
    });
    const photos = await prisma.media.count({
      where: { OR: [{ businessId: business.id }, { product: { businessId: business.id } }], reviewId: null },
    });

    const expected = profileStrength({
      hasDescription: (business.description ?? "").trim().length > 0,
      hasLogo: false,
      hasCover: false,
      additionalCategories: business.categories.length,
      hasEstablishedYear: business.establishedYear !== null,
      hasTeamSize: business.teamSize !== null,
      languages: business.languages.length,
      locations: business.locations.length,
      locationsWithHours: business.locations.filter(
        (l) => typeof l.hours === "object" && l.hours !== null && Object.keys(l.hours).length > 0,
      ).length,
      products: business._count.products,
      productsWithFilterableSpecs: products.filter(
        (p) => Object.keys((p.specValues as Record<string, unknown>) ?? {}).length > 0,
      ).length,
      photos,
      teamSeats: business._count.team,
    });

    // Was `int(38, 98)` in the seed until handoff 3 step 1 — the same shape of
    // invention criterion 5 forbids for response time, one column along.
    const after = await prisma.business.findUniqueOrThrow({
      where: { id: business.id },
      select: { profileStrength: true },
    });
    expect(after.profileStrength).toBe(expected);
  });
});
