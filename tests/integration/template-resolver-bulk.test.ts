import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { resolveTemplateId, resolveTemplateIds } from "@/lib/spec/resolve";

/**
 * `resolveTemplateIds` — the bulk half of board 4e's one rule.
 *
 * Board 4e wrote `resolveTemplateId` because six readers had answered "which
 * template does this category use" six ways. An eighth then appeared in
 * `lib/metrics/strength-job.ts`, which writes the `specCompleteness` column
 * that `lib/search/ranking.ts` weights at twelve: it read
 * `category.defaultTemplateId` directly — step 1 of three — because the sweep
 * scores every product on the platform and could not afford three queries per
 * row.
 *
 * So the sweep now gets a bulk reader, and the only thing worth testing about
 * it is that it is the same rule: **every case here asserts
 * `resolveTemplateIds` against `resolveTemplateId` on the same category**, so
 * the two cannot drift into the seventh and eighth answers.
 */

const PREFIX = "tplbulk-";
const madeCategories: string[] = [];
const madeTemplates: string[] = [];

let seq = 0;
const stamp = () => `${Date.now().toString(36)}${(seq += 1)}`;

async function makeCategory(fields?: {
  parentId?: string;
  defaultTemplateId?: string;
}): Promise<string> {
  const mark = stamp();
  const category = await prisma.category.create({
    data: {
      name: `${PREFIX}${mark}`,
      slug: `${PREFIX}${mark}`,
      code: `${PREFIX}${mark}`.slice(0, 32),
      ...(fields?.parentId ? { parentId: fields.parentId } : {}),
      ...(fields?.defaultTemplateId ? { defaultTemplateId: fields.defaultTemplateId } : {}),
    },
    select: { id: true },
  });
  madeCategories.push(category.id);
  return category.id;
}

async function makeTemplate(version: number, categoryIds: readonly string[] = []): Promise<string> {
  const template = await prisma.specTemplate.create({
    data: {
      name: `${PREFIX}${stamp()}`,
      version,
      status: "live",
      ...(categoryIds.length > 0
        ? { categories: { create: categoryIds.map((categoryId) => ({ categoryId })) } }
        : {}),
    },
    select: { id: true },
  });
  madeTemplates.push(template.id);
  return template.id;
}

/** Both readers, on one category. The assertion is always that they agree. */
async function both(categoryId: string) {
  const [single, bulk] = await Promise.all([
    resolveTemplateId(prisma, categoryId),
    resolveTemplateIds(prisma, [categoryId]),
  ]);
  expect(bulk.get(categoryId), "bulk must answer what the single reader answers").toBe(single);
  return single;
}

afterAll(async () => {
  await prisma.specTemplateCategory.deleteMany({ where: { templateId: { in: madeTemplates } } });
  await prisma.category.updateMany({
    where: { id: { in: madeCategories } },
    data: { defaultTemplateId: null },
  });
  await prisma.specTemplate.deleteMany({ where: { id: { in: madeTemplates } } });
  // Children first: a parent with a child still on it will not delete.
  await prisma.category.deleteMany({
    where: { id: { in: madeCategories }, parentId: { not: null } },
  });
  await prisma.category.deleteMany({ where: { id: { in: madeCategories } } });
});

beforeAll(async () => {
  // Nothing to prepare. Every fixture is built per case so the pool under test
  // is only what that case created.
});

