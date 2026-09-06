import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  createTemplate,
  discardDraft,
  proposalKey,
  publishDraft,
  reviewRequireField,
  setFieldRequired,
  stageAddField,
  stageChange,
} from "@/lib/spec/versions";
import { coverage, libraryHeader, specLibrary, templateDetail } from "@/lib/spec/library";
import { resolveTemplateId } from "@/lib/spec/resolve";
import { readOwnFields, type FieldMappings } from "@/lib/catalogue/overlay";
import type { DraftField } from "@/lib/spec/changes";
import { categoryHealth, editCategory, thresholdsFor } from "@/lib/taxonomy/service";
import { PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";

/**
 * Board 4e, against a real database.
 *
 * The criteria this file exists for, in the handoff's own numbering:
 *
 *   1. Publishing a version never marks an existing product as violating its
 *      template, never blocks a seller's save, and never changes a product's
 *      published state.
 *   2. Requiring a platform field is a separate action with its own review, and
 *      it flags and blocks-on-next-save. It never delists and carries no
 *      deadline.
 *   3. Removing a field leaves the field and its values on every clone as a
 *      seller-owned field, and drops its facet status only.
 *   5. A subcategory may hold several templates and a template may serve
 *      several subcategories.
 *   7. Coverage is a query — subcategories with no template.
 *   9. `filled` is computed over mapped platform fields only, across all
 *      clones, and a template with no clones is null rather than zero.
 *  11. `varies_by_variant` is authored here and inherited by every clone.
 *  12. Every count is a query. No constants.
 *
 * The one that used to be here — "the grace period works" — is gone, and its
 * absence is the point. `3h` §6 lands additive platform changes not required,
 * so there is nothing for a grace period to postpone; a deadline would imply a
 * day 61 whose only outcomes are the ones `3h` §5 and `6f` exist to prevent.
 */

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });

let opsLeadId: string;
let moderatorId: string;

beforeAll(async () => {
  opsLeadId = (
    await prisma.user.findFirstOrThrow({
      where: { roles: { has: "staff_ops_lead" } },
      // One of two seeded ops leads, and always the same one: board 6f
      // needs a second for dual control, and `findFirst` has no defined
      // order without this.
      orderBy: { id: "asc" as const },
      select: { id: true },
    })
  ).id;
  moderatorId = (
    await prisma.user.findFirstOrThrow({
      where: { roles: { has: "staff_moderator" } },
      select: { id: true },
    })
  ).id;
});

const ops = () => actor(opsLeadId, "staff_ops_lead");

let seq = 0;

/**
 * Everything the fixtures made, so it can be taken away again.
 *
 * This suite used to leave a top-level category behind on every run. A
 * top-level category is a **sector** — the unit the storefront template model
 * is organised around and the denominator of the store count every builder
 * screen shows before a save — so a suite that leaks one per run makes any
 * assertion about sectors flaky, in the same way the leaked listings made the
 * dedupe scan miss its own pair.
 */
const made: { categories: string[]; businesses: string[] } = { categories: [], businesses: [] };

afterAll(async () => {
  // Order matters. A category with a business or a product on it will not
  // delete — `onDelete: Restrict` on both, deliberately.
  await prisma.business.deleteMany({ where: { id: { in: made.businesses } } });
  await prisma.product.deleteMany({ where: { categoryId: { in: made.categories } } });
  await prisma.category.updateMany({
    where: { id: { in: made.categories } },
    data: { defaultTemplateId: null },
  });
  await prisma.specTemplate.deleteMany({
    where: { categories: { some: { categoryId: { in: made.categories } } } },
  });
  await prisma.category.deleteMany({ where: { id: { in: made.categories } } });
  // By slug too, so a crashed run does not leave a sector behind for the next.
  await prisma.category.deleteMany({ where: { slug: { startsWith: "test-trade-" } } });
  await prisma.$disconnect();
});

interface Fixture {
  templateId: string;
  categoryId: string;
  businessId: string;
  boreId: string;
  noteId: string;
  productIds: string[];
}

/**
 * A category of its own, with a live template and a catalogue.
 *
 * Built per test rather than shared: this suite publishes versions and requires
 * fields, and a shared fixture would carry one test's requirement into the
 * next. It runs against a database it does not reset.
 */
