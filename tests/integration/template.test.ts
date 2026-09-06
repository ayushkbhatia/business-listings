import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  applyDraft,
  cloneTemplate,
  discardDraft,
  fillFor,
  getSellerTemplate,
  getSellerTemplateBySlug,
  pendingChanges,
  revisionsFor,
  rollbackTo,
  saveDraft,
  templatesFor,
} from "@/lib/catalogue/template";
import type { Actor } from "@/lib/auth/roles";

/**
 * Board 3h — the spec template builder, against real rows.
 *
 * The acceptance criteria that are queries and services live here; the ones
 * about what a screen says are in tests/e2e/dashboard-spec-template.spec.ts.
 *
 * Criterion 1 is the one this file exists for: renaming a field changes only
 * its label, and comparison, facets and buyer-facing filters are unaffected.
 * The guarantee is structural — `Product.specValues` and
 * `SellerTemplate.fieldMappings` are both keyed by the platform `SpecField.id`
 * — so these assert the structure rather than a warning.
 */

const PREFIX = "3H-TEMPLATE-FIXTURE";

let businessId: string;
let actorId: string;
let platformTemplateId: string;
let categoryId: string;

const templates: string[] = [];
const products: string[] = [];

function actorFor(): Actor {
  return { id: actorId, roles: ["seller_owner"], businessId };
}

beforeAll(async () => {
  /*
     A supplier with no template of its own, so cloning is the first act.

     Not the flagship: `seedSeatsAndChannels`-style fixtures give five sellers a
     clone with real overrides, and a test that borrowed one would assert
     against somebody else's labels.
  */
  const template = await prisma.specTemplate.findFirstOrThrow({
    where: { status: "live", fields: { some: {} } },
    select: { id: true, categoryId: true },
  });
  platformTemplateId = template.id;
  categoryId = template.categoryId;

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

  const rows = templates.splice(0);
  if (rows.length > 0) await prisma.sellerTemplate.deleteMany({ where: { id: { in: rows } } });
  await prisma.sellerTemplate.deleteMany({ where: { businessId } });
});

afterAll(async () => {
  await prisma.product.deleteMany({ where: { slug: { startsWith: PREFIX.toLowerCase() } } });
  await prisma.$disconnect();
});

async function clone() {
  const view = await cloneTemplate(actorFor(), businessId, platformTemplateId);
  templates.push(view.id);
  return view;
}

/** A product on this template's category, carrying the given values. */
async function product(label: string, specValues: Record<string, unknown>): Promise<string> {
  const row = await prisma.product.create({
    data: {
      businessId,
      categoryId,
      name: `${PREFIX} ${label}`,
      slug: `${PREFIX.toLowerCase()}-${label.toLowerCase()}-${Date.now()}`,
      availability: "in_stock",
      status: "live",
      specValues: specValues as never,
    },
    select: { id: true },
  });
  products.push(row.id);
  return row.id;
}

describe("criterion 1 and 2 — a rename changes only the label", () => {
  it("keeps the platform mapping and every stored value through a rename", async () => {
    const view = await clone();
    const field = view.fields[0]!;
    const productId = await product("A", { [field.fieldId]: "DN50" });

    await saveDraft(actorFor(), businessId, view.id, {
      mappings: { [field.fieldId]: { label: "What we call it" } },
      ownFields: [],
    });
    await applyDraft(actorFor(), businessId, view.id);

    const after = await getSellerTemplate(businessId, view.id);
    const renamed = after!.fields.find((f) => f.fieldId === field.fieldId)!;

    expect(renamed.label).toBe("What we call it");
    // The two halves of the guarantee: the mapping is the same field, and the
    // value is still reachable under the same key.
    expect(renamed.platformFieldId).toBe(field.platformFieldId);
    expect(renamed.isFilterable).toBe(field.isFilterable);

    const stored = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
      select: { specValues: true },
    });
    expect((stored.specValues as Record<string, unknown>)[field.fieldId]).toBe("DN50");
  });

  it("stores no override at all for a label equal to the platform's", async () => {
    /*
       So an untouched field follows a later admin rename instead of being
       frozen at clone time. A snapshot is what makes two sellers' "Body
       material" stop looking like the same field.
    */
    const view = await clone();
    const field = view.fields[0]!;

    await saveDraft(actorFor(), businessId, view.id, {
      mappings: { [field.fieldId]: { label: field.platformLabel! } },
      ownFields: [],
    });
    await applyDraft(actorFor(), businessId, view.id);

    const row = await prisma.sellerTemplate.findUniqueOrThrow({
      where: { id: view.id },
      select: { fieldMappings: true },
    });
    const stored = (row.fieldMappings as Record<string, { label?: string }>)[field.fieldId] ?? {};
    expect(stored.label).toBeUndefined();
  });
});

