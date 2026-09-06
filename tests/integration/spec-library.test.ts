import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  affectedByNewField,
  publishVersionWithField,
  templateLibrary,
  proposalKey,
  type NewField,
} from "@/lib/spec/versions";
import { categoryHealth, editCategory, thresholdsFor } from "@/lib/taxonomy/service";
import { specCompleteness, type SpecFieldRule } from "@/lib/metrics/spec-completeness";
import { PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";

/**
 * Criterion 4, against a real database:
 *
 *   "Publishing a spec-template version with a new required field does not
 *    invalidate existing products — the grace period works and the affected
 *    count is accurate."
 *
 * Both halves, and the second decides whether the first gets used: staff who
 * cannot see that a change breaks 1,842 products will publish it.
 *
 * Plus criterion 6's first half — the per-category publish floor, which has had
 * columns since handoff 0 and no reader at all.
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
  await prisma.specTemplate.deleteMany({ where: { categoryId: { in: made.categories } } });
  await prisma.category.deleteMany({ where: { id: { in: made.categories } } });
  // By slug too, so a crashed run does not leave a sector behind for the next.
  await prisma.category.deleteMany({ where: { slug: { startsWith: "test-trade-" } } });
  await prisma.$disconnect();
});

/**
 * A category of its own, with a live template and a catalogue.
 *
 * Built per test rather than shared. `publishVersionWithField` retires the
 * template it supersedes and repoints the category, and a required field with
 * no grace period permanently breaks every product under it — so a suite that
 * used the seeded valves template poisoned its own fixture on the first run and
 * every assertion about affected counts read zero on the second. This suite
 * runs against a database it does not reset.
 */
async function freshTemplate(options: { complete: number; incomplete: number }) {
  seq += 1;
  const stamp = `${Date.now()}${String(seq).padStart(2, "0")}`;

  const template = await prisma.specTemplate.create({
    data: {
      category: {
        create: {
          name: `Test Trade ${stamp}`,
          slug: `test-trade-${stamp}`,
          code: "TT",
        },
      },
      name: `Test template ${stamp}`,
      version: 1,
      status: "live",
      fields: {
        create: [
          { key: "bore", label: "Bore", type: "select", required: true, isFilterable: true, sortOrder: 0 },
          { key: "note", label: "Note", type: "text", required: false, isFilterable: false, sortOrder: 1 },
        ],
      },
    },
    select: {
      id: true,
      categoryId: true,
      version: true,
      name: true,
      fields: { select: { id: true, key: true } },
    },
  });

  await prisma.category.update({
    where: { id: template.categoryId },
    data: { defaultTemplateId: template.id },
  });

  made.categories.push(template.categoryId);

  const boreId = template.fields.find((f) => f.key === "bore")!.id;

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
      primaryCategoryId: template.categoryId,
      claimStatus: "unclaimed",
      // Never published: it must not reach a search result, a sitemap, or a
      // category listing count.
      publishedAt: null,
    },
    select: { id: true },
  });
  made.businesses.push(business.id);

  for (let i = 0; i < options.complete + options.incomplete; i += 1) {
    await prisma.product.create({
      data: {
        businessId: business.id,
        categoryId: template.categoryId,
        name: `Test product ${stamp}-${i}`,
        slug: `test-product-${stamp}-${i}`,
        status: "live",
        availability: "in_stock",
        specValues: i < options.complete ? { [boreId]: "DN100" } : {},
        searchText: `test product ${stamp}`,
      },
    });
  }

  return template;
}

const field = (over: Partial<NewField> = {}): NewField => ({
  key: `wall_thickness_${Date.now()}`,
  label: "Wall thickness",
  type: "number",
  unit: "mm",
  required: true,
  isFilterable: true,
  ...over,
});

const REASON =
  "Buyers keep asking for wall thickness on pipe enquiries and cannot filter for it.";

