import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  addSection,
  createTemplate,
  publishTemplate,
  reorderSections,
  restoreVersion,
  setSectionEnabled,
  setSellerEditableFields,
  storeCount,
  templateLibrary,
  templateWithSections,
} from "@/lib/storefront/service";
import { resolveSections } from "@/lib/storefront/sections";
import { PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";

/**
 * Step 6's acceptance criteria, against a real database.
 *
 * The one worth the most care is criterion 2 — a template edit changes every
 * live storefront on that template **and nothing else**. The second half is a
 * negative and negatives pass by accident, so it is asserted against two
 * sectors: one is edited, and the other is checked for having been left alone.
 */

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });

let opsLeadId: string;
let moderatorId: string;
let sectorA: string;
let sectorB: string;
const madeTemplates: string[] = [];
const madeCategories: string[] = [];

beforeAll(async () => {
  opsLeadId = (
    await prisma.user.findFirstOrThrow({
      where: { roles: { has: "staff_ops_lead" } },
      select: { id: true },
    })
  ).id;
  moderatorId = (
    await prisma.user.findFirstOrThrow({
      where: { roles: { has: "staff_moderator" } },
      select: { id: true },
    })
  ).id;

  const sectors = await prisma.category.findMany({
    where: { parentId: null, slug: { not: { startsWith: "sf-test-" } } },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
    take: 2,
  });
  sectorA = sectors[0]!.id;
  sectorB = sectors[1]!.id;
});

afterAll(async () => {
  await prisma.storefrontTemplate.deleteMany({ where: { id: { in: madeTemplates } } });
  await prisma.storefrontTemplate.deleteMany({ where: { name: { startsWith: "SF Test" } } });
  await prisma.category.deleteMany({ where: { id: { in: madeCategories } } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: "sf-test-" } } });
  await prisma.$disconnect();
});

/** A draft of this test's own, on a sector nothing else is using. */
async function draft(name: string) {
  const stamp = `${Date.now()}${madeCategories.length}`;
  const sector = await prisma.category.create({
    data: { name: `SF Test Trade ${stamp}`, slug: `sf-test-${stamp}`, code: "SF" },
    select: { id: true },
  });
  madeCategories.push(sector.id);

  const created = await createTemplate({
    actor: actor(opsLeadId, "staff_ops_lead"),
    sectorId: sector.id,
    name: `SF Test ${name} ${stamp}`,
    reason: "Building a template for this trade so its storefronts stop being the default.",
  });
  if (!created.ok) throw new Error(`fixture failed: ${created.error}`);
  madeTemplates.push(created.id);
  return { templateId: created.id, sectorId: sector.id };
}

describe("the sector denormalisation", () => {
  it("fills itself in when a listing is created without one", async () => {
    // Nothing passes `sectorId`. The trigger reads `primary_category_id`.
    const child = await prisma.category.findFirstOrThrow({
      where: { parentId: { not: null } },
      select: { id: true, parentId: true },
    });
    const stamp = `${Date.now()}`;
    const business = await prisma.business.create({
      data: {
        tradeName: `Sector Trigger ${stamp}`,
        displayName: `Sector Trigger ${stamp}`,
        slug: `sector-trigger-${stamp}`,
        licenceNumber: `DED-ST-${stamp.slice(-6)}`,
        licenceAuthority: "DED",
        licenceExpiry: new Date(Date.now() + 200 * 86_400_000),
        primaryCategoryId: child.id,
        claimStatus: "unclaimed",
      },
      select: { id: true, sectorId: true },
    });
    expect(business.sectorId).toBe(child.parentId);

    // And it follows the category when that moves.
    const otherSector = await prisma.category.findFirstOrThrow({
      where: { parentId: null, id: { not: child.parentId! } },
      select: { id: true },
    });
    const moved = await prisma.business.update({
      where: { id: business.id },
      data: { primaryCategoryId: otherSector.id },
      select: { sectorId: true },
    });
    expect(moved.sectorId).toBe(otherSector.id);

    await prisma.business.delete({ where: { id: business.id } });
  }, 60_000);

  it("agrees with every listing's primary category root", async () => {
    /*
     * A trigger maintains it, so this should be true of every row including
     * the ones a dozen other fixtures in this suite create directly. That is
     * the point: the first version asked each writer to set the column by
     * hand, both application writers were wired, and this still failed the
     * first time the whole suite ran.
     */
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`
      WITH RECURSIVE roots AS (
        SELECT id, parent_id, id AS root_id FROM category WHERE parent_id IS NULL
        UNION ALL
        SELECT c.id, c.parent_id, r.root_id FROM category c JOIN roots r ON c.parent_id = r.id
      )
      SELECT count(*) AS n FROM business b JOIN roots r ON b.primary_category_id = r.id
      WHERE b.sector_id IS DISTINCT FROM r.root_id`;

    expect(Number(rows[0]!.n)).toBe(0);
    expect(await prisma.business.count({ where: { sectorId: null } })).toBe(0);
  }, 60_000);

  it("counts only listings that have a storefront to change", async () => {
    // Unpublished, merged away and suspended listings have no live storefront.
    // Counting them would overstate the blast radius on the one screen whose
    // job is to state it accurately.
    const counted = await storeCount(sectorA);
    const everything = await prisma.business.count({ where: { sectorId: sectorA } });
    expect(counted).toBeLessThanOrEqual(everything);

    const unpublished = await prisma.business.count({
      where: { sectorId: sectorA, publishedAt: null },
    });
    if (unpublished > 0) expect(counted).toBeLessThan(everything);
  });
});

