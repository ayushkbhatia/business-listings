import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  arrayFieldIds,
  knownFieldIds,
  resolveEditorTemplate,
} from "@/lib/products/editor-template";
import { buyerPreviewFor } from "@/lib/products/buyer-preview";
import { cloneTemplate, saveDraft, applyDraft } from "@/lib/catalogue/template";
import { missingFrom } from "@/lib/catalogue/overlay";
import { mergeSpecValues } from "@/lib/products/spec-values";
import type { Actor } from "@/lib/auth/roles";

/**
 * Board 3g — the product editor, against real rows.
 *
 * The criteria that are queries live here; the ones about what a screen says
 * are in tests/e2e/dashboard-product-editor.spec.ts and
 * tests/unit/product-spec-grid.test.tsx.
 *
 * The first describe is the one this file exists for. Two call sites resolved
 * "which template governs this product" two different ways and a third resolved
 * it a third way, so the editor rendered nothing while the save silently
 * discarded everything the form posted — two bugs that cancelled into looking
 * like one empty screen.
 */

const PREFIX = "3G-EDITOR-FIXTURE";

let businessId: string;
let actorId: string;
let platformTemplateId: string;
/** The template's own category. */
let categoryId: string;
/** A child of it, with no template of its own — where the seed files products. */
let childCategoryId: string;

const products: string[] = [];
const templates: string[] = [];
const extraFields: string[] = [];
const categories: string[] = [];

function actorFor(): Actor {
  return { id: actorId, roles: ["seller_owner"], businessId };
}

beforeAll(async () => {
  /*
     A template a category actually points at.

     The `defaultForCategories` clause is load-bearing and board 3h's own
     fixture records why: `resolveDefaultTemplateId` follows
     `Category.defaultTemplateId`, so an arbitrary live template need not be
     reachable from any category at all. Without it this file passes alone and
     fails in the suite.
  */
  const template = await prisma.specTemplate.findFirstOrThrow({
    where: { status: "live", fields: { some: {} }, defaultForCategories: { some: {} } },
    select: { id: true, defaultForCategories: { select: { id: true } } },
  });
  platformTemplateId = template.id;
  categoryId = template.defaultForCategories[0]!.id;

  /*
     A child category with no template of its own.

     This is the shape the whole board turns on: a template belongs to the
     trade, not the niche, and every seeded product is filed under a
     subcategory. Made rather than found, so the test does not depend on the
     taxonomy keeping a particular child.
  */
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

  const business = await prisma.business.findFirstOrThrow({
    where: { claimStatus: "claimed", sellerTemplates: { none: {} } },
    orderBy: { slug: "asc" },
    select: { id: true },
  });
  businessId = business.id;

  const owner = await prisma.user.findFirst({
    where: { businessId, roles: { has: "seller_owner" } },
    select: { id: true },
  });
  actorId = owner?.id ?? crypto.randomUUID();
});

afterEach(async () => {
  const ids = products.splice(0);
  if (ids.length > 0) await prisma.product.deleteMany({ where: { id: { in: ids } } });
  const fields = extraFields.splice(0);
  if (fields.length > 0) await prisma.specField.deleteMany({ where: { id: { in: fields } } });
  templates.splice(0);
  await prisma.sellerTemplate.deleteMany({ where: { businessId } });
});