describe("the affected count, before anything is published", () => {
  it("counts the products a new required field would make incomplete", async () => {
    const template = await freshTemplate({ complete: 5, incomplete: 2 });
    const { affectedNow, total } = await affectedByNewField(template.id, field());

    expect(total).toBe(7);
    // The five complete ones. The two already incomplete are not counted: a
    // new field does not make them more incomplete, and counting them would
    // overstate what the change costs.
    expect(affectedNow).toBe(5);
  });

  it("counts nothing for a field that is not required", async () => {
    const template = await freshTemplate({ complete: 3, incomplete: 0 });
    const { affectedNow } = await affectedByNewField(
      template.id,
      field({ required: false }),
    );
    expect(affectedNow).toBe(0);
  });

  it("counts nothing for a field buyers cannot filter on", async () => {
    // A required free-text note is worth having and is not what this measures.
    const template = await freshTemplate({ complete: 3, incomplete: 0 });
    const { affectedNow } = await affectedByNewField(
      template.id,
      field({ isFilterable: false }),
    );
    expect(affectedNow).toBe(0);
  });

  it("agrees with what completeness says afterwards", async () => {
    const template = await freshTemplate({ complete: 4, incomplete: 1 });
    const added = field({ key: `agreement_${Date.now()}` });

    const before = await affectedByNewField(template.id, added);
    const published = await publishVersionWithField({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId: template.id,
      field: added,
      requiredFrom: null,
      reason: REASON,
    });
    expect(published.ok).toBe(true);
    if (!published.ok) return;

    // The count the screen showed is the count the audit row recorded.
    expect(published.affected).toBe(before.affectedNow);

    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { action: "taxonomy_changed", subject: `SpecTemplate:${template.id}` },
      orderBy: { createdAt: "desc" },
      select: { after: true },
    });
    expect((audit.after as { productsAffected: number }).productsAffected).toBe(
      before.affectedNow,
    );
  });
});

describe("the grace period", () => {
  it("leaves existing products complete until the deadline", async () => {
    // Complete under the current version, so the only thing that can make it
    // incomplete is the field being added.
    const template = await freshTemplate({ complete: 1, incomplete: 0 });
    const completeNow = await prisma.product.findFirstOrThrow({
      where: { category: { defaultTemplateId: template.id } },
      select: { specValues: true },
    });

    const added = field({ key: `graced_${Date.now()}` });
    const deadline = new Date(Date.now() + 30 * 86_400_000);

    const published = await publishVersionWithField({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId: template.id,
      field: added,
      requiredFrom: deadline,
      reason: REASON,
    });
    expect(published.ok).toBe(true);
    if (!published.ok) return;

    const fields = await prisma.specField.findMany({
      where: { templateId: published.templateId },
      select: { id: true, key: true, required: true, isFilterable: true, requiredFrom: true },
    });
    const rules = new Map<string, SpecFieldRule[]>([[published.templateId, fields]]);

    const product = {
      templateId: published.templateId,
      values: completeNow.specValues as Record<string, unknown> | null,
    };

    // Inside the grace period the catalogue is unchanged...
    const during = specCompleteness([product], rules, new Date());
    // ...and after it, the new field bites.
    const after = specCompleteness([product], rules, new Date(deadline.getTime() + 86_400_000));

    expect(during).toBe(1);
    expect(after).toBe(0);
  });

  it("refuses a deadline in the past", async () => {
    const template = await freshTemplate({ complete: 1, incomplete: 0 });
    const result = await publishVersionWithField({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId: template.id,
      field: field({ key: `past_${Date.now()}` }),
      requiredFrom: new Date(Date.now() - 86_400_000),
      reason: REASON,
    });
    expect(result).toMatchObject({ ok: false, error: "grace_in_past" });
  });

  it("refuses a grace period on a field that is not required", async () => {
    // The database refuses it too — a deadline for something optional is not a
    // deadline. The service simply never writes one.
    const template = await freshTemplate({ complete: 1, incomplete: 0 });
    const published = await publishVersionWithField({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId: template.id,
      field: field({ key: `optional_${Date.now()}`, required: false }),
      requiredFrom: new Date(Date.now() + 30 * 86_400_000),
      reason: REASON,
    });
    expect(published.ok).toBe(true);
    if (!published.ok) return;

    const added = await prisma.specField.findFirstOrThrow({
      where: { templateId: published.templateId, required: false },
      orderBy: { sortOrder: "desc" },
      select: { requiredFrom: true },
    });
    expect(added.requiredFrom).toBeNull();
  });
});

