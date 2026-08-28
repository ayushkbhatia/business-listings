import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { getSpecFieldOptions, resolveDefaultTemplateId } from "@/lib/db/queries/catalogue";
import { landingFacts } from "@/lib/seo/facts";
import { landingFaq } from "@/lib/seo/faq";
import { categoryIndex, isCategoryPublishable } from "@/lib/seo/taxonomy";
import { VERIFIED_TIER } from "@/lib/verification";

/**
 * Handoff 5, step 2 — boards 6c and 10a.
 *
 * The checkpoint the KICKOFF names: "add a subcategory in the database and show
 * the page appearing." That is criterion 2, and it is a negative — "needs no
 * code change" — so it is asserted by building a subcategory nothing in the
 * repo has ever heard of and showing that every derived part of its page
 * resolves anyway.
 */

const PREFIX = "landing-test-";
let sectorId: string;
let areaDubai: string;
let areaSharjah: string;
/** Everything this file made, in the order it has to go away. */
const madeCategories: string[] = [];
const madeBusinesses: string[] = [];
let seq = 0;

function stamp() {
  seq += 1;
  return `${Date.now().toString(36)}${seq}`;
}

async function removeFixtures() {
  await prisma.business.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  madeBusinesses.length = 0;
  madeCategories.length = 0;
}

/** A subcategory nothing in the codebase names. */
async function makeSubcategory(name: string) {
  const category = await prisma.category.create({
    data: {
      parentId: sectorId,
      name,
      slug: `${PREFIX}${name.toLowerCase().replace(/\s+/g, "-")}-${stamp()}`,
      code: "LT",
      sortOrder: 99,
    },
    select: { id: true, slug: true, name: true },
  });
  madeCategories.push(category.id);
  return category;
}

interface ListingSpec {
  categoryId: string;
  tier: number;
  areaId: string;
  emirate: "dubai" | "sharjah";
  replyMs?: number | null;
  products?: { availability: "in_stock" | "made_to_order" }[];
}

