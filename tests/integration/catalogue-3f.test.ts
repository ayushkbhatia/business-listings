import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { getCatalogueView } from "@/lib/products/catalogue";
import { previewMove, movableCategories } from "@/lib/products/move-category";
import { hideOverPlanCap, restoreHiddenByPlan } from "@/lib/billing/plan-caps";

/**
 * Board 3f — the catalogue, against real rows.
 *
 * The criteria that are queries live here. The ones about what the screen says
 * are in tests/e2e/dashboard-catalogue.spec.ts, and the gap model itself is a
 * pure unit test in lib/products/gaps.test.ts.
 */

const PREFIX = "3F-CATALOGUE-FIXTURE";

let businessId: string;
let categoryId: string;
let childCategoryId: string;
/** A category answering to a different template, so a move actually costs. */
let foreignCategoryId: string;
let platformTemplateId: string;

const products: string[] = [];
const categories: string[] = [];
const templates: string[] = [];

beforeAll(async () => {
  const template = await prisma.specTemplate.findFirstOrThrow({
    where: { status: "live", fields: { some: {} }, defaultForCategories: { some: {} } },
    select: {
      id: true,
      defaultForCategories: { select: { id: true } },
      fields: { select: { id: true, required: true, isFilterable: true } },
    },
  });
  platformTemplateId = template.id;
  categoryId = template.defaultForCategories[0]!.id;

  const child = await prisma.category.create({
    data: {
      name: `${PREFIX} child`,
      slug: `${PREFIX.toLowerCase()}-child-${Date.now()}`,
      code: `${PREFIX.toLowerCase()}-child`,
      parentId: categoryId,
    },
    select: { id: true },
  });
  childCategoryId = child.id;
  categories.push(child.id);

  /*
     A second trade, with a template of its own.

     Made rather than found, because the seeded taxonomy has exactly one
     template and every category the picker offers resolves to it — which means
     the safe path is the only path a fixture can reach by accident. The lossy
     move is the one criterion 6 is about.
  */
  const foreign = await prisma.category.create({
    data: {
      name: `${PREFIX} foreign`,
      slug: `${PREFIX.toLowerCase()}-foreign-${Date.now()}`,
      code: `${PREFIX.toLowerCase()}-foreign`,
    },
    select: { id: true },
  });
  foreignCategoryId = foreign.id;
  categories.push(foreign.id);

  const foreignTemplate = await prisma.specTemplate.create({
    data: {
      // Board 4e made the relation many-to-many and dropped
      // `spec_template.category_id`. This fixture and #119 were built in
      // parallel and squash-merged an hour apart, so nothing typechecked the
      // two together until after both were on main.
      categories: { create: { categoryId: foreign.id } },
      name: `${PREFIX} bearings`,
      version: 1,
      status: "live",
      fields: {
        create: [
          { key: "bore", label: "Bore", type: "text", required: true, isFilterable: true, sortOrder: 0 },
          { key: "seal", label: "Seal", type: "text", sortOrder: 1 },
        ],
      },
    },
    select: { id: true },
  });
  templates.push(foreignTemplate.id);
  await prisma.category.update({
    where: { id: foreign.id },
    data: { defaultTemplateId: foreignTemplate.id },
  });

  const business = await prisma.business.findFirstOrThrow({
    where: { claimStatus: "claimed", sellerTemplates: { none: {} } },
    orderBy: { slug: "asc" },
    select: { id: true },
  });
  businessId = business.id;
});

afterEach(async () => {
  const ids = products.splice(0);
  if (ids.length > 0) await prisma.product.deleteMany({ where: { id: { in: ids } } });
});

afterAll(async () => {
  await prisma.product.deleteMany({ where: { slug: { startsWith: PREFIX.toLowerCase() } } });
  const templateIds = templates.splice(0);
  if (templateIds.length > 0) {
    await prisma.category.updateMany({
      where: { defaultTemplateId: { in: templateIds } },
      data: { defaultTemplateId: null },
    });
    await prisma.specField.deleteMany({ where: { templateId: { in: templateIds } } });
    await prisma.specTemplate.deleteMany({ where: { id: { in: templateIds } } });
  }
  const categoryIds = categories.splice(0);
  if (categoryIds.length > 0) {
    await prisma.category.deleteMany({ where: { id: { in: categoryIds } } });
  }
  await prisma.$disconnect();
});