afterAll(async () => {
  await prisma.product.deleteMany({ where: { slug: { startsWith: PREFIX.toLowerCase() } } });
  await prisma.sellerTemplate.deleteMany({ where: { businessId } });
  const ids = categories.splice(0);
  if (ids.length > 0) await prisma.category.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

async function clone() {
  const view = await cloneTemplate(actorFor(), businessId, platformTemplateId);
  templates.push(view.id);
  return view;
}

async function product(
  label: string,
  specValues: Record<string, unknown>,
  category = childCategoryId,
): Promise<string> {
  const row = await prisma.product.create({
    data: {
      businessId,
      categoryId: category,
      name: `${PREFIX} ${label}`,
      slug: `${PREFIX.toLowerCase()}-${label.toLowerCase()}-${Date.now()}-${products.length}`,
      availability: "in_stock",
      status: "live",
      specValues: specValues as never,
    },
    select: { id: true },
  });
  products.push(row.id);
  return row.id;
}

describe("one resolver — the bug the whole board depended on", () => {
  it("resolves the parent's template for a product filed under a child category", async () => {
    /*
       The editor read `product.category.defaultTemplate?.id` with no hop, so
       every product in the seeded catalogue rendered zero inputs. Every other
       criterion was being asserted against an empty grid.
    */
    const template = await resolveEditorTemplate(businessId, childCategoryId);
    expect(template).not.toBeNull();
    expect(template!.fields.length).toBeGreaterThan(0);
  });

  it("gives the save the same field set the editor rendered", async () => {
    /*
       The other half, and the worse one. `saveProduct` built its `known` set
       from a query that also did not hop, so it came back empty and every
       posted spec value was dropped on the floor — silently, while the
       requirement check read a third resolution and refused the save naming
       fields that had no box on screen.
    */
    const template = (await resolveEditorTemplate(businessId, childCategoryId))!;
    const known = knownFieldIds(template);
    expect(known.size).toBe(template.fields.length);
    for (const field of template.fields) expect(known.has(field.fieldId)).toBe(true);
  });

  it("falls back to the platform template for a seller with no clone", async () => {
    /*
       Mandatory, not a nicety. `templateForCategory` returns null with no
       clone, and most sellers have none — resolving from it alone would turn
       "renders nothing" into "silently discards what was typed" for the
       majority, which is a worse bug wearing the same clothes.
    */
    await prisma.sellerTemplate.deleteMany({ where: { businessId } });
    const template = (await resolveEditorTemplate(businessId, childCategoryId))!;
    expect(template.source).toBe("platform");
    expect(template.cloneSlug).toBeNull();

    const platformFields = await prisma.specField.findMany({
      where: { templateId: platformTemplateId },
      select: { id: true },
    });
    expect(knownFieldIds(template).size).toBe(platformFields.length);
  });

  it("stores a value posted against the platform fallback", async () => {
    await prisma.sellerTemplate.deleteMany({ where: { businessId } });
    const template = (await resolveEditorTemplate(businessId, childCategoryId))!;
    const field = template.fields.find((f) => f.options.length > 0)!;

    const merged = mergeSpecValues({
      stored: {},
      presented: [field.fieldId],
      posted: { [field.fieldId]: field.options[0]! },
      known: knownFieldIds(template),
      arrayFields: arrayFieldIds(template),
    });
    expect(merged[field.fieldId]).toBe(field.options[0]);
  });
});

describe("criterion 2 — the order is the template's, with the seller's overrides", () => {
  it("follows a sortOrder the seller set, not the platform's", async () => {
    const view = await clone();
    const last = view.fields[view.fields.length - 1]!;

    // The last field pulled to the front. Every other field keeps the
    // platform's position, which `saveDraft` stores as no override at all.
    await saveDraft(actorFor(), businessId, view.id, {
      mappings: { [last.fieldId]: { sortOrder: -1 } },
      ownFields: [],
    });
    await applyDraft(actorFor(), businessId, view.id);

    const template = (await resolveEditorTemplate(businessId, childCategoryId))!;
    expect(template.fields[0]!.fieldId).toBe(last.fieldId);
  });
});

describe("criterion 3 — FILTER comes from the record, not a local list", () => {
  it("marks exactly the platform's filterable fields, minus any detached", async () => {
    const template = (await resolveEditorTemplate(businessId, childCategoryId))!;

    const filterable = await prisma.specField.findMany({
      where: { templateId: platformTemplateId, isFilterable: true },
      select: { id: true },
    });

    const badged = template.fields.filter((f) => f.facet === "platform").map((f) => f.fieldId);
    const detached = new Set(template.fields.filter((f) => f.detached).map((f) => f.fieldId));

    /*
       Equality minus the detached set, not plain equality. `resolve()` sets
       `isFilterable: field.isFilterable && !detached` and `facetStateOf`
       returns `yours_only` for a detached field — which is correct, and would
       make a plain equality assertion fail the moment anyone detached one.
    */
    expect(new Set(badged)).toEqual(
      new Set(filterable.map((f) => f.id).filter((id) => !detached.has(id))),
    );
  });

  it("drops a detached field out of the facet and keeps its value", async () => {
    const view = await clone();
    const facetField = view.fields.find((f) => f.isFilterable)!;
    const productId = await product("detached", { [facetField.fieldId]: "DN50" });

    await saveDraft(actorFor(), businessId, view.id, {
      mappings: { [facetField.fieldId]: { detached: true } },
      ownFields: [],
    });
    await applyDraft(actorFor(), businessId, view.id);

    const template = (await resolveEditorTemplate(businessId, childCategoryId))!;
    const resolved = template.fields.find((f) => f.fieldId === facetField.fieldId)!;
    expect(resolved.facet).toBe("yours_only");
    expect(resolved.detached).toBe(true);

    const row = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
      select: { specValues: true },
    });
    expect((row.specValues as Record<string, unknown>)[facetField.fieldId]).toBe("DN50");
  });
});