async function freshTemplate(options: { complete: number; incomplete: number }): Promise<Fixture> {
  seq += 1;
  const stamp = `${Date.now()}${String(seq).padStart(2, "0")}`;

  const category = await prisma.category.create({
    data: { name: `Test Trade ${stamp}`, slug: `test-trade-${stamp}`, code: "TT" },
    select: { id: true },
  });
  made.categories.push(category.id);

  const template = await prisma.specTemplate.create({
    data: {
      categories: { create: { categoryId: category.id } },
      name: `Test template ${stamp}`,
      version: 1,
      status: "live",
      fields: {
        create: [
          { key: "bore", label: "Bore", type: "select", required: false, isFilterable: true, sortOrder: 0 },
          { key: "note", label: "Note", type: "text", required: false, isFilterable: false, sortOrder: 1 },
        ],
      },
    },
    select: { id: true, fields: { select: { id: true, key: true } } },
  });

  await prisma.category.update({
    where: { id: category.id },
    data: { defaultTemplateId: template.id },
  });

  const boreId = template.fields.find((f) => f.key === "bore")!.id;
  const noteId = template.fields.find((f) => f.key === "note")!.id;

  /*
   * Its own business, not the first one that comes back.
   *
   * Borrowing an existing listing put test products into a real seller's
   * catalogue, and `enquiry-fanout.test.ts` counts products — so this suite
   * failed a different file, on a fresh database only, off by exactly the
   * number of fixtures built before it. A fixture that reaches into shared
   * data is a fixture that breaks somebody else's test at a distance.
   */
  const business = await prisma.business.create({
    data: {
      tradeName: `Spec Fixture LLC ${stamp}`,
      displayName: `Spec Fixture ${stamp}`,
      slug: `spec-fixture-${stamp}`,
      licenceNumber: `DED-SF-${stamp.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 200 * 86_400_000),
      primaryCategoryId: category.id,
      claimStatus: "unclaimed",
      // Never published: it must not reach a search result, a sitemap, or a
      // category listing count.
      publishedAt: null,
    },
    select: { id: true },
  });
  made.businesses.push(business.id);

  const productIds: string[] = [];
  for (let i = 0; i < options.complete + options.incomplete; i += 1) {
    const product = await prisma.product.create({
      data: {
        businessId: business.id,
        categoryId: category.id,
        name: `Test product ${stamp}-${i}`,
        slug: `test-product-${stamp}-${i}`,
        status: "live",
        availability: "in_stock",
        specValues: i < options.complete ? { [boreId]: "DN100" } : {},
        searchText: `test product ${stamp}`,
      },
      select: { id: true },
    });
    productIds.push(product.id);
  }

  return { templateId: template.id, categoryId: category.id, businessId: business.id, boreId, noteId, productIds };
}

/** A seller copy of a fixture's template, with whatever overlay the test needs. */
async function clone(fixture: Fixture, mappings: FieldMappings = {}) {
  seq += 1;
  return prisma.sellerTemplate.create({
    data: {
      businessId: fixture.businessId,
      platformTemplateId: fixture.templateId,
      name: "Seller copy",
      slug: `seller-copy-${Date.now()}${seq}`,
      fieldMappings: mappings as object,
    },
    select: { id: true },
  });
}

const newField = (over: Partial<DraftField> = {}): DraftField => ({
  key: `wall_thickness_${Date.now()}`,
  label: "Wall thickness",
  type: "number",
  unit: "mm",
  options: [],
  isFilterable: true,
  variesByVariant: false,
  ...over,
});

const REASON =
  "Buyers keep asking for wall thickness on pipe enquiries and cannot filter for it.";

/* ── Criterion 1 ─────────────────────────────────────────────────────────── */

describe("publishing a version", () => {
  it("adds the field not required, so no product is left in violation", async () => {
    const fixture = await freshTemplate({ complete: 2, incomplete: 3 });
    const before = await prisma.product.findMany({
      where: { id: { in: fixture.productIds } },
      orderBy: { slug: "asc" },
      select: { id: true, status: true, specValues: true },
    });

    await stageAddField(ops(), fixture.templateId, newField({ key: "wall_thk" }));
    const result = await publishDraft({ actor: ops(), templateId: fixture.templateId, reason: REASON });
    expect(result.ok).toBe(true);

    const added = await prisma.specField.findFirstOrThrow({
      where: { templateId: fixture.templateId, key: "wall_thk" },
      select: { required: true, requiredFrom: true, isFilterable: true },
    });
    // Not required, and no deadline. Both halves of criterion 1 and 4.
    expect(added.required).toBe(false);
    expect(added.requiredFrom).toBeNull();
    expect(added.isFilterable).toBe(true);

    const after = await prisma.product.findMany({
      where: { id: { in: fixture.productIds } },
      orderBy: { slug: "asc" },
      select: { id: true, status: true, specValues: true },
    });
    // Nothing about the products changed — not their state, not their values.
    expect(after).toEqual(before);
  });

  it("bumps the version in place, so no field id moves", async () => {
    const fixture = await freshTemplate({ complete: 1, incomplete: 0 });
    await stageAddField(ops(), fixture.templateId, newField({ key: "cv" }));
    await publishDraft({ actor: ops(), templateId: fixture.templateId, reason: REASON });

    const template = await prisma.specTemplate.findUniqueOrThrow({
      where: { id: fixture.templateId },
      select: { version: true, fields: { select: { id: true, key: true } } },
    });
    expect(template.version).toBe(2);
    // The carried-forward field kept its id. A clone would have given it a new
    // one and emptied every catalogue in the category.
    expect(template.fields.find((f) => f.key === "bore")?.id).toBe(fixture.boreId);
  });

  it("clears the draft, so the card is absent rather than empty", async () => {
    const fixture = await freshTemplate({ complete: 1, incomplete: 0 });
    await stageAddField(ops(), fixture.templateId, newField({ key: "dn" }));
    await publishDraft({ actor: ops(), templateId: fixture.templateId, reason: REASON });

    const row = await prisma.specTemplate.findUniqueOrThrow({
      where: { id: fixture.templateId },
      select: { draftChanges: true },
    });
    expect(row.draftChanges).toBeNull();
  });

  it("refuses to publish nothing", async () => {
    const fixture = await freshTemplate({ complete: 1, incomplete: 0 });
    const result = await publishDraft({ actor: ops(), templateId: fixture.templateId, reason: REASON });
    expect(result).toMatchObject({ ok: false, error: "empty_draft" });
  });

  it("writes an audit row naming what changed and why", async () => {
    const fixture = await freshTemplate({ complete: 1, incomplete: 0 });
    await stageAddField(ops(), fixture.templateId, newField({ key: "torque" }));
    await publishDraft({ actor: ops(), templateId: fixture.templateId, reason: REASON });

    const event = await prisma.auditEvent.findFirst({
      where: { subject: `SpecTemplate:${fixture.templateId}` },
      orderBy: { createdAt: "desc" },
      select: { reason: true, actorId: true },
    });
    expect(event?.reason).toBe(REASON);
    expect(event?.actorId).toBe(opsLeadId);
  });

  it("refuses a moderator", async () => {
    const fixture = await freshTemplate({ complete: 1, incomplete: 0 });
    await expect(
      stageAddField(actor(moderatorId, "staff_moderator"), fixture.templateId, newField()),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("discards a draft without touching the live version", async () => {
    const fixture = await freshTemplate({ complete: 1, incomplete: 0 });
    await stageAddField(ops(), fixture.templateId, newField({ key: "flange" }));
    await discardDraft(ops(), fixture.templateId);

    const template = await prisma.specTemplate.findUniqueOrThrow({
      where: { id: fixture.templateId },
      select: { version: true, draftChanges: true, _count: { select: { fields: true } } },
    });
    expect(template.version).toBe(1);
    expect(template.draftChanges).toBeNull();
    expect(template._count.fields).toBe(2);
  });
});

/* ── Criterion 11 ────────────────────────────────────────────────────────── */

describe("varies_by_variant", () => {
  it("is authored here, so board 3g has a flag to read", async () => {
    const fixture = await freshTemplate({ complete: 1, incomplete: 0 });
    await stageAddField(ops(), fixture.templateId, newField({ key: "size", variesByVariant: true }));
    await publishDraft({ actor: ops(), templateId: fixture.templateId, reason: REASON });

    const field = await prisma.specField.findFirstOrThrow({
      where: { templateId: fixture.templateId, key: "size" },
      select: { variesByVariant: true },
    });
    expect(field.variesByVariant).toBe(true);
  });

  it("can be turned on for a field that already exists", async () => {
    const fixture = await freshTemplate({ complete: 1, incomplete: 0 });
    await stageChange(ops(), fixture.templateId, (draft) => ({
      ...draft,
      edited: { [fixture.boreId]: { variesByVariant: true } },
    }));
    await publishDraft({ actor: ops(), templateId: fixture.templateId, reason: REASON });

    const field = await prisma.specField.findUniqueOrThrow({
      where: { id: fixture.boreId },
      select: { variesByVariant: true },
    });
    expect(field.variesByVariant).toBe(true);
  });
});

/* ── Criterion 2 ─────────────────────────────────────────────────────────── */

describe("requiring a platform field", () => {
  it("is a separate action from publishing, with its own review", async () => {
    const fixture = await freshTemplate({ complete: 2, incomplete: 3 });
    const review = await reviewRequireField(fixture.boreId);

    // Three products have no bore. The review names them before anything is
    // written, which is what makes the decision reviewable at all.
    expect(review?.affected).toBe(3);
    expect(review?.sellers).toBe(1);
    expect(review?.detached).toBe(0);
  });

  it("flags and blocks the next save, and delists nothing", async () => {
    const fixture = await freshTemplate({ complete: 2, incomplete: 3 });
    const before = await prisma.product.findMany({
      where: { id: { in: fixture.productIds } },
      select: { status: true },
    });

    const result = await setFieldRequired({
      actor: ops(),
      fieldId: fixture.boreId,
      required: true,
      reason: "Buyers cannot compare valves without a bore.",
    });
    expect(result.ok).toBe(true);

    const field = await prisma.specField.findUniqueOrThrow({
      where: { id: fixture.boreId },
      select: { required: true, requiredFrom: true },
    });
    expect(field.required).toBe(true);
    // No deadline. There is no day 61 for anything to happen on.
    expect(field.requiredFrom).toBeNull();

    const after = await prisma.product.findMany({
      where: { id: { in: fixture.productIds } },
      select: { status: true },
    });
    expect(after).toEqual(before);
  });

  it("names the clones that have detached the field separately", async () => {
    const fixture = await freshTemplate({ complete: 1, incomplete: 1 });
    await clone(fixture, { [fixture.boreId]: { detached: true } });

    const review = await reviewRequireField(fixture.boreId);
    // They cannot be held to a mapping they no longer have, so the count is
    // stated rather than the edit being blocked — the handoff's Q3.
    expect(review?.detached).toBe(1);
  });

  it("refuses to require a field that is already required", async () => {
    const fixture = await freshTemplate({ complete: 1, incomplete: 0 });
    await setFieldRequired({ actor: ops(), fieldId: fixture.boreId, required: true, reason: REASON });
    const again = await setFieldRequired({
      actor: ops(),
      fieldId: fixture.boreId,
      required: true,
      reason: REASON,
    });
    expect(again).toMatchObject({ ok: false, error: "already" });
  });

  it("refuses a moderator", async () => {
    const fixture = await freshTemplate({ complete: 1, incomplete: 0 });
    await expect(
      setFieldRequired({
        actor: actor(moderatorId, "staff_moderator"),
        fieldId: fixture.boreId,
        required: true,
        reason: REASON,
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  });
});

/* ── Criterion 3 ─────────────────────────────────────────────────────────── */

describe("removing a field from a library template", () => {
  it("leaves the field and its values on every clone, as the seller's own", async () => {
    const fixture = await freshTemplate({ complete: 3, incomplete: 0 });
    await clone(fixture, { [fixture.boreId]: { label: "Nominal bore" } });

    await stageChange(ops(), fixture.templateId, (draft) => ({
      ...draft,
      removed: [fixture.boreId],
    }));
    const result = await publishDraft({
      actor: ops(),
      templateId: fixture.templateId,
      reason: "Bore duplicates nominal diameter and buyers filter on the wrong one.",
    });
    expect(result.ok).toBe(true);

    // Gone from the platform set.
    expect(await prisma.specField.findUnique({ where: { id: fixture.boreId } })).toBeNull();

    const copy = await prisma.sellerTemplate.findFirstOrThrow({
      where: { platformTemplateId: fixture.templateId },
      select: { ownFields: true, fieldMappings: true },
    });
    const own = readOwnFields(copy.ownFields);
    const carried = own.find((field) => field.id === fixture.boreId);

    // The same id, so `Product.specValues` keeps resolving and no data moved.
    expect(carried).toBeTruthy();
    // The seller's own label, not the platform's — a removal must not silently
    // rename their field back.
    expect(carried?.label).toBe("Nominal bore");
    // And it is out of the mapping, which is what drops its facet status.
    expect(Object.keys(copy.fieldMappings as object)).not.toContain(fixture.boreId);

    const products = await prisma.product.findMany({
      where: { id: { in: fixture.productIds } },
      select: { specValues: true },
    });
    for (const product of products) {
      expect((product.specValues as Record<string, unknown>)[fixture.boreId]).toBe("DN100");
    }
  });
});

/* ── Criteria 5, 7, 9, 12 ────────────────────────────────────────────────── */

describe("the library, as the screen reads it", () => {
  it("lets a template serve several subcategories and a subcategory hold several", async () => {
    const a = await freshTemplate({ complete: 1, incomplete: 0 });
    const b = await freshTemplate({ complete: 1, incomplete: 0 });

    // One template, two subcategories.
    await prisma.specTemplateCategory.create({
      data: { templateId: a.templateId, categoryId: b.categoryId },
    });
    // One subcategory, two templates.
    const second = await createTemplate({
      actor: ops(),
      name: "Second sheet",
      categoryId: a.categoryId,
      reason: "Grooved fittings share almost no fields with threaded ones.",
    });
    expect(second.ok).toBe(true);

    const rows = await specLibrary();
    const first = rows.find((row) => row.id === a.templateId);
    expect(first?.subcategories.map((c) => c.id).sort()).toEqual([a.categoryId, b.categoryId].sort());

    const onA = rows.filter((row) => row.subcategories.some((c) => c.id === a.categoryId));
    expect(onA.length).toBe(2);
  });

  it("keeps 4d's default as a default, not an exclusive assignment", async () => {
    const fixture = await freshTemplate({ complete: 1, incomplete: 0 });
    const second = await createTemplate({
      actor: ops(),
      name: "Alternative sheet",
      categoryId: fixture.categoryId,
      reason: "A second opinion about how this trade is described.",
    });
    expect(second.ok).toBe(true);

    // Two templates serve it; the default is still the first, and that is what
    // every product-side reader resolves to.
    expect(await resolveTemplateId(prisma, fixture.categoryId)).toBe(fixture.templateId);
  });

  it("reads filled as null for a template no seller has cloned", async () => {
    const fixture = await freshTemplate({ complete: 2, incomplete: 2 });
    const row = (await specLibrary()).find((entry) => entry.id === fixture.templateId);
    // Not 0%. Zero of zero is not a fill rate.
    expect(row?.filled).toBeNull();
    expect(row?.clones).toBe(0);
  });

  it("measures filled over mapped platform fields only", async () => {
    const fixture = await freshTemplate({ complete: 2, incomplete: 2 });
    await clone(fixture);

    // Four products, two platform fields each: eight slots, two filled.
    const row = (await specLibrary()).find((entry) => entry.id === fixture.templateId);
    expect(row?.filled).toBeCloseTo(2 / 8, 5);

    // Detaching `note` takes it out of both halves: four slots, two filled.
    await prisma.sellerTemplate.updateMany({
      where: { platformTemplateId: fixture.templateId },
      data: { fieldMappings: { [fixture.noteId]: { detached: true } } },
    });
    const after = (await specLibrary()).find((entry) => entry.id === fixture.templateId);
    expect(after?.filled).toBeCloseTo(2 / 4, 5);
  });

  it("counts coverage as a query, and the header agrees with it", async () => {
    const fixture = await freshTemplate({ complete: 1, incomplete: 0 });
    const [cover, header] = await Promise.all([coverage(), libraryHeader()]);

    expect(header.total).toBe(cover.total);
    expect(header.covered).toBe(cover.covered);
    expect(cover.covered + cover.gaps.length).toBe(cover.total);
    // A subcategory that has a template is not a gap.
    expect(cover.gaps.some((gap) => gap.id === fixture.categoryId)).toBe(false);
  });

  it("ranks coverage gaps by products already listed", async () => {
    const { gaps } = await coverage();
    for (let i = 1; i < gaps.length; i += 1) {
      expect(gaps[i - 1]!.products).toBeGreaterThanOrEqual(gaps[i]!.products);
    }
  });

  it("gives every template row a detail page with its fields", async () => {
    const fixture = await freshTemplate({ complete: 2, incomplete: 1 });
    const detail = await templateDetail(fixture.templateId);

    expect(detail?.fields.map((field) => field.key)).toEqual(["bore", "note"]);
    // One product has no bore, three have no note.
    expect(detail?.fields.find((field) => field.key === "bore")?.missing).toBe(1);
    expect(detail?.fields.find((field) => field.key === "note")?.missing).toBe(3);
    expect(detail?.blast.products).toBe(3);
  });
});

/* ── The resolver the many-to-many made necessary ────────────────────────── */

describe("resolving which template a category answers to", () => {
  it("falls back to a template serving the category when no default is set", async () => {
    const fixture = await freshTemplate({ complete: 1, incomplete: 0 });
    await prisma.category.update({
      where: { id: fixture.categoryId },
      data: { defaultTemplateId: null },
    });

    /*
       The seeded pump catalogue's exact state before board 4e: a template
       against the category and no default, where the facet rail resolved it
       and `templateForCategory` did not.
    */
    expect(await resolveTemplateId(prisma, fixture.categoryId)).toBe(fixture.templateId);

    await prisma.category.update({
      where: { id: fixture.categoryId },
      data: { defaultTemplateId: fixture.templateId },
    });
  });

  it("hops to the parent, because templates belong to the trade", async () => {
    const fixture = await freshTemplate({ complete: 1, incomplete: 0 });
    const child = await prisma.category.create({
      data: {
        name: "Test niche",
        slug: `test-trade-niche-${Date.now()}`,
        code: "TN",
        parentId: fixture.categoryId,
      },
      select: { id: true },
    });
    made.categories.push(child.id);

    expect(await resolveTemplateId(prisma, child.id)).toBe(fixture.templateId);
  });
});


describe("the publish floor, per category", () => {
  it("judges each category against its own thresholds, not the defaults", async () => {
    const health = await categoryHealth();
    expect(health.length).toBeGreaterThan(0);

    for (const category of health) {
      expect(category.publishThreshold).toBeGreaterThan(0);
      // The decision uses this category's floor.
      const own = thresholdsFor(category);
      expect(own.minListings).toBe(category.publishThreshold);
      expect(own.minVerifiedShare).toBe(category.verifiedShareMin);
    }
  });

  it("blocks a category below the listing floor and names which half failed", async () => {
    const health = await categoryHealth();
    const thin = health.find((c) => c.listings < c.publishThreshold);
    expect(thin, "the seed has 40 businesses, so something is below 60").toBeTruthy();
    if (!thin) return;

    expect(thin.decision.publishable).toBe(false);
    expect(thin.decision.failures.map((f) => f.reason)).toContain("listings");
  });

  /*
     The threshold cases moved to tests/integration/publish-rules.test.ts.

     Board 6f took `publishThreshold` and `verifiedShareMin` off
     `editCategory`: every rule that decides whether a page exists now goes
     through an impact preview and a second approver, and a single-approver
     path to the same two columns would have made that approver a formality.
     The behaviour these covered is still covered, in the file that owns it.
  */

  it("refuses a moderator", async () => {
    const health = await categoryHealth();
    await expect(
      editCategory({
        actor: actor(moderatorId, "staff_moderator"),
        categoryId: health[0]!.id,
        name: "Not mine to change",
        reason: "Not mine to change.",
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("saves synonyms trimmed and de-duplicated, Arabic included", async () => {
    const health = await categoryHealth();
    const target = health.find((c) => c.slug === "valves-and-fittings") ?? health[0]!;

    await editCategory({
      actor: actor(opsLeadId, "staff_ops_lead"),
      categoryId: target.id,
      synonyms: ["  صمامات ", "valve", "valve", "gate valve"],
      reason: "Buyers search in Arabic and the results were empty.",
    });

    const after = await prisma.category.findUniqueOrThrow({
      where: { id: target.id },
      select: { synonyms: true },
    });
    expect(after.synonyms).toEqual(["صمامات", "valve", "gate valve"]);

    await editCategory({
      actor: actor(opsLeadId, "staff_ops_lead"),
      categoryId: target.id,
      synonyms: target.synonyms,
      reason: "Restoring the seeded synonym list after the test.",
    });
  });
});

describe("seller-proposed fields", () => {
  it("normalises a label so two spellings are one proposal", () => {
    expect(proposalKey("Wall Thk.")).toBe("wall_thk");
    expect(proposalKey("  wall  thk  ")).toBe("wall_thk");
    expect(proposalKey("Wall-Thk")).toBe("wall_thk");
  });
});