describe("the three steps, in order", () => {
  it("step 1 — the category's own default wins over everything else", async () => {
    const parentTemplate = await makeTemplate(9);
    const ownTemplate = await makeTemplate(1);
    const parent = await makeCategory({ defaultTemplateId: parentTemplate });
    const child = await makeCategory({ parentId: parent, defaultTemplateId: ownTemplate });

    // The parent's is newer and the parent's is a default too. Neither matters.
    expect(await both(child)).toBe(ownTemplate);
  });

  it("step 2 — the parent's default, when the category has none", async () => {
    const parentTemplate = await makeTemplate(1);
    const parent = await makeCategory({ defaultTemplateId: parentTemplate });
    const child = await makeCategory({ parentId: parent });

    expect(await both(child)).toBe(parentTemplate);
  });

  it("step 3 — a live template that serves the category, with no default anywhere", async () => {
    /*
       The case board 4e was written for, and the one the strength job got
       wrong: `setTemplateCategories` attaches a template to a category and
       never writes `defaultTemplateId`, so reading step 1 alone returned null,
       the rule set came back empty, and an empty rule set counts as complete —
       `specCompleteness` 1.00 for a seller who had filled in nothing.
    */
    const category = await makeCategory();
    const serving = await makeTemplate(1, [category]);

    expect(await both(category)).toBe(serving);
  });

  it("step 3 reaches the parent's attachments as well", async () => {
    const parent = await makeCategory();
    const child = await makeCategory({ parentId: parent });
    const serving = await makeTemplate(1, [parent]);

    expect(await both(child)).toBe(serving);
  });

  it("takes the newest live template across the category and its parent", async () => {
    /*
       Reproducing a quirk deliberately. `resolveTemplateId`'s step 3 is one
       `findFirst` over `categoryId: { in: [own, parent] }` ordered by version,
       so a parent's v3 beats the category's own v2 — which is not what its own
       comment says it does. The bulk reader has to make the same choice, or the
       nightly job and the request path would rank the same product differently.
       Changing the preference is a change to both, and this is what would fail.
    */
    const parent = await makeCategory();
    const child = await makeCategory({ parentId: parent });
    await makeTemplate(2, [child]);
    const parentNewer = await makeTemplate(3, [parent]);

    expect(await both(child)).toBe(parentNewer);
  });

  it("ignores a draft template — live only", async () => {
    const category = await makeCategory();
    const draft = await prisma.specTemplate.create({
      data: { name: `${PREFIX}${stamp()}`, version: 5, status: "draft",
              categories: { create: [{ categoryId: category }] } },
      select: { id: true },
    });
    madeTemplates.push(draft.id);

    expect(await both(category)).toBeNull();
  });

  it("answers null for a category with nothing, and for an id that names no row", async () => {
    const category = await makeCategory();
    expect(await both(category)).toBeNull();

    const bulk = await resolveTemplateIds(prisma, ["category-that-does-not-exist"]);
    expect(bulk.get("category-that-does-not-exist")).toBeNull();
  });
});

describe("what makes it usable by a whole-table sweep", () => {
  it("answers many categories at once, each with its own rule step", async () => {
    const ownTemplate = await makeTemplate(1);
    const parentTemplate = await makeTemplate(1);
    const parent = await makeCategory({ defaultTemplateId: parentTemplate });

    const byOwnDefault = await makeCategory({ defaultTemplateId: ownTemplate });
    const byParentDefault = await makeCategory({ parentId: parent });
    const byNothing = await makeCategory();
    const byServing = await makeCategory();
    const serving = await makeTemplate(1, [byServing]);

    const ids = [byOwnDefault, byParentDefault, byNothing, byServing];
    const bulk = await resolveTemplateIds(prisma, ids);

    expect(bulk.get(byOwnDefault)).toBe(ownTemplate);
    expect(bulk.get(byParentDefault)).toBe(parentTemplate);
    expect(bulk.get(byNothing)).toBeNull();
    expect(bulk.get(byServing)).toBe(serving);

    // And one at a time agrees with all four.
    for (const id of ids) expect(bulk.get(id)).toBe(await resolveTemplateId(prisma, id));
  });

  it("deduplicates its input and answers an empty list with an empty map", async () => {
    const category = await makeCategory();
    const bulk = await resolveTemplateIds(prisma, [category, category, category]);
    expect(bulk.size).toBe(1);
    expect((await resolveTemplateIds(prisma, [])).size).toBe(0);
  });
});