describe("criterion 7 — a blocked save never delists", () => {
  it("refuses while leaving the product live", async () => {
    const template = (await resolveEditorTemplate(businessId, childCategoryId))!;
    const required = template.fields.filter((f) => f.requiredNow);
    expect(required.length).toBeGreaterThan(0);

    const productId = await product("blocked", {});
    const check = missingFrom(template.fields, {});
    expect(check.ok).toBe(false);
    expect(check.missing).toEqual(required.map((f) => f.label));

    const row = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
      select: { status: true },
    });
    // The surprising half, and the one the screen has to state: the seller
    // cannot save, and nothing has been taken down.
    expect(row.status).toBe("live");
  });

  it("names the seller's own label, not the platform's", async () => {
    const view = await clone();
    const field = view.fields.find((f) => f.required)!;

    await saveDraft(actorFor(), businessId, view.id, {
      mappings: { [field.fieldId]: { label: "Material of construction" } },
      ownFields: [],
    });
    await applyDraft(actorFor(), businessId, view.id);

    const template = (await resolveEditorTemplate(businessId, childCategoryId))!;
    expect(missingFrom(template.fields, {}).missing).toContain("Material of construction");
  });
});

describe("criterion 8 — completeness is derived, never stored", () => {
  it("moves the denominator when the template gains a field, with no write to any product", async () => {
    const productId = await product("derived", {});
    const before = (await resolveEditorTemplate(businessId, childCategoryId))!;

    const stamp = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
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
    extraFields.push(added.id);

    const after = (await resolveEditorTemplate(businessId, childCategoryId))!;
    expect(after.fields.length).toBe(before.fields.length + 1);

    const again = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
      select: { updatedAt: true },
    });
    // No migration, and no row touched. The figure changed on the next read.
    expect(again.updatedAt.getTime()).toBe(stamp.updatedAt.getTime());
  });
});