describe("criterion 3 — detaching is separate and deliberate", () => {
  it("takes the field out of comparison and out of the facet", async () => {
    const view = await clone();
    const filterable = view.fields.find((f) => f.isFilterable)!;

    await saveDraft(actorFor(), businessId, view.id, {
      mappings: { [filterable.fieldId]: { detached: true } },
      ownFields: [],
    });
    await applyDraft(actorFor(), businessId, view.id);

    const after = await getSellerTemplate(businessId, view.id);
    const field = after!.fields.find((f) => f.fieldId === filterable.fieldId)!;

    expect(field.detached).toBe(true);
    expect(field.facet).toBe("yours_only");
    expect(field.isFilterable).toBe(false);
  });

  it("does not make the platform field non-filterable for anybody else", async () => {
    const view = await clone();
    const filterable = view.fields.find((f) => f.isFilterable)!;

    await saveDraft(actorFor(), businessId, view.id, {
      mappings: { [filterable.fieldId]: { detached: true } },
      ownFields: [],
    });
    await applyDraft(actorFor(), businessId, view.id);

    const platform = await prisma.specField.findUniqueOrThrow({
      where: { id: filterable.platformFieldId! },
      select: { isFilterable: true },
    });
    expect(platform.isFilterable).toBe(true);
  });
});

describe("criterion 4 — the filter column is read-only", () => {
  it("offers no seller-facing way to make a field a facet", async () => {
    /*
       There is no `isFilterable` in the override shape, so there is nothing to
       assert against beyond that — which is the point. A per-seller facet
       returns a subset of the sellers who hold the data while its count claims
       otherwise, and hands a seller a switch whose only effect is making them
       harder to find.
    */
    const view = await clone();
    const notAFacet = view.fields.find((f) => !f.isFilterable && !f.own);
    if (!notAFacet) return;

    await saveDraft(actorFor(), businessId, view.id, {
      // A posted key the override type does not carry. It is dropped on read.
      mappings: { [notAFacet.fieldId]: { isFilterable: true } as never },
      ownFields: [],
    });
    await applyDraft(actorFor(), businessId, view.id);

    const after = await getSellerTemplate(businessId, view.id);
    expect(after!.fields.find((f) => f.fieldId === notAFacet.fieldId)!.isFilterable).toBe(false);
    expect(after!.fields.find((f) => f.fieldId === notAFacet.fieldId)!.facet).toBe("not_a_facet");
  });
});

describe("criterion 5 — a requirement never delists a live product", () => {
  it("leaves every product live and counts the gaps instead", async () => {
    const view = await clone();
    const field = view.fields.find((f) => !f.platformRequired && !f.own)!;

    const filled = await product("FILLED", { [field.fieldId]: "Cast iron" });
    const empty = await product("EMPTY", {});

    await saveDraft(actorFor(), businessId, view.id, {
      mappings: { [field.fieldId]: { required: true } },
      ownFields: [],
    });
    await applyDraft(actorFor(), businessId, view.id);

    const after = await getSellerTemplate(businessId, view.id);
    const fill = await fillFor(businessId, after!);

    // The assertion the board did not make: both products are still live.
    const rows = await prisma.product.findMany({
      where: { id: { in: [filled, empty] } },
      select: { status: true },
    });
    expect(rows.every((row) => row.status === "live")).toBe(true);

    /*
       One product is missing THIS field. `productsWithGaps` counts products
       missing any required field, and the platform template may require others
       — so it is asserted as "at least the one we made", not as an equality
       that would break the day a platform requirement is added.
    */
    expect(fill.byField.get(field.fieldId)!.toFix).toBe(1);
    expect(fill.productsWithGaps).toBeGreaterThanOrEqual(1);
  });

  it("refuses to lower a requirement the platform makes", async () => {
    // Open question 1, answered as recommended: the platform's requirement is a
    // floor. Otherwise the comparison table has holes in the columns buyers
    // were promised.
    const view = await clone();
    const required = view.fields.find((f) => f.platformRequired);
    if (!required) return;

    const result = await saveDraft(actorFor(), businessId, view.id, {
      mappings: { [required.fieldId]: { required: false } },
      ownFields: [],
    });
    expect(result.ok).toBe(false);
  });

  it("honours the grace period on a platform requirement", async () => {
    /*
       Board 4e's `SpecField.requiredFrom`: a field required from a date in the
       future is not yet required, so products filed before it are
       incomplete-but-valid. A violation count that ignored it would show a
       seller gaps they cannot yet be asked to fix.
    */
    const view = await clone();
    const field = view.fields.find((f) => !f.platformRequired && !f.own)!;
    await product("GRACE", {});

    await prisma.specField.update({
      where: { id: field.platformFieldId! },
      data: { required: true, requiredFrom: new Date(Date.now() + 30 * 86_400_000) },
    });

    try {
      const after = await getSellerTemplate(businessId, view.id);
      const fill = await fillFor(businessId, after!);
      expect(fill.byField.get(field.fieldId)!.toFix).toBe(0);
    } finally {
      await prisma.specField.update({
        where: { id: field.platformFieldId! },
        data: { required: false, requiredFrom: null },
      });
    }
  });
});