async function makeListing(spec: ListingSpec) {
  const id = stamp();
  const business = await prisma.business.create({
    data: {
      tradeName: `Landing Test ${id}`,
      displayName: `Landing Test ${id}`,
      slug: `${PREFIX}${id}`,
      licenceNumber: `DED-LT${id.slice(-5)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
      primaryCategoryId: spec.categoryId,
      claimStatus: "claimed",
      publishedAt: new Date(),
      verificationTier: spec.tier,
      verifiedAt: spec.tier > 0 ? new Date() : null,
      responseTimeMedianMs: spec.replyMs ?? null,
      locations: {
        create: {
          type: "head_office",
          emirate: spec.emirate,
          areaId: spec.areaId,
          addressLine: "Unit 5, Street 9",
          published: true,
        },
      },
      ...(spec.products?.length
        ? {
            products: {
              create: spec.products.map((product, i) => ({
                categoryId: spec.categoryId,
                name: `Part ${id}-${i}`,
                slug: `${PREFIX}part-${id}-${i}`,
                status: "live" as const,
                availability: product.availability,
                searchText: `part ${id}`,
              })),
            },
          }
        : {}),
    },
    select: { id: true },
  });
  madeBusinesses.push(business.id);
  return business.id;
}

beforeAll(async () => {
  sectorId = (
    await prisma.category.findFirstOrThrow({ where: { parentId: null }, select: { id: true } })
  ).id;
  areaDubai = (
    await prisma.area.findFirstOrThrow({ where: { emirate: "dubai" }, select: { id: true } })
  ).id;
  areaSharjah = (
    await prisma.area.findFirstOrThrow({ where: { emirate: "sharjah" }, select: { id: true } })
  ).id;
  // Before as well as after. A crashed run leaves a subcategory behind, and a
  // leftover subcategory is a row in every later `categoryIndex()` assertion.
  await removeFixtures();
});

afterAll(async () => {
  await removeFixtures();
  await prisma.$disconnect();
});

describe("criterion 2 — a new subcategory needs no code change", () => {
  it("appears in the index, and its page's facts resolve", async () => {
    const trade = await makeSubcategory("Gaskets and seals");

    // Tier 2, not 3: `business_tier_3_requires_visit` means a tier-3 listing
    // without a `visitedAt` is refused by the database, which is the constraint
    // doing its job. Tier 2 is what "verified" means on every public surface.
    await makeListing({ categoryId: trade.id, tier: 2, areaId: areaDubai, emirate: "dubai" });
    await makeListing({ categoryId: trade.id, tier: 0, areaId: areaSharjah, emirate: "sharjah" });

    const sectors = await categoryIndex();
    const sector = sectors.find((row) => row.id === sectorId);
    const listed = sector?.children.find((child) => child.id === trade.id);

    expect(listed, "the new subcategory is not in the index").toBeDefined();
    expect(listed?.name).toBe(trade.name);
    expect(listed?.listings).toBe(2);
    expect(listed?.verified).toBe(1);

    const facts = await landingFacts({ categoryIds: [trade.id] });
    expect(facts.listings).toBe(2);
    expect(facts.emirates.map((row) => row.emirate).sort()).toEqual(["dubai", "sharjah"]);

    // And the prose the page shows is assembled from exactly those numbers.
    const faq = landingFaq({ subject: trade.name }, facts);
    expect(faq.find((item) => item.id === "how-many")?.answer).toContain("2");
  }, 60_000);

  it("rolls a subcategory's listings up into its sector", async () => {
    const before = (await categoryIndex()).find((row) => row.id === sectorId)?.listings ?? 0;
    const trade = await makeSubcategory("Rolled up");
    await makeListing({ categoryId: trade.id, tier: 2, areaId: areaDubai, emirate: "dubai" });

    const after = (await categoryIndex()).find((row) => row.id === sectorId)?.listings ?? 0;
    expect(after).toBe(before + 1);
  }, 60_000);
});

describe("landingFacts", () => {
  it("counts a supplier in every emirate it has premises in", async () => {
    /*
       A supplier with a yard in Dubai and a counter in Sharjah is in both, and
       that is what a buyer filtering by emirate will find. The shares therefore
       do not sum to the listing count, which is why the block says so on the
       page rather than leaving somebody to add them up and find it wrong.
    */
    const trade = await makeSubcategory("Two emirates");
    const businessId = await makeListing({
      categoryId: trade.id,
      tier: 2,
      areaId: areaDubai,
      emirate: "dubai",
    });
    await prisma.location.create({
      data: {
        businessId,
        type: "warehouse",
        emirate: "sharjah",
        areaId: areaSharjah,
        addressLine: "Warehouse 2",
        published: true,
      },
    });

    const facts = await landingFacts({ categoryIds: [trade.id] });
    expect(facts.listings).toBe(1);
    expect(facts.emirates).toHaveLength(2);
    expect(facts.emirates.every((row) => row.listings === 1)).toBe(true);
  }, 60_000);

  it("counts as verified only from the tier the badge calls verified", async () => {
    const trade = await makeSubcategory("Tier boundary");
    await makeListing({
      categoryId: trade.id,
      tier: VERIFIED_TIER - 1,
      areaId: areaDubai,
      emirate: "dubai",
    });
    await makeListing({
      categoryId: trade.id,
      tier: VERIFIED_TIER,
      areaId: areaDubai,
      emirate: "dubai",
    });

    const facts = await landingFacts({ categoryIds: [trade.id] });
    expect(facts.listings).toBe(2);
    // "Licence on file" is a number somebody typed. It is not verified.
    expect(facts.verified).toBe(1);
  }, 60_000);

  it("reports no median rather than a made-up one when nothing is measurable", async () => {
    const trade = await makeSubcategory("Unmeasured");
    await makeListing({ categoryId: trade.id, tier: 2, areaId: areaDubai, emirate: "dubai" });

    const facts = await landingFacts({ categoryIds: [trade.id] });
    expect(facts.replyMedianMs).toBeNull();
    expect(facts.replyMeasurable).toBe(0);
    expect(landingFaq({ subject: trade.name }, facts).map((item) => item.id)).not.toContain(
      "reply-time",
    );
  }, 60_000);

  it("takes the median of the per-business medians", async () => {
    const trade = await makeSubcategory("Measured");
    for (const ms of [1, 2, 3, 4, 9].map((h) => h * 3_600_000)) {
      await makeListing({
        categoryId: trade.id,
        tier: 2,
        areaId: areaDubai,
        emirate: "dubai",
        replyMs: ms,
      });
    }

    const facts = await landingFacts({ categoryIds: [trade.id] });
    expect(facts.replyMeasurable).toBe(5);
    expect(facts.replyMedianMs).toBe(3 * 3_600_000);
  }, 60_000);

  it("groups products by availability", async () => {
    const trade = await makeSubcategory("Availability");
    await makeListing({
      categoryId: trade.id,
      tier: 2,
      areaId: areaDubai,
      emirate: "dubai",
      products: [
        { availability: "in_stock" },
        { availability: "in_stock" },
        { availability: "made_to_order" },
      ],
    });

    const facts = await landingFacts({ categoryIds: [trade.id] });
    expect(facts.products).toBe(3);
    expect(facts.availability.find((row) => row.availability === "in_stock")?.products).toBe(2);
    expect(facts.availability.find((row) => row.availability === "made_to_order")?.products).toBe(1);
  }, 60_000);

  it("answers with zeroes rather than throwing for an empty scope", async () => {
    const facts = await landingFacts({ categoryIds: [] });
    expect(facts).toMatchObject({ listings: 0, verified: 0, products: 0, replyMedianMs: null });
  }, 60_000);
});

describe("the publish gate", () => {
  it("holds back a subcategory with two listings and no intro", async () => {
    const trade = await makeSubcategory("Far too thin");
    await makeListing({ categoryId: trade.id, tier: 2, areaId: areaDubai, emirate: "dubai" });

    expect(await isCategoryPublishable(trade.id)).toBe(false);
  }, 60_000);

  it("agrees with the index, which is what criterion 12 asks of the sitemap", async () => {
    /*
       `app/sitemap.ts` and `/admin/content/matrix` disagreed before this step:
       the sitemap hardcoded `introWords: 250`, so the copy gate passed
       vacuously there while the admin screen applied it, and the two counted
       verified from different tiers. One function now, so the sitemap and the
       matrix cannot drift apart again.
    */
    const sectors = await categoryIndex();
    const children = sectors.flatMap((sector) => sector.children).slice(0, 12);
    expect(children.length).toBeGreaterThan(0);

    for (const child of children) {
      expect(await isCategoryPublishable(child.id), child.slug).toBe(child.publishable);
    }
  }, 120_000);
});

describe("a subcategory inherits its trade's specification template", () => {
  /*
     Templates belong to the trade, not the niche: the seed puts one on
     "Valves & fittings" and none on "Gate valves". Before this step, filing a
     supplier under a subcategory silently took the spec fields away from their
     whole catalogue — the CSV mapper had nothing to map onto, the template
     screen said there was no template, the public spec table rendered empty,
     and none of the four said why.
  */
  it("resolves the parent's default template for a child that has none", async () => {
    const parent = await prisma.category.findFirstOrThrow({
      where: { parentId: null, defaultTemplateId: { not: null } },
      select: { id: true, defaultTemplateId: true },
    });

    const child = await prisma.category.create({
      data: {
        parentId: parent.id,
        name: "Inherits",
        slug: `${PREFIX}inherits-${stamp()}`,
        code: "IN",
        sortOrder: 99,
      },
      select: { id: true },
    });
    madeCategories.push(child.id);

    expect(await resolveDefaultTemplateId(child.id)).toBe(parent.defaultTemplateId);

    // And the fields come with it, `isFilterable` intact — which is what the
    // CSV mapper marks "findable" from.
    const fields = await getSpecFieldOptions(child.id);
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.some((field) => field.isFilterable)).toBe(true);
  }, 60_000);

  it("prefers a child's own template over its parent's", async () => {
    const parent = await prisma.category.findFirstOrThrow({
      where: { parentId: null, defaultTemplateId: { not: null } },
      select: { id: true, defaultTemplateId: true },
    });

    const child = await prisma.category.create({
      data: {
        parentId: parent.id,
        name: "Has its own",
        slug: `${PREFIX}own-${stamp()}`,
        code: "OW",
        sortOrder: 99,
      },
      select: { id: true },
    });
    madeCategories.push(child.id);

    const own = await prisma.specTemplate.create({
      data: {
        categoryId: child.id,
        name: "Own template",
        version: 1,
        status: "draft",
      },
      select: { id: true },
    });
    await prisma.category.update({
      where: { id: child.id },
      data: { defaultTemplateId: own.id },
    });

    expect(await resolveDefaultTemplateId(child.id)).toBe(own.id);

    await prisma.category.update({ where: { id: child.id }, data: { defaultTemplateId: null } });
    await prisma.specTemplate.delete({ where: { id: own.id } });
  }, 60_000);

  it("returns nothing for a sector with no template rather than reaching sideways", async () => {
    const orphan = await prisma.category.create({
      data: {
        name: "No template anywhere",
        slug: `${PREFIX}orphan-${stamp()}`,
        code: "NT",
        sortOrder: 99,
      },
      select: { id: true },
    });
    madeCategories.push(orphan.id);

    expect(await resolveDefaultTemplateId(orphan.id)).toBeNull();
    expect(await getSpecFieldOptions(orphan.id)).toEqual([]);
  }, 60_000);
});
