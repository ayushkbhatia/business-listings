import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  cloneTemplate,
  getSellerTemplate,
  renameWarning,
  saveTemplateEdits,
} from "@/lib/catalogue/template";
import type { Actor } from "@/lib/auth/roles";

/**
 * Handoff 3 criterion 6, against a real database.
 *
 *   "Cloning a spec template preserves the mapping to platform fields; renaming
 *    a cloned field warns before saving and keeps the mapping."
 *
 * The mapping is what lets a buyer compare one supplier's "Body material" with
 * another's "Material of construction". If a rename can drop it, cross-seller
 * comparison quietly stops working and nothing fails visibly.
 */

const SLUG = "al-marwan-industrial-supplies-llc";

let actor: Actor;
let businessId: string;
let platformTemplateId: string;
const createdTemplateIds: string[] = [];

beforeAll(async () => {
  const business = await prisma.business.findUniqueOrThrow({
    where: { slug: SLUG },
    select: {
      id: true,
      primaryCategoryId: true,
      team: { where: { roles: { has: "seller_owner" } }, select: { id: true, roles: true }, take: 1 },
    },
  });
  businessId = business.id;
  const owner = business.team[0]!;
  actor = { id: owner.id, roles: owner.roles, businessId: business.id };

  const template = await prisma.specTemplate.findFirstOrThrow({
    where: { fields: { some: { isFilterable: true } } },
    select: { id: true },
  });
  platformTemplateId = template.id;

  await prisma.sellerTemplate.deleteMany({ where: { businessId, platformTemplateId } });
});

afterAll(async () => {
  for (const id of createdTemplateIds.splice(0)) {
    await prisma.sellerTemplate.deleteMany({ where: { id } });
  }
  await prisma.$disconnect();
});

describe("criterion 6 — cloning preserves the mapping", () => {
  it("clones every field of the platform template", async () => {
    const clone = await cloneTemplate(actor, businessId, platformTemplateId);
    createdTemplateIds.push(clone.id);

    const platform = await prisma.specField.findMany({
      where: { templateId: platformTemplateId },
      select: { id: true },
    });
    expect(clone.fields).toHaveLength(platform.length);

    // Every field carries the platform id it maps to. That id is also the key
    // Product.specValues uses, so the mapping is the storage rather than a
    // second thing that has to be kept in step with it.
    const ids = new Set(clone.fields.map((f) => f.platformFieldId));
    for (const field of platform) expect(ids.has(field.id)).toBe(true);
  });

  it("is idempotent — a second clone is the same template", async () => {
    // Two sets of labels for the same fields and nothing able to say which is
    // current is worse than refusing.
    const first = await cloneTemplate(actor, businessId, platformTemplateId);
    const second = await cloneTemplate(actor, businessId, platformTemplateId);
    expect(second.id).toBe(first.id);
    expect(await prisma.sellerTemplate.count({ where: { businessId, platformTemplateId } })).toBe(1);
  });

  it("stores no labels at clone time, so an admin rename still reaches the seller", async () => {
    // A clone that copies labels is a snapshot: rename a platform field later
    // and every seller who cloned before it keeps the old wording forever.
    const clone = await cloneTemplate(actor, businessId, platformTemplateId);
    const row = await prisma.sellerTemplate.findUniqueOrThrow({
      where: { id: clone.id },
      select: { fieldMappings: true },
    });
    expect(row.fieldMappings).toEqual({});
    // And the seller still sees the platform's labels.
    const platform = await prisma.specField.findFirstOrThrow({
      where: { templateId: platformTemplateId },
      orderBy: { sortOrder: "asc" },
      select: { label: true },
    });
    expect(clone.fields[0]?.label).toBe(platform.label);
  });

  it("marks the fields that drive a filter", async () => {
    // The FILTER marker is what turns data entry into "this is why you get found".
    const clone = await cloneTemplate(actor, businessId, platformTemplateId);
    expect(clone.fields.some((f) => f.isFilterable)).toBe(true);
  });
});