async function product(
  label: string,
  opts: {
    specValues?: Record<string, unknown>;
    status?: "live" | "draft" | "out_of_stock";
    categoryId?: string;
  } = {},
): Promise<string> {
  const row = await prisma.product.create({
    data: {
      businessId,
      categoryId: opts.categoryId ?? childCategoryId,
      name: `${PREFIX} ${label}`,
      slug: `${PREFIX.toLowerCase()}-${label.toLowerCase()}-${Date.now()}-${products.length}`,
      availability: "in_stock",
      status: opts.status ?? "live",
      specValues: (opts.specValues ?? {}) as never,
    },
    select: { id: true },
  });
  products.push(row.id);
  return row.id;
}

/** Only this fixture's rows — the seller has a seeded catalogue too. */
function mine(view: Awaited<ReturnType<typeof getCatalogueView>>) {
  return view.rows.filter((row) => row.name.startsWith(PREFIX));
}

describe("criterion 1 — the header's counts sum to its total", () => {
  it("adds up, and matches what the pagination counts to", async () => {
    /*
       The board read `1,204 live · 38 drafts · 14 out of stock` — 1,256 — over
       a pagination reading `1–10 of 1,242`, because 1,204 was the seller's
       *total* and the header had labelled it as the live count. One read, one
       array, so the figures cannot disagree.
    */
    await product("live-a");
    await product("live-b");
    await product("draft-a", { status: "draft" });
    await product("oos-a", { status: "out_of_stock" });

    const { summary, filtered } = await getCatalogueView(businessId, { pageSize: 100 });
    expect(summary.live + summary.draft + summary.outOfStock).toBe(summary.total);
    expect(filtered).toBe(summary.total);
  });
});

describe("criterion 2 — two gap counts, never combined", () => {
  it("counts blocked-on-save and missing-a-filter separately", async () => {
    const fields = await prisma.specField.findMany({
      where: { templateId: platformTemplateId },
      select: { id: true, required: true, isFilterable: true },
    });
    const required = fields.filter((f) => f.required);
    const facetOnly = fields.filter((f) => f.isFilterable && !f.required);
    expect(required.length).toBeGreaterThan(0);

    // Every required field filled, so nothing is blocked; a facet left empty,
    // so it is absent from that filter.
    const filledRequired = Object.fromEntries(required.map((f) => [f.id, "x"]));
    await product("filter-gap-only", { specValues: filledRequired });
    // Nothing filled at all: blocked *and* missing filters.
    await product("both", {});

    const view = await getCatalogueView(businessId, { pageSize: 200 });
    const rows = mine(view);
    const only = rows.find((row) => row.name.endsWith("filter-gap-only"))!;
    const both = rows.find((row) => row.name.endsWith("both"))!;

    expect(only.gaps.requiredMissing).toBe(0);
    if (facetOnly.length > 0) expect(only.gaps.filterGaps).toBeGreaterThan(0);
    expect(both.gaps.requiredMissing).toBe(required.length);
    expect(both.gaps.filterGaps).toBeGreaterThan(0);
  });

  it("filters the list by each chip independently", async () => {
    const fields = await prisma.specField.findMany({
      where: { templateId: platformTemplateId, required: true },
      select: { id: true },
    });
    await product("clean", { specValues: Object.fromEntries(fields.map((f) => [f.id, "x"])) });
    await product("blocked", {});

    const blocked = await getCatalogueView(businessId, { gap: "blocked", pageSize: 200 });
    const names = mine(blocked).map((row) => row.name);
    expect(names).toContain(`${PREFIX} blocked`);
    expect(names).not.toContain(`${PREFIX} clean`);
  });
});

describe("criterion 3 — live and save-blocked at once", () => {
  it("is both, and stays in the catalogue as live", async () => {
    /*
       The gate valve row from the render, and the case the board had no way to
       express. Board 3h §5 intends it: a new requirement never delists
       anything; it bites at the next save.
    */
    const id = await product("gate-valve", {});
    const view = await getCatalogueView(businessId, { pageSize: 200 });
    const row = mine(view).find((r) => r.id === id)!;

    expect(row.status).toBe("live");
    expect(row.gaps.requiredMissing).toBeGreaterThan(0);
  });
});

describe("criterion 4 — the ratio is derived at read time", () => {
  it("moves when the template gains a field, with no write to the product", async () => {
    const id = await product("derived", {});
    const before = mine(await getCatalogueView(businessId, { pageSize: 200 })).find((r) => r.id === id)!;
    const stamp = await prisma.product.findUniqueOrThrow({
      where: { id },
      select: { updatedAt: true },
    });

    const added = await prisma.specField.create({
      data: {
        templateId: platformTemplateId,
        key: `${PREFIX.toLowerCase()}_extra`,
        label: `${PREFIX} extra`,
        type: "text",
        sortOrder: 99,
      },
      select: { id: true },
    });

    const after = mine(await getCatalogueView(businessId, { pageSize: 200 })).find((r) => r.id === id)!;
    expect(after.gaps.total).toBe(before.gaps.total + 1);

    const again = await prisma.product.findUniqueOrThrow({
      where: { id },
      select: { updatedAt: true },
    });
    expect(again.updatedAt.getTime()).toBe(stamp.updatedAt.getTime());

    await prisma.specField.delete({ where: { id: added.id } });
  });
});

