import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import type { Actor } from "@/lib/auth/roles";
import {
  chooseSheet,
  deleteRow,
  productBoardFor,
  saveRow,
  sheetChoicesFor,
} from "@/lib/products/service";
import { PRODUCT_TARGET } from "@/lib/products/rows";
import { WEIGHTS } from "@/lib/metrics/profile-strength";

/**
 * Board 8c's service, against a real database.
 *
 * This is the first code in the product that can create a `Product` at all —
 * until now the only writer in the application layer was the CSV importer's
 * `createMany`. So the things asserted here are things nothing has ever done:
 * a hand-typed product that is searchable, that publishes on its own trio, and
 * that leaves its address working when it goes.
 */

const PREFIX = "products-8c-test-";
const OWNER_NAME = "Products 8c Fixture Owner";

let businessId: string;
let actor: Actor;
let templateId: string;
let sizeFieldId: string;
let requiredIds: string[];

async function removeFixtures() {
  await prisma.business.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { fullName: OWNER_NAME } });
}

beforeAll(async () => {
  await removeFixtures();

  const template = await prisma.specTemplate.findFirstOrThrow({
    where: { status: "live", fields: { some: { required: true, isFilterable: true } } },
    select: {
      id: true,
      categories: { select: { categoryId: true } },
      fields: {
        orderBy: { sortOrder: "asc" },
        select: { id: true, unit: true, required: true, isFilterable: true },
      },
    },
  });
  templateId = template.id;
  const templateCategoryId = template.categories[0]!.categoryId;
  requiredIds = template.fields
    .filter((field) => field.required && field.isFilterable)
    .map((field) => field.id);
  sizeFieldId =
    template.fields.find((field) => field.unit !== null)?.id ?? (requiredIds[0] as string);

  const stamp = Date.now().toString(36);
  const business = await prisma.business.create({
    data: {
      tradeName: `Products 8c ${stamp}`,
      displayName: `Products 8c ${stamp}`,
      slug: `${PREFIX}${stamp}`,
      licenceNumber: `DED-8C-${stamp.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
      primaryCategoryId: templateCategoryId,
      claimStatus: "claimed",
      planId: "free",
      publishedAt: new Date(Date.now() - 2 * 86_400_000),
    },
    select: { id: true },
  });
  businessId = business.id;

  const owner = await prisma.user.create({
    data: { id: crypto.randomUUID(), fullName: OWNER_NAME, roles: ["seller_owner"], businessId },
    select: { id: true },
  });
  actor = { id: owner.id, roles: ["seller_owner"], businessId };
});

beforeEach(async () => {
  await prisma.product.deleteMany({ where: { businessId } });
  await prisma.sellerTemplate.deleteMany({ where: { businessId } });
  await chooseSheet(actor, businessId, templateId);
});

afterAll(async () => {
  await removeFixtures();
  await prisma.$disconnect();
});

describe("a product a seller typed", () => {
  it("is created at all, which nothing in this product could do before", async () => {
    const result = await saveRow(actor, businessId, {
      name: "Resilient seated gate valve",
      size: "DN100",
      availability: "in_stock",
    });
    expect(result.ok).toBe(true);

    const board = await productBoardFor(businessId);
    expect(board.rows).toHaveLength(1);
    expect(board.rows[0]?.name).toBe("Resilient seated gate valve");
  });

  it("is findable, because the search text is built the way the importer builds it", async () => {
    /*
       The whole argument for ten products is that each is a searchable page. A
       row created without `searchText` would be live, look right on this screen
       and never appear in a result — the quietest possible way to make the task
       pointless.
    */
    await saveRow(actor, businessId, {
      name: "Ductile iron check valve",
      size: "DN80",
      availability: "in_stock",
    });

    const product = await prisma.product.findFirstOrThrow({
      where: { businessId },
      select: { searchText: true, slug: true, status: true },
    });
    expect(product.searchText).toContain("ductile iron check valve");
    expect(product.searchText).toContain("dn80");
    expect(product.slug).toBe("ductile-iron-check-valve");
  });

  it("puts the size on the sheet's own field, where every reader looks", async () => {
    await saveRow(actor, businessId, {
      name: "Wafer butterfly valve",
      size: "DN300",
      availability: "in_stock",
    });

    const product = await prisma.product.findFirstOrThrow({
      where: { businessId },
      select: { specValues: true },
    });
    expect((product.specValues as Record<string, unknown>)[sizeFieldId]).toBe("DN300");
  });

  it("takes a second slug rather than colliding on the first", async () => {
    await saveRow(actor, businessId, { name: "Gate valve", size: "DN50", availability: "in_stock" });
    await saveRow(actor, businessId, { name: "Gate valve", size: "DN80", availability: "in_stock" });

    const slugs = await prisma.product.findMany({ where: { businessId }, select: { slug: true } });
    expect(new Set(slugs.map((row) => row.slug)).size).toBe(2);
  });
});

describe("live is a consequence of the trio, not a button", () => {
  it("keeps a row private until all three are there", async () => {
    // §4: saved, private, and excluded from every count. It shows in this table
    // and nowhere else.
    await saveRow(actor, businessId, { name: "Half a product", size: "", availability: null });

    const board = await productBoardFor(businessId);
    expect(board.rows).toHaveLength(1);
    expect(board.rows[0]?.live).toBe(false);
    expect(board.live).toBe(0);
    expect(board.qualifying).toBe(0);

    const stored = await prisma.product.findFirstOrThrow({
      where: { businessId },
      select: { status: true },
    });
    expect(stored.status).toBe("draft");
  });

  it("publishes the moment the last of the three arrives", async () => {
    const created = await saveRow(actor, businessId, {
      name: "Becomes live",
      size: "",
      availability: null,
    });
    expect(created.ok && created.id).toBeTruthy();

    await saveRow(actor, businessId, {
      ...(created.ok && created.id ? { id: created.id } : {}),
      name: "Becomes live",
      size: "DN25",
      availability: "in_stock",
    });

    expect((await productBoardFor(businessId)).live).toBe(1);
  });
});

describe("two numbers from one table", () => {
  it("counts a thin row as live and not as qualifying", async () => {
    /*
       §3, the case to get right. The product is published and findable; it
       simply fails the task's quality bar. It must not be hidden, must not be
       unpublished, and must not be counted.
    */
    const result = await saveRow(actor, businessId, {
      name: "Thin on specs",
      size: "DN15",
      availability: "in_stock",
    });
    expect(result.ok).toBe(true);

    const board = await productBoardFor(businessId);
    // The size fills one required field; three required means 33%, under the bar.
    if (requiredIds.length >= 3) {
      expect(board.live).toBe(1);
      expect(board.qualifying).toBe(0);
      expect(board.rows[0]?.specs.qualifies).toBe(false);
    }
  });

  it("scores on qualifying rows, not on live ones", async () => {
    // §9's fourth open question, answered the way it recommends and the way the
    // footer counts. A chip counting rows the footer excludes would be the
    // screen arguing with itself a centimetre apart.
    const full = Object.fromEntries(requiredIds.map((id) => [id, "x"]));
    for (let index = 0; index < 2; index += 1) {
      const created = await saveRow(actor, businessId, {
        name: `Complete valve ${index}`,
        size: "DN100",
        availability: "in_stock",
      });
      if (created.ok && created.id) {
        await prisma.product.update({
          where: { id: created.id },
          data: { specValues: { ...full, [sizeFieldId]: "DN100" } },
        });
      }
    }

    const board = await productBoardFor(businessId);
    expect(board.qualifying).toBe(2);
    expect(board.pointsSoFar).toBe(Math.floor((2 / PRODUCT_TARGET) * WEIGHTS.catalogue));
  });
});

describe("removing a row", () => {
  it("leaves the address working rather than turning a result into a 404", async () => {
    // §4: a live product's page has been indexed and may be linked.
    const created = await saveRow(actor, businessId, {
      name: "Will be removed",
      size: "DN40",
      availability: "in_stock",
    });
    const id = created.ok && created.id ? created.id : "";

    const before = await prisma.product.findFirstOrThrow({
      where: { id },
      select: { slug: true, business: { select: { slug: true } } },
    });

    await deleteRow(actor, businessId, id);

    const redirect = await prisma.redirect.findUnique({
      where: { fromPath: `/b/${before.business.slug}/p/${before.slug}` },
      select: { toPath: true },
    });
    expect(redirect?.toPath).toBe(`/b/${before.business.slug}/products`);
  });

  it("writes no redirect for a row that was never live", async () => {
    // Nothing was ever indexed, so there is no address to keep.
    const created = await saveRow(actor, businessId, {
      name: "Never published",
      size: "",
      availability: null,
    });
    const id = created.ok && created.id ? created.id : "";
    const before = await prisma.product.findFirstOrThrow({
      where: { id },
      select: { slug: true, business: { select: { slug: true } } },
    });

    await deleteRow(actor, businessId, id);

    expect(
      await prisma.redirect.findUnique({
        where: { fromPath: `/b/${before.business.slug}/p/${before.slug}` },
      }),
    ).toBeNull();
  });
});

describe("the sheet", () => {
  it("matches a supplier filed under a subcategory of the sheet's category", async () => {
    /*
       Templates belong to the trade, not the niche. Comparing category ids
       alone meant MATCHES YOUR CATEGORY never fired for anybody under a
       subcategory, which is most suppliers — the most useful signal on step 1,
       silently off. `resolveDefaultTemplateId` walks the same hop.
    */
    const template = await prisma.specTemplate.findUniqueOrThrow({
      where: { id: templateId },
      select: { categories: { select: { categoryId: true } } },
    });
    const parentId = template.categories[0]!.categoryId;
    const child = await prisma.category.findFirst({
      where: { parentId },
      select: { id: true },
    });
    if (!child) return;

    await prisma.business.update({
      where: { id: businessId },
      data: { primaryCategoryId: child.id },
    });

    const sheets = await sheetChoicesFor(businessId);
    expect(sheets.find((sheet) => sheet.id === templateId)?.matches).toBe(true);
    // Matching sorts ahead of a more widely adopted sheet.
    expect(sheets[0]?.id).toBe(templateId);

    await prisma.business.update({
      where: { id: businessId },
      data: { primaryCategoryId: parentId },
    });
  });

  it("replaces the choice rather than collecting a second one", async () => {
    // One sheet per catalogue in this phase, which is why every row's spec
    // count shares a denominator.
    await chooseSheet(actor, businessId, templateId);
    expect(await prisma.sellerTemplate.count({ where: { businessId } })).toBe(1);
  });
});

describe("somebody else's catalogue", () => {
  it("is refused, even holding a seller role of their own", async () => {
    const stranger: Actor = { id: actor.id, roles: ["seller_owner"], businessId: "someone-else" };

    expect(
      await saveRow(stranger, businessId, { name: "Not yours", size: "DN10", availability: "in_stock" }),
    ).toEqual({ ok: false, error: expect.any(String) });
    expect(await chooseSheet(stranger, businessId, templateId)).toEqual({
      ok: false,
      error: expect.any(String),
    });
    expect((await productBoardFor(businessId)).rows).toHaveLength(0);
  });
});