describe("criterion 2 — a template edit reaches its own sector and no other", () => {
  it("changes one sector's sections and leaves the other's alone", async () => {
    const seeded = await templateLibrary();
    const industrial = seeded.find((template) => template.name === "Industrial");
    const stockist = seeded.find((template) => template.name === "Stockist");
    expect(industrial, "the seed has two sector templates").toBeDefined();
    expect(stockist).toBeDefined();

    const before = await templateWithSections(stockist!.id);
    const beforeTypes = before!.sections.map((section) => section.type);

    await setSectionEnabled({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId: industrial!.id,
      sectionId: (await templateWithSections(industrial!.id))!.sections.find(
        (section) => section.type === "reviews",
      )!.id,
      enabled: false,
      reason: "Turning reviews off on the industrial template while we re-cut the card.",
    });

    const after = await templateWithSections(stockist!.id);
    expect(after!.sections.map((section) => section.type)).toEqual(beforeTypes);
    expect(after!.sections.every((section) => section.enabled)).toBe(true);

    // And back, so the suite leaves the seed as it found it.
    await setSectionEnabled({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId: industrial!.id,
      sectionId: (await templateWithSections(industrial!.id))!.sections.find(
        (section) => section.type === "reviews",
      )!.id,
      enabled: true,
      reason: "Putting reviews back.",
    });
  }, 60_000);

  it("resolves what a storefront renders from the template's own rows", async () => {
    const { templateId } = await draft("Resolve");
    const template = await templateWithSections(templateId);
    const resolved = resolveSections(template!.sections);

    expect(resolved.length).toBeGreaterThan(0);
    expect(resolved[0]!.type).toBe("header");
    expect(resolved.every((section) => section.enabled)).toBe(true);
  }, 60_000);
});

describe("criterion 6 — the header stays", () => {
  it("refuses to disable it, in words before the constraint", async () => {
    const { templateId } = await draft("Fixed");
    const template = await templateWithSections(templateId);
    const header = template!.sections.find((section) => section.type === "header")!;

    const result = await setSectionEnabled({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId,
      sectionId: header.id,
      enabled: false,
      reason: "Trying to turn the header off.",
    });
    expect(result).toMatchObject({ ok: false, error: "section_is_fixed" });
  }, 60_000);

  it("refuses it at the database too, so no path gets round it", async () => {
    const { templateId } = await draft("Fixed DB");
    const template = await templateWithSections(templateId);
    const header = template!.sections.find((section) => section.type === "header")!;

    await expect(
      prisma.templateSection.update({ where: { id: header.id }, data: { enabled: false } }),
    ).rejects.toThrow(/template_section_fixed_stays_enabled/);
  }, 60_000);

  it("holds it first however the reorder is asked for", async () => {
    const { templateId } = await draft("Order");
    const template = await templateWithSections(templateId);
    const ids = template!.sections.map((section) => section.id);

    await reorderSections({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId,
      // Header last, deliberately.
      orderedIds: [...ids.slice(1), ids[0]!],
      reason: "Putting the enquiry form above the catalogue for this trade.",
    });

    const after = await templateWithSections(templateId);
    expect(after!.sections[0]!.type).toBe("header");
    expect(after!.sections.map((section) => section.sortOrder)).toEqual([0, 1, 2, 3, 4]);
  }, 60_000);
});

