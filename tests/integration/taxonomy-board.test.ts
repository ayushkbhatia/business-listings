import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";
import { readHomeSectors, readHomeStats } from "@/lib/db/queries/home";
import { findFanoutCandidates } from "@/lib/enquiry/service";
import { categoryIndex, listedInIndex } from "@/lib/seo/taxonomy";
import { findNode, loadCategoryEditor, loadTaxonomyTree } from "@/lib/taxonomy/board";
import { mergeCategories, previewMerge } from "@/lib/taxonomy/merge";
import { addressesFor, deleteCategory } from "@/lib/taxonomy/rename";
import { createCategory, saveCategoryDetails, setCategorySwitch } from "@/lib/taxonomy/write";
import { purgeAuditRows } from "./audit-cleanup";

/**
 * Board 4d — the category taxonomy, against a database.
 *
 * `lib/taxonomy/tree-model.test.ts` holds the arithmetic on hand-written rows.
 * This file holds what only Postgres can answer: that the header total is the
 * same population the home page counts (Q1), that every write is audited with
 * its reason and a refused one is not, that the index and fan-out switches
 * change what their readers return, and that a merge moves every row and
 * writes every redirect in one transaction — or none.
 */

const PREFIX = "tax4d-";
const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });
let lead: Actor;
let moderator: Actor;
let areaId: string;
let seq = 0;
const stamp = () => `${Date.now().toString(36)}${(seq += 1)}`;
const reason = (text: string) => `${PREFIX}${text}`;