describe("criterion 6 — a rename keeps the mapping", () => {
  it("keeps the platform field id when the label changes", async () => {
    const clone = await cloneTemplate(actor, businessId, platformTemplateId);
    const target = clone.fields.find((f) => f.isFilterable)!;

    const result = await saveTemplateEdits(actor, businessId, clone.id, [
      { platformFieldId: target.platformFieldId, label: "Material of construction" },
    ]);
    expect(result).toEqual({
      ok: true,
      renamed: [{ from: target.platformLabel, to: "Material of construction" }],
    });

    const after = await getSellerTemplate(businessId, clone.id);
    const renamed = after!.fields.find((f) => f.platformFieldId === target.platformFieldId)!;

    expect(renamed.label).toBe("Material of construction");
    // The mapping. Renaming physically cannot drop it, because the label is a
    // value and the platform field id is the key it hangs off.
    expect(renamed.platformFieldId).toBe(target.platformFieldId);
    expect(renamed.platformLabel).toBe(target.platformLabel);
    expect(renamed.isFilterable).toBe(target.isFilterable);
  });

  it("leaves products already filled in against that field untouched", async () => {
    // The fear a seller has when renaming is that entered values are lost.
    const clone = await cloneTemplate(actor, businessId, platformTemplateId);
    const target = clone.fields.find((f) => f.isFilterable)!;

    const before = await prisma.product.findFirst({
      where: { businessId, NOT: { specValues: { equals: {} } } },
      select: { id: true, specValues: true },
    });

    await saveTemplateEdits(actor, businessId, clone.id, [
      { platformFieldId: target.platformFieldId, label: "Renamed again" },
    ]);

    if (before) {
      const after = await prisma.product.findUniqueOrThrow({
        where: { id: before.id },
        select: { specValues: true },
      });
      expect(after.specValues).toEqual(before.specValues);
    }
  });

  it("warns in words that say what is kept", async () => {
    const warning = renameWarning("Body material", "Material of construction", 42);
    expect(warning).toContain("42 products already using it keep their values");
    expect(warning).toContain("still find you");
    expect(warning).toContain("Body material");
  });

  it("reverts to the platform label when the seller types it back", async () => {
    const clone = await cloneTemplate(actor, businessId, platformTemplateId);
    const target = clone.fields.find((f) => f.isFilterable)!;

    await saveTemplateEdits(actor, businessId, clone.id, [
      { platformFieldId: target.platformFieldId, label: target.platformLabel },
    ]);

    const row = await prisma.sellerTemplate.findUniqueOrThrow({
      where: { id: clone.id },
      select: { fieldMappings: true },
    });
    // No override stored at all, so the field follows a later admin rename
    // rather than being frozen at whatever it said today.
    expect((row.fieldMappings as Record<string, unknown>)[target.platformFieldId]).toBeUndefined();
  });

  it("refuses an empty label rather than saving a nameless field", async () => {
    const clone = await cloneTemplate(actor, businessId, platformTemplateId);
    const target = clone.fields[0]!;
    const result = await saveTemplateEdits(actor, businessId, clone.id, [
      { platformFieldId: target.platformFieldId, label: "   " },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("hide it instead");
  });

  it("refuses an edit naming a field that is not on the template", async () => {
    const clone = await cloneTemplate(actor, businessId, platformTemplateId);
    const result = await saveTemplateEdits(actor, businessId, clone.id, [
      { platformFieldId: "not-a-field", label: "Whatever" },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Reload");
  });

  it("hides a field without deleting it or its mapping", async () => {
    const clone = await cloneTemplate(actor, businessId, platformTemplateId);
    const target = clone.fields.find((f) => !f.isFilterable) ?? clone.fields[0]!;

    await saveTemplateEdits(actor, businessId, clone.id, [
      { platformFieldId: target.platformFieldId, hidden: true },
    ]);

    const after = await getSellerTemplate(businessId, clone.id);
    const hidden = after!.fields.find((f) => f.platformFieldId === target.platformFieldId)!;
    expect(hidden.hidden).toBe(true);
    expect(hidden.platformFieldId).toBe(target.platformFieldId);
  });

  it("gives the same answer for another seller's template as for one that does not exist", async () => {
    const stranger = await prisma.business.findFirstOrThrow({
      where: { id: { not: businessId } },
      select: { id: true },
    });
    const theirs = await prisma.sellerTemplate.create({
      data: { businessId: stranger.id, platformTemplateId, name: "Theirs", fieldMappings: {} },
      select: { id: true },
    });

    expect(await getSellerTemplate(businessId, theirs.id)).toBeNull();
    expect(await getSellerTemplate(businessId, "does-not-exist")).toBeNull();

    await prisma.sellerTemplate.delete({ where: { id: theirs.id } });
  });
});