describe("criterion 5 — a product with no template cannot be published", () => {
  it("is flagged untemplated, and the row says so", async () => {
    const orphan = await prisma.category.create({
      data: {
        name: `${PREFIX} orphan`,
        slug: `${PREFIX.toLowerCase()}-orphan-${Date.now()}`,
        code: `${PREFIX.toLowerCase()}-orphan`,
      },
      select: { id: true },
    });
    categories.push(orphan.id);

    const id = await product("orphan", { categoryId: orphan.id });
    const view = await getCatalogueView(businessId, { pageSize: 200 });
    const row = mine(view).find((r) => r.id === id)!;

    expect(row.untemplated).toBe(true);
    expect(row.gaps.total).toBe(0);
    expect(view.summary.untemplated).toBeGreaterThan(0);
  });
});

describe("criteria 6 and 8 — the move preview names what it costs", () => {
  it("says nothing is lost when the template is the same", async () => {
    const id = await product("sibling", { specValues: {} });
    const preview = (await previewMove(businessId, [id], categoryId))!;

    expect(preview.products).toBe(1);
    expect(preview.sameTemplate).toBe(true);
    expect(preview.droppedValues).toBe(0);
    expect(preview.facetsLost).toEqual([]);
  });

  it("names every value that stops being readable, and the facets lost", async () => {
    const fields = await prisma.specField.findMany({
      where: { templateId: platformTemplateId },
      orderBy: { sortOrder: "asc" },
      select: { id: true, label: true, isFilterable: true },
    });
    const values = Object.fromEntries(fields.map((f) => [f.id, `${f.label} value`]));

    const a = await product("move-a", { specValues: values });
    const b = await product("move-b", { specValues: values });

    const preview = (await previewMove(businessId, [a, b], foreignCategoryId))!;

    expect(preview.products).toBe(2);
    expect(preview.sameTemplate).toBe(false);
    // Every field of the source template, across both products.
    expect(preview.droppedValues).toBe(fields.length * 2);
    expect(preview.dropped.map((entry) => entry.label).sort()).toEqual(
      fields.map((f) => f.label).sort(),
    );
    // And each names how many products and one example, so the seller
    // recognises what they would lose.
    for (const entry of preview.dropped) {
      expect(entry.products).toBe(2);
      expect(entry.sample).toContain("value");
    }

    // Criterion 8: the facets gained and lost.
    expect(preview.facetsLost.length).toBeGreaterThan(0);
    expect(preview.facetsGained).toContain("Bore");
    expect(preview.targetTemplateName).toContain("bearings");
  });

  it("excludes products already filed in the target", async () => {
    const there = await product("already", { categoryId: foreignCategoryId });
    const moving = await product("moving", {});
    const preview = (await previewMove(businessId, [there, moving], foreignCategoryId))!;

    expect(preview.products).toBe(1);
    expect(preview.alreadyThere).toBe(1);
  });

  it("flags a target with no template at all", async () => {
    const orphan = await prisma.category.create({
      data: {
        name: `${PREFIX} orphan-target`,
        slug: `${PREFIX.toLowerCase()}-orphan-target-${Date.now()}`,
        code: `${PREFIX.toLowerCase()}-orphan-target`,
      },
      select: { id: true },
    });
    categories.push(orphan.id);

    const id = await product("to-orphan", {});
    const preview = (await previewMove(businessId, [id], orphan.id))!;
    expect(preview.targetUntemplated).toBe(true);
  });

  it("never matches a product belonging to another business", async () => {
    const other = await prisma.product.findFirstOrThrow({
      where: { businessId: { not: businessId } },
      select: { id: true },
    });
    const mineId = await product("scoped", {});
    const preview = (await previewMove(businessId, [mineId, other.id], foreignCategoryId))!;
    // Scoped, not trusted: the foreign id is simply not matched.
    expect(preview.products + preview.alreadyThere).toBe(1);
  });
});