async function removeFixtures() {
  await purgeAuditRows({ reason: { startsWith: PREFIX } });
  await prisma.redirect.deleteMany({ where: { OR: [{ fromPath: { contains: PREFIX } }, { toPath: { contains: PREFIX } }] } });
  await prisma.product.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.placementSlot.deleteMany({ where: { business: { slug: { startsWith: PREFIX } } } });
  await prisma.business.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.areaPage.deleteMany({ where: { category: { slug: { startsWith: PREFIX } } } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: PREFIX }, parentId: { not: null } } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

async function makeCategory(name: string, parentId: string | null = null, extra: Record<string, unknown> = {}) {
  return prisma.category.create({
    data: { name, slug: `${PREFIX}${stamp()}`, code: "TX", parentId, sortOrder: 900, ...extra },
    select: { id: true, slug: true, name: true },
  });
}

async function makeListing(categoryId: string, over: Record<string, unknown> = {}) {
  const s = stamp();
  return prisma.business.create({
    data: {
      tradeName: `Taxonomy Test ${s}`,
      displayName: `Taxonomy Test ${s}`,
      slug: `${PREFIX}biz-${s}`,
      licenceNumber: `DED-4D${s.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
      primaryCategoryId: categoryId,
      claimStatus: "claimed",
      publishedAt: new Date(),
      ...over,
    },
    select: { id: true, slug: true, sectorId: true },
  });
}

beforeAll(async () => {
  const [leadRow, moderatorRow, area] = await Promise.all([
    prisma.user.findFirstOrThrow({ where: { roles: { has: "staff_ops_lead" } }, orderBy: { id: "asc" }, select: { id: true } }),
    prisma.user.findFirstOrThrow({ where: { roles: { has: "staff_moderator" } }, orderBy: { id: "asc" }, select: { id: true } }),
    prisma.area.findFirstOrThrow({ where: { emirate: "dubai" }, orderBy: { id: "asc" }, select: { id: true } }),
  ]);
  lead = actor(leadRow.id, "staff_ops_lead");
  moderator = actor(moderatorRow.id, "staff_moderator");
  areaId = area.id;
  await removeFixtures();
}, 120_000);

afterAll(async () => {
  await removeFixtures();
  await prisma.$disconnect();
}, 120_000);

describe("B1 and Q1 — one population, one total", () => {
  it("states a header total equal to the home page's listing count, and to the sum of its own rows", async () => {
    const [tree, stats, index] = await Promise.all([loadTaxonomyTree(), readHomeStats(), categoryIndex()]);
    expect(tree.totals.listings).toBe(stats.listings);
    expect(tree.totals.listings).toBe(tree.sectors.reduce((total, sector) => total + sector.listings, 0));
    // 6c counts the same listings sector by sector.
    expect(index.reduce((total, sector) => total + sector.listings, 0)).toBe(tree.totals.listings);
    expect(tree.totals.sectors).toBe(stats.sectors);
    expect(tree.totals.subcategories).toBe(stats.subcategories);
  });

  it("counts a new listing once, in its row, its sector and the header", async () => {
    const sector = await makeCategory("Taxonomy test sector");
    const child = await makeCategory("Taxonomy test child", sector.id);
    const before = await loadTaxonomyTree();
    await makeListing(child.id);
    const after = await loadTaxonomyTree();

    expect(after.totals.listings).toBe(before.totals.listings + 1);
    expect(findNode(after, child.id)?.listings).toBe(1);
    expect(findNode(after, sector.id)?.listings).toBe(1);
  });
});

describe("the editor's save", () => {
  it("writes only the fields that moved, with the reason, and refuses a stale or empty save without an audit row", async () => {
    const sector = await makeCategory("Editor sector");
    const category = await makeCategory("Editor valves", sector.id, { synonyms: ["gate valve"] });
    const basis = { name: category.name, code: "TX", synonyms: ["gate valve"], defaultTemplateId: null };

    const saved = await saveCategoryDetails({
      actor: lead,
      categoryId: category.id,
      basis,
      next: { ...basis, synonyms: ["gate valve", " Butterfly  valve ", "صمامات"] },
      reason: reason("adding routing terms"),
    });
    expect(saved).toMatchObject({ ok: true, changed: ["synonyms"], reindex: true });

    const row = await prisma.category.findUniqueOrThrow({ where: { id: category.id }, select: { synonyms: true } });
    expect(row.synonyms).toEqual(["gate valve", "Butterfly valve", "صمامات"]);

    const events = await prisma.auditEvent.findMany({ where: { subject: `Category:${category.id}` } });
    expect(events).toHaveLength(1);
    expect(events[0]!.reason).toBe(reason("adding routing terms"));
    expect(events[0]!.after).toEqual({ synonyms: ["gate valve", "Butterfly valve", "صمامات"] });
    expect(Object.keys(events[0]!.before as object)).toEqual(["synonyms"]);

    // The same basis again is stale: somebody (this person) saved in between.
    expect(
      await saveCategoryDetails({ actor: lead, categoryId: category.id, basis, next: { ...basis, name: "Other" }, reason: reason("stale") }),
    ).toEqual({ ok: false, error: "stale" });

    const fresh = { ...basis, synonyms: row.synonyms };
    expect(
      await saveCategoryDetails({ actor: lead, categoryId: category.id, basis: fresh, next: fresh, reason: reason("nothing") }),
    ).toEqual({ ok: false, error: "unchanged" });
    expect(
      await saveCategoryDetails({ actor: lead, categoryId: category.id, basis: fresh, next: { ...fresh, code: "I9" }, reason: reason("bad code") }),
    ).toEqual({ ok: false, error: "code_invalid" });

    expect(await prisma.auditEvent.count({ where: { subject: `Category:${category.id}` } })).toBe(1);
  });

  it("refuses a default template that does not serve the category, and a sibling's name", async () => {
    const sector = await makeCategory("Template sector");
    const a = await makeCategory("Template child A", sector.id);
    await makeCategory("Template child B", sector.id);
    const template = await prisma.specTemplate.findFirstOrThrow({ orderBy: { id: "asc" }, select: { id: true } });
    const basis = { name: a.name, code: "TX", synonyms: [], defaultTemplateId: null };

    expect(
      await saveCategoryDetails({ actor: lead, categoryId: a.id, basis, next: { ...basis, defaultTemplateId: template.id }, reason: reason("template") }),
    ).toEqual({ ok: false, error: "template_not_serving" });
    expect(
      await saveCategoryDetails({ actor: lead, categoryId: a.id, basis, next: { ...basis, name: "template child b" }, reason: reason("rename") }),
    ).toEqual({ ok: false, error: "name_taken" });
  });

  it("is an ops lead's, not a moderator's, though both may read it", async () => {
    const category = await makeCategory("Permission sector");
    const basis = { name: category.name, code: "TX", synonyms: [], defaultTemplateId: null };
    await expect(
      saveCategoryDetails({ actor: moderator, categoryId: category.id, basis, next: { ...basis, name: "Nope" }, reason: reason("moderator") }),
    ).rejects.toBeInstanceOf(PermissionError);
    const tree = await loadTaxonomyTree();
    expect(await loadCategoryEditor(tree, category.id)).not.toBeNull();
  });
});

describe("B3 — one switch per public surface", () => {
  it("takes a category out of the index and the home rail, and audits the flip once", async () => {
    const sector = await makeCategory("Index sector", null, { showOnHome: true });
    const child = await makeCategory("Index child", sector.id);
    await makeListing(child.id);

    expect(listedInIndex(await categoryIndex()).some((row) => row.id === sector.id)).toBe(true);
    expect((await readHomeSectors()).some((row) => row.id === sector.id)).toBe(true);

    expect(
      (await setCategorySwitch({ actor: lead, categoryId: sector.id, field: "showInIndex", value: false, reason: reason("hold out") })).ok,
    ).toBe(true);
    // A second flip to the same position is refused, and writes no second row.
    expect(
      await setCategorySwitch({ actor: lead, categoryId: sector.id, field: "showInIndex", value: false, reason: reason("again") }),
    ).toEqual({ ok: false, error: "unchanged" });
    expect(await prisma.auditEvent.count({ where: { subject: `Category:${sector.id}` } })).toBe(1);

    expect(listedInIndex(await categoryIndex()).some((row) => row.id === sector.id)).toBe(false);
    expect((await readHomeSectors()).some((row) => row.id === sector.id)).toBe(false);
    // The sitemap's reader is not the index's switch.
    expect((await categoryIndex()).some((row) => row.id === sector.id)).toBe(true);

    const editor = await loadCategoryEditor(await loadTaxonomyTree(), child.id);
    expect(editor?.index).toBe("sector_hidden");
  });

  it("keeps a sector with no listings out of the index whatever its switch says", async () => {
    const sector = await makeCategory("Empty sector");
    expect(listedInIndex(await categoryIndex()).some((row) => row.id === sector.id)).toBe(false);
    const editor = await loadCategoryEditor(await loadTaxonomyTree(), sector.id);
    expect(editor?.index).toBe("no_listings");
    expect(editor?.onHomeGrid).toBe(false);
  });

  it("stops a category's RFQ fan-out but still reaches a supplier the buyer named", async () => {
    const sector = await makeCategory("Fan-out sector");
    const child = await makeCategory("Fan-out child", sector.id);
    const listing = await makeListing(child.id);
    const request = { categoryId: child.id, categoryIds: [child.id], emirate: null, lineCount: 1, want: 5 };

    expect((await findFanoutCandidates(request)).some((candidate) => candidate.businessId === listing.id)).toBe(true);

    await setCategorySwitch({ actor: lead, categoryId: sector.id, field: "acceptsRfq", value: false, reason: reason("no rfq") });
    expect((await findFanoutCandidates(request)).some((candidate) => candidate.businessId === listing.id)).toBe(false);
    expect(
      (await findFanoutCandidates({ ...request, pinned: [listing.id] })).some((candidate) => candidate.businessId === listing.id),
    ).toBe(true);
  });
});

describe("adding and removing", () => {
  it("adds a sector and a subcategory, audited as a creation, and refuses a third level or a taken address", async () => {
    const slug = `${PREFIX}${stamp()}`;
    const sector = await createCategory({ actor: lead, parentId: null, name: "Added sector", slug, code: "AS", reason: reason("new sector") });
    expect(sector.ok).toBe(true);
    if (!sector.ok) return;

    const child = await createCategory({
      actor: lead,
      parentId: sector.id,
      name: "Added child",
      slug: `${PREFIX}${stamp()}`,
      code: "AC",
      reason: reason("new child"),
    });
    expect(child.ok).toBe(true);
    if (!child.ok) return;

    const row = await prisma.category.findUniqueOrThrow({ where: { id: child.id }, select: { parentId: true, tradeKind: true, showInIndex: true } });
    expect(row).toEqual({ parentId: sector.id, tradeKind: null, showInIndex: true });
    expect(await prisma.auditEvent.findFirst({ where: { subject: `Category:${child.id}` }, select: { action: true } })).toEqual({
      action: "category_created",
    });

    expect(
      await createCategory({ actor: lead, parentId: child.id, name: "Grandchild", slug: `${PREFIX}${stamp()}`, code: "GC", reason: reason("deep") }),
    ).toEqual({ ok: false, error: "parent_not_sector" });
    expect(
      await createCategory({ actor: lead, parentId: null, name: "Clash", slug, code: "CL", reason: reason("clash") }),
    ).toEqual({ ok: false, error: "slug_taken" });
  });

  it("refuses to remove a category a product is filed under, instead of failing on the foreign key", async () => {
    const sector = await makeCategory("Remove sector");
    const child = await makeCategory("Remove child", sector.id);
    const elsewhere = await makeCategory("Remove elsewhere", sector.id);
    const listing = await makeListing(elsewhere.id);
    await prisma.product.create({
      data: { businessId: listing.id, name: "Filed product", slug: `${PREFIX}p-${stamp()}`, categoryId: child.id, availability: "in_stock" },
    });

    expect(await deleteCategory(lead, child.id, reason("remove"))).toMatchObject({
      ok: false,
      error: "would_orphan",
      detail: { reason: "products", count: 1 },
    });
  });

  it("counts a published emirate page among the addresses a rename moves", async () => {
    const sector = await makeCategory("Emirate page sector");
    await prisma.emiratePage.create({ data: { emirate: "dubai", categoryId: sector.id, publishedAt: new Date() } });
    const pairs = await addressesFor(sector.id, `${PREFIX}renamed`);
    expect(pairs).toContainEqual({ from: `/dubai/${sector.slug}`, to: `/dubai/${PREFIX}renamed` });
    await prisma.emiratePage.deleteMany({ where: { categoryId: sector.id } });
  });
});

describe("B5 — the merge tool", () => {
  it("moves every listing, product and page, writes the redirects, and removes the source in one step", async () => {
    const sectorA = await makeCategory("Merge sector A");
    const sectorB = await makeCategory("Merge sector B");
    const source = await makeCategory("Merge hoses", sectorA.id, { synonyms: ["hose"] });
    const target = await makeCategory("Merge pipes", sectorB.id, { synonyms: ["pipe"] });

    const onSource = await makeListing(source.id);
    const onTarget = await makeListing(target.id);
    // A listing filed under the target holding the source as a second category.
    await prisma.businessCategory.create({ data: { businessId: onTarget.id, categoryId: source.id } });
    await prisma.product.create({
      data: { businessId: onSource.id, name: "A hose", slug: `${PREFIX}p-${stamp()}`, categoryId: source.id, availability: "in_stock" },
    });
    // Both have a page for the same area: the target's stays, the source's copy is audited.
    await prisma.areaPage.create({ data: { areaId, categoryId: source.id, intro: "Source intro copy.", publishedAt: new Date() } });
    await prisma.areaPage.create({ data: { areaId, categoryId: target.id, intro: "Target intro copy.", publishedAt: new Date() } });

    const preview = await previewMerge(source.id, target.id);
    expect(preview?.refusal).toBeNull();
    expect(preview?.moves).toMatchObject({ listings: 1, unlistedListings: 0, secondCategoryLinks: 1, products: 1, areaPages: 1, pagesKept: 1 });

    const result = await mergeCategories({ actor: lead, sourceId: source.id, targetId: target.id, reason: reason("folding hoses") });
    expect(result.ok).toBe(true);

    expect(await prisma.category.findUnique({ where: { id: source.id } })).toBeNull();
    const moved = await prisma.business.findUniqueOrThrow({ where: { id: onSource.id }, select: { primaryCategoryId: true, sectorId: true } });
    // The trigger recomputed the sector for a subcategory merged across sectors.
    expect(moved).toEqual({ primaryCategoryId: target.id, sectorId: sectorB.id });
    // The target's listing no longer holds its own primary as a second category.
    expect(await prisma.businessCategory.count({ where: { businessId: onTarget.id } })).toBe(0);
    expect(await prisma.product.count({ where: { categoryId: target.id } })).toBe(1);
    expect(await prisma.areaPage.count({ where: { categoryId: target.id } })).toBe(1);

    const targetRow = await prisma.category.findUniqueOrThrow({ where: { id: target.id }, select: { synonyms: true } });
    expect(targetRow.synonyms).toEqual(expect.arrayContaining(["pipe", "Merge hoses", "hose"]));

    const redirect = await prisma.redirect.findUnique({ where: { fromPath: `/c/${sectorA.slug}/${source.slug}` } });
    expect(redirect?.toPath).toBe(`/c/${sectorB.slug}/${target.slug}`);

    const events = await prisma.auditEvent.findMany({
      where: { subject: { in: [`Category:${source.id}`, `Category:${target.id}`] }, action: "category_merged" },
      orderBy: { subject: "asc" },
    });
    expect(events).toHaveLength(2);
    const onTargetEvent = events.find((event) => event.subject === `Category:${target.id}`)!;
    expect(JSON.stringify(onTargetEvent.before)).toContain("Source intro copy.");
    expect(onTargetEvent.blastRadius).toBe(1);
  });

  it("re-parents a merged sector's subcategories and repoints their listings' sector", async () => {
    const source = await makeCategory("Merge sector source");
    const target = await makeCategory("Merge sector target");
    const child = await makeCategory("Merge sector child", source.id);
    const listing = await makeListing(child.id);
    expect(listing.sectorId).toBe(source.id);

    const result = await mergeCategories({ actor: lead, sourceId: source.id, targetId: target.id, reason: reason("sector merge") });
    expect(result.ok).toBe(true);

    expect((await prisma.category.findUniqueOrThrow({ where: { id: child.id }, select: { parentId: true } })).parentId).toBe(target.id);
    expect((await prisma.business.findUniqueOrThrow({ where: { id: listing.id }, select: { sectorId: true } })).sectorId).toBe(target.id);
    expect(
      (await prisma.redirect.findUnique({ where: { fromPath: `/c/${source.slug}/${child.slug}` } }))?.toPath,
    ).toBe(`/c/${target.slug}/${child.slug}`);
  });

  it("refuses different levels, different trade kinds and two paid slots — and writes nothing", async () => {
    const sector = await makeCategory("Refusal sector");
    const goods = await makeCategory("Refusal goods", sector.id, { tradeKind: "goods" });
    const services = await makeCategory("Refusal services", sector.id, { tradeKind: "services" });
    const goodsToo = await makeCategory("Refusal goods too", sector.id, { tradeKind: "goods" });

    expect(await mergeCategories({ actor: lead, sourceId: goods.id, targetId: sector.id, reason: reason("level") })).toEqual({
      ok: false,
      error: "level_mismatch",
    });
    expect(await mergeCategories({ actor: lead, sourceId: goods.id, targetId: services.id, reason: reason("kind") })).toEqual({
      ok: false,
      error: "trade_kind_differs",
    });

    const a = await makeListing(goods.id);
    const b = await makeListing(goodsToo.id);
    await prisma.placementSlot.create({ data: { businessId: a.id, categoryId: goods.id, monthlyPriceAed: 1, startsOn: new Date() } });
    await prisma.placementSlot.create({ data: { businessId: b.id, categoryId: goodsToo.id, monthlyPriceAed: 1, startsOn: new Date() } });
    expect(await mergeCategories({ actor: lead, sourceId: goods.id, targetId: goodsToo.id, reason: reason("slots") })).toEqual({
      ok: false,
      error: "placement_conflict",
    });

    expect(await prisma.category.count({ where: { id: { in: [goods.id, services.id, goodsToo.id] } } })).toBe(3);
    expect(await prisma.auditEvent.count({ where: { action: "category_merged", reason: { startsWith: `${PREFIX}` }, subject: `Category:${goodsToo.id}` } })).toBe(0);
  });

  it("is refused to a moderator", async () => {
    const sector = await makeCategory("Moderator merge");
    const other = await makeCategory("Moderator merge other");
    await expect(mergeCategories({ actor: moderator, sourceId: sector.id, targetId: other.id, reason: reason("mod") })).rejects.toBeInstanceOf(
      PermissionError,
    );
  });
});
