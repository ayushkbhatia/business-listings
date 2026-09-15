import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";

/**
 * The storefront's data, against a real database.
 *
 * What is left of step 6 once the sector template model was cut (boards `5a`,
 * `5b`, `5c`, 15 Sep 2026): the sector column a trigger keeps, the overview's
 * one loader, and the product id the RFQ tray used to throw away.
 */

afterAll(async () => {
  await prisma.$disconnect();
});

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
});

describe("the overview's loader", () => {
  it("reads only what a buyer may see, in a stable order", async () => {
    const { storefrontData } = await import("@/lib/storefront/loader");

    const listing = await prisma.business.findFirstOrThrow({
      where: {
        publishedAt: { not: null },
        suspendedAt: null,
        sellsKind: { not: "services" },
        products: { some: { status: "live" } },
      },
      orderBy: { id: "asc" },
      select: { id: true, slug: true, sellsKind: true },
    });

    const data = await storefrontData(listing);
    const again = await storefrontData(listing);

    // Live products only, twelve at most, and the same twelve on every load.
    expect(data.products.length).toBeGreaterThan(0);
    expect(data.products.length).toBeLessThanOrEqual(12);
    const live = await prisma.product.count({
      where: { id: { in: data.products.map((product) => product.id) }, status: "live" },
    });
    expect(live).toBe(data.products.length);
    expect(again.products.map((product) => product.id)).toEqual(data.products.map((product) => product.id));

    // Published branches only, and never a number — the mask, or nothing.
    const published = await prisma.location.count({ where: { businessId: listing.id, published: true } });
    expect(data.locations).toHaveLength(published);
    for (const location of data.locations) {
      if (location.maskedPhone) expect(location.maskedPhone).toMatch(/•/);
    }
  }, 60_000);
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