describe("criterion 10 — the filtered set is what Select all takes", () => {
  it("hands back every id the filters match, not the page's", async () => {
    for (let i = 0; i < 6; i += 1) await product(`page-${i}`, {});

    const view = await getCatalogueView(businessId, { pageSize: 10, gap: "blocked" });
    expect(view.rows.length).toBeLessThanOrEqual(10);
    expect(view.filteredIds.length).toBe(view.filtered);
    expect(view.filteredIds.length).toBeGreaterThanOrEqual(view.rows.length);
  });
});

describe("criterion 12 — search matches spec values, not only names", () => {
  it("finds a product by a value the seller typed into a spec field", async () => {
    const facet = await prisma.specField.findFirstOrThrow({
      where: { templateId: platformTemplateId, isFilterable: true },
      select: { id: true },
    });
    const id = await product("searchable", { specValues: { [facet.id]: "PN16UNIQUE" } });
    await product("other", {});

    const view = await getCatalogueView(businessId, { q: "pn16unique", pageSize: 200 });
    expect(view.rows.map((row) => row.id)).toEqual([id]);
  });

  it("still finds by name and SKU", async () => {
    const id = await product("findbyname", {});
    const view = await getCatalogueView(businessId, { q: "findbyname", pageSize: 200 });
    expect(view.rows.map((row) => row.id)).toContain(id);
  });
});

describe("criterion 14 — reducing a plan never deletes a record", () => {
  it("unlists the overflow, keeps every row, and puts them back on the way up", async () => {
    /*
       The screen's own promise: a Pro seller with 1,242 products who downgrades
       keeps all 1,242. Board 3f only shows the cap and enforces listing —
       `hideOverPlanCap` is the mechanism, and this asserts the half the
       catalogue renders: the record survives and the row says `Stored · not
       listed` rather than vanishing.
    */
    for (let i = 0; i < 4; i += 1) await product(`cap-${i}`, {});
    const before = await prisma.product.count({ where: { businessId } });

    /*
       The subscription is made here rather than assumed.

       Without a row there is nowhere to record what was hidden, and
       `hideOverPlanCap` refuses instead of orphaning products — so a test that
       skipped when the fixture business had none would pass while asserting
       nothing, which is the failure mode this comment exists to prevent. The
       chosen business has no subscription; one is created and removed again.
    */
    const plan = await prisma.plan.findFirstOrThrow({ select: { id: true } });
    const created = await prisma.subscription.create({
      data: {
        businessId,
        planId: plan.id,
        renewsAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      },
      select: { id: true },
    });

    try {
      const liveBefore = await prisma.product.count({
        where: { businessId, status: "live" },
      });
      const cap = Math.max(1, liveBefore - 3);

      const outcome = await hideOverPlanCap(businessId, { productLimit: cap });
      expect(outcome.hidden).toBeGreaterThan(0);

      // Nothing was deleted. This is the assertion the whole rule turns on.
      expect(await prisma.product.count({ where: { businessId } })).toBe(before);

      const view = await getCatalogueView(businessId, { pageSize: 1000 });
      const stored = view.rows.filter((row) => row.storedNotListed);
      expect(stored.length).toBe(outcome.hidden);
      // Unlisted is `draft`, because every public surface already excludes one
      // — so no read path has to learn a new rule, and none can forget it.
      expect(stored.every((row) => row.status === "draft")).toBe(true);
      // And the seller can tell it apart from a draft they wrote themselves.
      expect(view.rows.some((row) => row.status === "draft" && !row.storedNotListed)).toBe(
        view.summary.draft > stored.length,
      );

      const back = await restoreHiddenByPlan(businessId, { productLimit: null });
      expect(back.restored).toBe(outcome.hidden);
      const after = await getCatalogueView(businessId, { pageSize: 1000 });
      expect(after.rows.filter((row) => row.storedNotListed)).toHaveLength(0);
    } finally {
      await prisma.subscription.delete({ where: { id: created.id } });
    }
  });
});

describe("criterion 15 — every count is a query", () => {
  it("moves with the data rather than staying put", async () => {
    const first = await getCatalogueView(businessId, { pageSize: 1 });
    await product("counted", {});
    const second = await getCatalogueView(businessId, { pageSize: 1 });
    expect(second.summary.total).toBe(first.summary.total + 1);
  });
});

describe("the categories a product may move to", () => {
  it("offers the trade's niches, not one category and not the whole taxonomy", async () => {
    /*
       A supplier's primary category is usually a subcategory, so taking their
       own categories and the children of those offered exactly one destination
       — a picker with nothing in it. Up to the trade, then down to its niches.
    */
    const targets = await movableCategories(businessId);
    expect(targets.length).toBeGreaterThan(1);
    expect(targets.map((t) => t.id)).toContain(categoryId);
  });
});