describe("criterion 9 and 10 — nothing applies without review, and it can be undone", () => {
  it("stages a draft that changes nothing a product carries", async () => {
    const view = await clone();
    const field = view.fields[0]!;

    await saveDraft(actorFor(), businessId, view.id, {
      mappings: { [field.fieldId]: { label: "Draft only" } },
      ownFields: [],
    });

    const after = await getSellerTemplate(businessId, view.id);
    // The applied overlay is untouched; the draft carries the change.
    expect(after!.fields.find((f) => f.fieldId === field.fieldId)!.label).toBe(field.label);
    expect(after!.draft!.find((f) => f.fieldId === field.fieldId)!.label).toBe("Draft only");
    expect(after!.revision).toBe(view.revision);
  });

  it("states a blast radius for every pending change", async () => {
    const view = await clone();
    const field = view.fields.find((f) => !f.platformRequired && !f.own)!;

    await saveDraft(actorFor(), businessId, view.id, {
      mappings: { [field.fieldId]: { label: "Renamed", required: true } },
      ownFields: [],
    });

    const after = await getSellerTemplate(businessId, view.id);
    const changes = pendingChanges(after!);

    expect(changes.length).toBeGreaterThanOrEqual(2);
    for (const change of changes) {
      expect(["display_only", "republish", "flag"]).toContain(change.blast);
    }
    expect(changes.find((c) => c.kind === "required_on")!.blast).toBe("flag");
    expect(changes.find((c) => c.kind === "renamed")!.blast).toBe("republish");
  });

  it("writes a revision on apply and clears the draft", async () => {
    const view = await clone();
    const field = view.fields[0]!;

    await saveDraft(actorFor(), businessId, view.id, {
      mappings: { [field.fieldId]: { label: "Applied" } },
      ownFields: [],
    });
    const applied = await applyDraft(actorFor(), businessId, view.id);
    expect(applied.ok).toBe(true);

    const after = await getSellerTemplate(businessId, view.id);
    expect(after!.revision).toBe(view.revision + 1);
    expect(after!.draft).toBeNull();
    expect(after!.fields.find((f) => f.fieldId === field.fieldId)!.label).toBe("Applied");

    const history = await revisionsFor(businessId, view.id);
    expect(history).toHaveLength(1);
    expect(history[0]!.changes.some((c) => c.kind === "renamed")).toBe(true);
  });

  it("restores a prior revision forward, never by rewinding the counter", async () => {
    const view = await clone();
    const field = view.fields[0]!;
    const original = field.label;

    await saveDraft(actorFor(), businessId, view.id, {
      mappings: { [field.fieldId]: { label: "First" } },
      ownFields: [],
    });
    const first = await applyDraft(actorFor(), businessId, view.id);
    if (!first.ok) throw new Error("apply failed");

    await saveDraft(actorFor(), businessId, view.id, {
      mappings: { [field.fieldId]: { label: "Second" } },
      ownFields: [],
    });
    await applyDraft(actorFor(), businessId, view.id);

    // Back to the state the first apply produced.
    const rolled = await rollbackTo(actorFor(), businessId, view.id, first.revision);
    expect(rolled.ok).toBe(true);

    const after = await getSellerTemplate(businessId, view.id);
    expect(after!.fields.find((f) => f.fieldId === field.fieldId)!.label).toBe("First");
    // Forward: the history is append-only and a rollback can itself be undone.
    expect(after!.revision).toBe(view.revision + 3);
    expect(await revisionsFor(businessId, view.id)).toHaveLength(3);
    expect(original).not.toBe("First");
  });

  it("throws the draft away without touching what is applied", async () => {
    const view = await clone();
    const field = view.fields[0]!;

    await saveDraft(actorFor(), businessId, view.id, {
      mappings: { [field.fieldId]: { label: "Never applied" } },
      ownFields: [],
    });
    await discardDraft(actorFor(), businessId, view.id);

    const after = await getSellerTemplate(businessId, view.id);
    expect(after!.draft).toBeNull();
    expect(after!.fields.find((f) => f.fieldId === field.fieldId)!.label).toBe(field.label);
    expect(pendingChanges(after!)).toEqual([]);
  });
});