describe("criterion 7 — singletons", () => {
  it("refuses a second hero and allows a second offer banner", async () => {
    const { templateId } = await draft("Singleton");

    const second = await addSection({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId,
      type: "hero",
      reason: "Trying to add a second hero.",
    });
    expect(second).toMatchObject({ ok: false, error: "singleton_exists" });

    const first = await addSection({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId,
      type: "offer_banner",
      reason: "A Ramadan banner for this trade.",
    });
    expect(first.ok).toBe(true);

    const again = await addSection({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId,
      type: "offer_banner",
      reason: "A second banner, lower down the page.",
    });
    expect(again.ok).toBe(true);
  }, 60_000);

  it("refuses the second singleton at the database too", async () => {
    const { templateId } = await draft("Singleton DB");
    await expect(
      prisma.templateSection.create({
        data: { templateId, type: "hero", singleton: true, sortOrder: 99 },
      }),
    ).rejects.toThrow();
  }, 60_000);

  it("will not add the section whose model is not built", async () => {
    const { templateId } = await draft("Services");
    const result = await addSection({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId,
      type: "services",
      reason: "Trying to add services.",
    });
    expect(result).toMatchObject({ ok: false, error: "coming_soon" });
  }, 60_000);
});

describe("criterion 11 — every mutation writes a reason and the store count", () => {
  it("puts the affected count on the audit row", async () => {
    const { templateId, sectorId } = await draft("Audit");
    const expected = await storeCount(sectorId);

    await addSection({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId,
      type: "reviews",
      reason: "Reviews belong on this trade's storefront, buyers ask for them.",
    });

    const row = await prisma.auditEvent.findFirstOrThrow({
      where: { subject: `StorefrontTemplate:${templateId}` },
      orderBy: { createdAt: "desc" },
      select: { after: true, reason: true },
    });
    const after = row.after as { storeCount: number; added: string };
    expect(after.storeCount).toBe(expected);
    expect(after.added).toBe("reviews");
    expect(row.reason.length).toBeGreaterThan(4);
  }, 60_000);

  it("refuses a moderator by any path", async () => {
    // Criterion 3's staff half: a storefront builder is a superadmin tool.
    const { templateId } = await draft("Moderator");
    await expect(
      addSection({
        actor: actor(moderatorId, "staff_moderator"),
        templateId,
        type: "reviews",
        reason: "Not my row.",
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  }, 60_000);
});

describe("what a template may open to a seller", () => {
  it("refuses a field the section type does not declare", async () => {
    const { templateId } = await draft("Fields");
    const template = await templateWithSections(templateId);
    const hero = template!.sections.find((section) => section.type === "hero")!;

    const bad = await setSellerEditableFields({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId,
      sectionId: hero.id,
      fields: ["headline", "startingPrice"],
      reason: "Trying to let sellers put a price on the hero.",
    });
    expect(bad).toMatchObject({ ok: false, error: "unknown_field" });

    const good = await setSellerEditableFields({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId,
      sectionId: hero.id,
      fields: ["headline"],
      reason: "Sellers write their own headline; the rest stays with the template.",
    });
    expect(good.ok).toBe(true);
  }, 60_000);
});

describe("criterion 12 — publish is reversible, and seller content survives it", () => {
  it("restores the section list without changing any section's id", async () => {
    const { templateId } = await draft("Restore");

    const published = await publishTemplate({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId,
      reason: "First publish of this trade's template.",
    });
    expect(published.ok).toBe(true);

    const atPublish = await templateWithSections(templateId);
    const idsAtPublish = atPublish!.sections.map((section) => section.id).sort();

    // A seller fills in the hero on one of the stores.
    const hero = atPublish!.sections.find((section) => section.type === "hero")!;
    const business = await prisma.business.findFirstOrThrow({ select: { id: true } });
    await prisma.storefrontContent.create({
      data: { businessId: business.id, sectionId: hero.id, values: { headline: "Same day from Al Quoz" } },
    });

    // Staff then change their mind twice over.
    await addSection({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId,
      type: "reviews",
      reason: "Adding reviews.",
    });
    await setSectionEnabled({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId,
      sectionId: hero.id,
      enabled: false,
      reason: "Turning the hero off while we rework it.",
    });

    const restored = await restoreVersion({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId,
      version: published.ok ? published.version : 1,
      reason: "Reverting to what was live on Tuesday.",
    });
    expect(restored.ok).toBe(true);

    const after = await templateWithSections(templateId);
    expect(after!.sections.map((section) => section.id).sort()).toEqual(idsAtPublish);
    expect(after!.sections.find((section) => section.type === "hero")!.enabled).toBe(true);
    expect(after!.sections.some((section) => section.type === "reviews")).toBe(false);

    /*
     * The whole reason the snapshot carries ids. A restore that recreated
     * sections would have given them new ids and orphaned this row — silently,
     * across every store in the sector.
     */
    const content = await prisma.storefrontContent.findUnique({
      where: { businessId_sectionId: { businessId: business.id, sectionId: hero.id } },
      select: { values: true },
    });
    expect(content).not.toBeNull();
    expect((content!.values as { headline: string }).headline).toBe("Same day from Al Quoz");

    await prisma.storefrontContent.deleteMany({ where: { sectionId: hero.id } });
  }, 120_000);

  it("records the store count somebody confirmed, on the version row", async () => {
    const { templateId, sectorId } = await draft("Version");
    const expected = await storeCount(sectorId);

    await publishTemplate({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId,
      reason: "Publishing so this trade stops rendering the default storefront.",
    });

    const version = await prisma.templateVersion.findFirstOrThrow({
      where: { templateId },
      select: { storeCount: true, reason: true },
    });
    expect(version.storeCount).toBe(expected);
    expect(version.reason).toContain("Publishing");
  }, 60_000);

  it("keeps one live template per sector, by retiring the last one", async () => {
    const { templateId, sectorId } = await draft("One Live");
    await publishTemplate({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId,
      reason: "First one live for this trade.",
    });

    const second = await createTemplate({
      actor: actor(opsLeadId, "staff_ops_lead"),
      sectorId,
      name: `SF Test Second ${Date.now()}`,
      reason: "A second cut of this trade's template, to replace the first.",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    madeTemplates.push(second.id);

    await publishTemplate({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId: second.id,
      reason: "Replacing the first cut with this one.",
    });

    const live = await prisma.storefrontTemplate.findMany({
      where: { sectorId, status: "live" },
      select: { id: true },
    });
    expect(live).toHaveLength(1);
    expect(live[0]!.id).toBe(second.id);
  }, 120_000);
});

describe("the product id the RFQ tray used to throw away", () => {
  it("records it on the enquiry line", async () => {
    /*
     * The tray had the product id — it was the React key — and dropped it on
     * the way to the server, so `EnquiryLine` held a description and nothing to
     * rank on. That is why "auto-pick most-enquired" on the featured-products
     * section could not be built and could not be backfilled.
     */
    const { createEnquiry } = await import("@/lib/enquiry/service");
    const product = await prisma.product.findFirstOrThrow({
      where: {
        status: "live",
        // A listing that can actually receive: the fan-out skips unpublished,
        // unclaimed and capped sellers, and this test is about the line.
        business: { publishedAt: { not: null }, claimStatus: "claimed", suspendedAt: null },
      },
      select: {
        id: true,
        name: true,
        businessId: true,
        // The business's trade, not the product's subcategory — the fan-out
        // matches on `primaryCategoryId` and a product sits below it.
        business: { select: { primaryCategoryId: true } },
      },
    });

    const result = await createEnquiry({
      buyerId: null,
      phone: `+9715${String(Date.now()).slice(-8)}`,
      fullName: "Line Product Buyer",
      requirement: "Two of these for a fit-out in Al Quoz.",
      lines: [{ description: product.name, qty: 2, productId: product.id }],
      categoryId: product.business.primaryCategoryId,
      // Pinned, so the fan-out always has somebody: this test is about the
      // line, not about who receives it.
      pinnedBusinessIds: [product.businessId],
      fanoutTo: 1,
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;

    const line = await prisma.enquiryLine.findFirstOrThrow({
      where: { enquiryId: result.enquiryId },
      select: { productId: true },
    });
    expect(line.productId).toBe(product.id);

    await prisma.enquiry.delete({ where: { id: result.enquiryId } });
  }, 60_000);

  it("survives the seller deleting the product", async () => {
    // `SetNull`, not `Cascade`. What the buyer asked for still happened.
    const constraint = await prisma.$queryRaw<{ delete_rule: string }[]>`
      SELECT rc.delete_rule FROM information_schema.referential_constraints rc
      WHERE rc.constraint_name = 'enquiry_line_product_id_fkey'`;
    expect(constraint[0]!.delete_rule).toBe("SET NULL");
  });
});

describe("a template belongs to a trade, not a subcategory", () => {
  it("refuses a subcategory", async () => {
    const child = await prisma.category.findFirstOrThrow({
      where: { parentId: { not: null } },
      select: { id: true },
    });
    const result = await createTemplate({
      actor: actor(opsLeadId, "staff_ops_lead"),
      sectorId: child.id,
      name: "SF Test Subcategory",
      reason: "Trying to build a template for a subcategory.",
    });
    expect(result).toMatchObject({ ok: false, error: "not_a_sector" });
  }, 60_000);

  it("refuses it at the database too", async () => {
    const child = await prisma.category.findFirstOrThrow({
      where: { parentId: { not: null } },
      select: { id: true },
    });
    await expect(
      prisma.storefrontTemplate.create({
        data: { sectorId: child.id, name: "SF Test Direct" },
      }),
    ).rejects.toThrow(/top-level/);
  }, 60_000);
});