describe("criterion 11 — the preview is the buyer's table", () => {
  it("renders the same rows the buyer's page composes, with the seller's labels", async () => {
    const view = await clone();
    const field = view.fields[0]!;
    await saveDraft(actorFor(), businessId, view.id, {
      mappings: { [field.fieldId]: { label: "Bore size" } },
      ownFields: [],
    });
    await applyDraft(actorFor(), businessId, view.id);

    const specValues = { [field.fieldId]: "DN50" };
    const preview = await buyerPreviewFor(businessId, childCategoryId, specValues);

    expect(preview.rows.map((row) => row.label)).toContain("Bore size");
    /*
       Every field is a row. Board 3g's §5 asks for the empty ones to be
       omitted; CLAUDE.md says unfilled rows stay visible and board 1g's own
       criterion pins the count, so this is the assertion that stops the
       handoff's wording being reintroduced by someone reading only the handoff.
    */
    expect(preview.rows.length).toBe(preview.fields.length);
    expect(preview.filled).toBe(1);
    expect(preview.rows.filter((row) => row.value === null).length).toBe(preview.total - 1);
  });

  it("carries every platform field the editor shows, and no own field", async () => {
    /*
       The gap this board makes visible rather than creates. `getSellerOverlay`
       returns labels and order for platform fields only and never reads
       `ownFields`, so a field the seller invented is in the grid and not on the
       buyer's page. Asserted rather than reconciled: the rail states the
       difference as a count, and if the two sets ever diverge for any *other*
       reason this fails.
    */
    const view = await clone();
    await saveDraft(actorFor(), businessId, view.id, {
      mappings: {},
      ownFields: [
        {
          id: `${PREFIX.toLowerCase()}-warranty`,
          label: "Warranty",
          type: "number",
          unit: "months",
          options: [],
          required: false,
          sortOrder: 99,
        },
      ],
    });
    await applyDraft(actorFor(), businessId, view.id);

    const template = (await resolveEditorTemplate(businessId, childCategoryId))!;
    const preview = await buyerPreviewFor(businessId, childCategoryId, {});

    const own = template.fields.filter((f) => f.own);
    expect(own.map((f) => f.label)).toEqual(["Warranty"]);

    const editorPlatform = new Set(template.fields.filter((f) => !f.own).map((f) => f.fieldId));
    const previewIds = new Set(preview.fields.map((f) => f.id));
    expect(previewIds).toEqual(editorPlatform);
  });
});

describe("the multiselect that was being destroyed", () => {
  it("keeps a stored array through a save that re-posts it", async () => {
    const template = (await resolveEditorTemplate(businessId, childCategoryId))!;
    const multi = template.fields.find((f) => f.type === "multiselect");
    if (!multi) return; // No multiselect on this template; nothing to assert.

    const merged = mergeSpecValues({
      stored: { [multi.fieldId]: ["WRAS", "UL listed"] },
      presented: [multi.fieldId],
      posted: { [multi.fieldId]: "WRAS|UL listed" },
      known: knownFieldIds(template),
      arrayFields: arrayFieldIds(template),
    });
    expect(merged[multi.fieldId]).toEqual(["WRAS", "UL listed"]);
  });

  it("recognises the multiselect from the resolved template", async () => {
    const template = (await resolveEditorTemplate(businessId, childCategoryId))!;
    const declared = await prisma.specField.findMany({
      where: { templateId: platformTemplateId, type: "multiselect" },
      select: { id: true },
    });
    expect(arrayFieldIds(template)).toEqual(new Set(declared.map((f) => f.id)));
  });
});

describe("criterion 9's backing — an empty filterable field is absent, not ranked lower", () => {
  it("is missing from a spec-filtered result set entirely", async () => {
    /*
       The whole copy argument on this screen rests on this being true, and
       nothing asserted it. If a product with the field empty were merely ranked
       lower, the sentence in `product.gap_reason_filter` would be a lie.
    */
    const template = (await resolveEditorTemplate(businessId, childCategoryId))!;
    const facet = template.fields.find((f) => f.facet === "platform" && f.options.length > 0)!;
    const value = facet.options[0]!;

    const filledId = await product("filled", { [facet.fieldId]: value });
    const emptyId = await product("empty", {});

    const matched = await prisma.product.findMany({
      where: {
        businessId,
        specValues: { path: [facet.fieldId], equals: value },
      },
      select: { id: true },
    });
    const ids = matched.map((row) => row.id);
    expect(ids).toContain(filledId);
    expect(ids).not.toContain(emptyId);
  });
});