describe("criterion 11 — every count is a query", () => {
  it("counts filled per field over the seller's own products", async () => {
    const view = await clone();
    const [a, b] = view.fields;

    await product("ONE", { [a!.fieldId]: "DN50", [b!.fieldId]: "Cast iron" });
    await product("TWO", { [a!.fieldId]: "DN80" });
    await product("THREE", {});

    const fill = await fillFor(businessId, view);
    expect(fill.total).toBe(3);
    expect(fill.byField.get(a!.fieldId)!.filled).toBe(2);
    expect(fill.byField.get(b!.fieldId)!.filled).toBe(1);
  });

  it("treats an empty string and an empty array as unfilled", async () => {
    const view = await clone();
    const field = view.fields[0]!;
    await product("BLANK", { [field.fieldId]: "   " });
    await product("EMPTYARR", { [field.fieldId]: [] });

    const fill = await fillFor(businessId, view);
    expect(fill.byField.get(field.fieldId)!.filled).toBe(0);
  });
});

describe("the seller's own fields", () => {
  it("carries one that is never a facet and never in comparison", async () => {
    const view = await clone();

    await saveDraft(actorFor(), businessId, view.id, {
      mappings: {},
      ownFields: [
        {
          id: "own-warranty",
          label: "Warranty",
          type: "text",
          unit: "months",
          options: [],
          required: false,
          sortOrder: 99,
        },
      ],
    });
    await applyDraft(actorFor(), businessId, view.id);

    const after = await getSellerTemplate(businessId, view.id);
    const own = after!.fields.find((f) => f.fieldId === "own-warranty")!;

    expect(own.own).toBe(true);
    expect(own.platformFieldId).toBeNull();
    expect(own.isFilterable).toBe(false);
    // A field nobody else has is a field nobody can filter across, which is
    // what `YOURS ONLY` says on the screen.
    expect(own.facet).toBe("yours_only");
  });

  it("keeps a value stored against an own field, keyed the same way", async () => {
    const view = await clone();
    await saveDraft(actorFor(), businessId, view.id, {
      mappings: {},
      ownFields: [
        { id: "own-lead", label: "Lead time", type: "number", unit: "days", options: [], required: false, sortOrder: 99 },
      ],
    });
    await applyDraft(actorFor(), businessId, view.id);
    await product("OWNVAL", { "own-lead": "21" });

    const after = await getSellerTemplate(businessId, view.id);
    const fill = await fillFor(businessId, after!);
    expect(fill.byField.get("own-lead")!.filled).toBe(1);
  });
});

describe("the rail and the route", () => {
  it("resolves a template by the slug the route carries", async () => {
    const view = await clone();
    const bySlug = await getSellerTemplateBySlug(businessId, view.slug);
    expect(bySlug?.id).toBe(view.id);
  });

  it("gives the same answer for another seller's slug as for one that does not exist", async () => {
    const view = await clone();
    const stranger = await prisma.business.findFirstOrThrow({
      where: { id: { not: businessId } },
      select: { id: true },
    });
    expect(await getSellerTemplateBySlug(stranger.id, view.slug)).toBeNull();
  });

  it("lists what this business holds, with the products on each", async () => {
    const view = await clone();
    await product("RAIL", {});

    const rail = await templatesFor(businessId);
    const row = rail.find((entry) => entry.slug === view.slug)!;
    expect(row.products).toBe(1);
    expect(row.pendingChanges).toBe(0);
  });

  it("is idempotent by business and platform template", async () => {
    // A second clone would give one seller two sets of labels for the same
    // fields, and nothing downstream could say which was current. Since
    // migration 20260914090100 it is a database unique rather than a
    // convention.
    const first = await clone();
    const second = await cloneTemplate(actorFor(), businessId, platformTemplateId);
    expect(second.id).toBe(first.id);
  });
});