describe("publishing a version", () => {
  it("bumps the version in place, so no field id moves", async () => {
    /*
     * The correction an earlier version of this test forced. `specValues` is
     * keyed by `SpecField.id`, so cloning fields onto a new template row would
     * orphan every product's specs the moment somebody published a version.
     */
    const template = await freshTemplate({ complete: 1, incomplete: 0 });
    const idsBefore = (
      await prisma.specField.findMany({
        where: { templateId: template.id },
        select: { id: true },
        orderBy: { sortOrder: "asc" },
      })
    ).map((f) => f.id);

    const published = await publishVersionWithField({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId: template.id,
      field: field({ key: `supersede_${Date.now()}` }),
      requiredFrom: null,
      reason: REASON,
    });
    expect(published.ok).toBe(true);
    if (!published.ok) return;

    expect(published.templateId).toBe(template.id);
    expect(published.version).toBe(template.version + 1);

    const idsAfter = (
      await prisma.specField.findMany({
        where: { templateId: template.id },
        select: { id: true },
        orderBy: { sortOrder: "asc" },
      })
    ).map((f) => f.id);
    // Every id that existed still exists, in place. One is added.
    expect(idsAfter.slice(0, idsBefore.length)).toEqual(idsBefore);
    expect(idsAfter).toHaveLength(idsBefore.length + 1);

    // And the category never had to be repointed.
    const category = await prisma.category.findUniqueOrThrow({
      where: { id: template.categoryId },
      select: { defaultTemplateId: true },
    });
    expect(category.defaultTemplateId).toBe(template.id);
  });

  it("carries every field of the old version forward", async () => {
    const template = await freshTemplate({ complete: 1, incomplete: 0 });
    const beforeCount = await prisma.specField.count({ where: { templateId: template.id } });

    const published = await publishVersionWithField({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId: template.id,
      field: field({ key: `carried_${Date.now()}` }),
      requiredFrom: null,
      reason: REASON,
    });
    if (!published.ok) throw new Error("publish failed");

    const afterCount = await prisma.specField.count({
      where: { templateId: published.templateId },
    });
    expect(afterCount).toBe(beforeCount + 1);
  });

  it("refuses to add to a retired template", async () => {
    const template = await freshTemplate({ complete: 1, incomplete: 0 });
    await prisma.specTemplate.update({
      where: { id: template.id },
      data: { status: "retired" },
    });
    const retired = template;

    const result = await publishVersionWithField({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId: retired.id,
      field: field({ key: `retired_${Date.now()}` }),
      requiredFrom: null,
      reason: REASON,
    });
    expect(result).toMatchObject({ ok: false, error: "not_live" });
  });

  it("refuses a moderator — taxonomy.write is ops lead alone", async () => {
    const template = await freshTemplate({ complete: 1, incomplete: 0 });
    await expect(
      publishVersionWithField({
        actor: actor(moderatorId, "staff_moderator"),
        templateId: template.id,
        field: field({ key: `refused_${Date.now()}` }),
        requiredFrom: null,
        reason: REASON,
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("shows the library with its live version and its clones", async () => {
    const library = await templateLibrary();
    expect(library.length).toBeGreaterThan(0);
    const live = library.filter((t) => t.status === "live");
    expect(live.length).toBeGreaterThan(0);
    for (const template of live) {
      expect(template.fields).toBeGreaterThan(0);
      expect(template.categoryName).toBeTruthy();
    }
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
