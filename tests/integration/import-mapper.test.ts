import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { analyseImport, applyImport, revertImport } from "@/lib/import/service";
import { exportCatalogue } from "@/lib/products/export";
import { looksLikeExport } from "@/lib/import/round-trip";
import { safeName } from "@/lib/storage/buckets";
import type { ColumnPlan } from "@/lib/import/columns";
import type { Actor } from "@/lib/auth/roles";

/**
 * Board 11d, against a real database.
 *
 * The unit tests prove the rules; these prove the wiring, which is where every
 * one of this board's corrections actually lives:
 *
 *   · 5 · the spec template is resolved per row, so one column lands in two
 *     different `SpecField` ids;
 *   · 6 · a row naming no subcategory errors rather than importing into a
 *     default template;
 *   · 7 · a filename resolves to a **reference**, so forty rows share one file;
 *   · 8 · an unresolved filename imports the product without a photo;
 *   · 12 · rollback unlists new products and restores updated ones;
 *   · 13 · a file from `Export ▾` re-imports with every column matched.
 */

const SLUG = "al-marwan-industrial-supplies-llc";
const PREFIX = "IMPORT-11D";

let actor: Actor;
let businessId: string;
let fallbackCategoryId: string;
let valveCategoryId: string;
let pumpCategoryId: string;
let valveSlug: string;
let pumpSlug: string;
const runIds: string[] = [];
const mediaIds: string[] = [];

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
  fallbackCategoryId = business.primaryCategoryId;
  const owner = business.team[0]!;
  actor = { id: owner.id, roles: owner.roles, businessId: business.id };

  const valve = await prisma.category.findFirstOrThrow({
    where: { slug: "butterfly-valves" },
    select: { id: true, slug: true },
  });
  const pump = await prisma.category.findFirstOrThrow({
    where: { slug: "pumps-and-motors" },
    select: { id: true, slug: true },
  });
  valveCategoryId = valve.id;
  valveSlug = valve.slug;
  pumpCategoryId = pump.id;
  pumpSlug = pump.slug;

  /*
     Two files in the library, uploaded through the real `safeName` so the
     stored path carries the random suffix a real upload has. A fixture that
     wrote a clean path would test a code path production never takes.
  */
  for (const name of [`${PREFIX}-datasheet.jpg`, `${PREFIX}-legacy.jpg`]) {
    const legacy = name.endsWith("legacy.jpg");
    const media = await prisma.media.create({
      data: {
        businessId,
        kind: "gallery",
        storagePath: `${businessId}/gallery/${safeName(name)}`,
        // The legacy row has no `filename`, exactly as every row uploaded
        // before this board's migration does.
        filename: legacy ? null : name,
        bytes: 1024,
      },
      select: { id: true },
    });
    mediaIds.push(media.id);
  }
});

afterAll(async () => {
  for (const id of runIds.splice(0)) {
    await prisma.importRunChange.deleteMany({ where: { importRunId: id } });
    await prisma.product.deleteMany({ where: { importRunId: id } });
    await prisma.importRun.deleteMany({ where: { id } });
  }
  await prisma.product.deleteMany({ where: { businessId, name: { startsWith: PREFIX } } });
  await prisma.media.deleteMany({ where: { id: { in: mediaIds } } });
  await prisma.$disconnect();
});

let batch = 0;
function tag(): string {
  batch += 1;
  return `${PREFIX}-B${batch}`;
}

const SPEC_PLAN = (extra: ColumnPlan["columns"] = []): ColumnPlan => ({
  columns: [
    { header: "Item Name", target: { kind: "name" } },
    { header: "Part No", target: { kind: "sku" } },
    { header: "Category", target: { kind: "subcategory" } },
    { header: "Size", target: { kind: "spec", specFieldKey: "nominal_diameter" } },
    ...extra,
  ],
});

describe("criterion 5 — the template is resolved per row", () => {
  it("writes one column into two different field ids across two subcategories", async () => {
    /*
       The board's structural defect, end to end. A single `Template: Valves v3`
       chip over a file spanning three subcategories either applies the wrong
       field set to most of it or drops what it cannot place — and `specValues`
       is keyed by `SpecField.id`, so `nominal_diameter` on the valve sheet and
       `nominal_diameter` on the pump sheet are two different ids for one column.
    */
    const t = tag();
    const result = await applyImport(actor, {
      businessId,
      fallbackCategoryId,
      filename: "two-sheets.csv",
      text: [
        "Item Name,Part No,Category,Size",
        `${t} butterfly valve,${t}-BV,${valveSlug},DN100`,
        `${t} end suction pump,${t}-PU,${pumpSlug},DN80`,
      ].join("\n"),
      plan: SPEC_PLAN(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    runIds.push(result.importRunId);
    expect(result.created).toBe(2);

    const products = await prisma.product.findMany({
      where: { importRunId: result.importRunId },
      orderBy: { name: "asc" },
      select: { name: true, categoryId: true, specValues: true },
    });

    const valve = products.find((product) => product.categoryId === valveCategoryId);
    const pump = products.find((product) => product.categoryId === pumpCategoryId);
    expect(valve).toBeDefined();
    expect(pump).toBeDefined();

    const valveKeys = Object.keys((valve!.specValues ?? {}) as object);
    const pumpKeys = Object.keys((pump!.specValues ?? {}) as object);
    expect(valveKeys).toHaveLength(1);
    expect(pumpKeys).toHaveLength(1);

    // The same column, two different SpecField ids. That is the whole thing.
    expect(valveKeys[0]).not.toBe(pumpKeys[0]);

    // And each id really does belong to that row's own template.
    const fields = await prisma.specField.findMany({
      where: { id: { in: [valveKeys[0]!, pumpKeys[0]!] } },
      select: { id: true, key: true, templateId: true },
    });
    expect(fields.every((field) => field.key === "nominal_diameter")).toBe(true);
    expect(new Set(fields.map((field) => field.templateId)).size).toBe(2);
  });

  it("reads a subcategory by name as well as by slug", async () => {
    const t = tag();
    const category = await prisma.category.findUniqueOrThrow({
      where: { id: pumpCategoryId },
      select: { name: true },
    });
    const preview = await analyseImport({
      businessId,
      fallbackCategoryId,
      text: [
        "Item Name,Part No,Category,Size",
        `${t} pump,${t}-P1,${category.name},DN50`,
      ].join("\n"),
      plan: SPEC_PLAN(),
    });
    // The export writes the slug; a seller's own file writes what they call it.
    expect(preview.outcome.errors).toBe(0);
    expect(preview.outcome.created).toBe(1);
  });
});

describe("criterion 6 — an unmatched subcategory is an error row", () => {
  it("errors the row rather than importing it into a default template", async () => {
    const t = tag();
    const preview = await analyseImport({
      businessId,
      fallbackCategoryId,
      text: [
        "Item Name,Part No,Category,Size",
        `${t} good,${t}-1,${valveSlug},DN100`,
        `${t} bad,${t}-2,Hydraulic hoses and reels,DN100`,
      ].join("\n"),
      plan: SPEC_PLAN(),
    });

    expect(preview.outcome.created).toBe(1);
    expect(preview.outcome.errors).toBe(1);
    expect(preview.subcategories.unknown).toEqual(["Hydraulic hoses and reels"]);
    // Criterion 3, asserted rather than rendered.
    expect(preview.outcome.created + preview.outcome.updated + preview.outcome.errors).toBe(
      preview.outcome.rowCount,
    );
  });

  it("writes nothing for that row when the import runs", async () => {
    const t = tag();
    const result = await applyImport(actor, {
      businessId,
      fallbackCategoryId,
      filename: "one-bad.csv",
      text: [
        "Item Name,Part No,Category,Size",
        `${t} good,${t}-1,${valveSlug},DN100`,
        `${t} bad,${t}-2,Nothing Like A Category,DN100`,
      ].join("\n"),
      plan: SPEC_PLAN(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    runIds.push(result.importRunId);

    expect(result.created).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.detail).toBe("Nothing Like A Category");
    expect(await prisma.product.count({ where: { importRunId: result.importRunId } })).toBe(1);
  });
});

describe("criteria 7 and 8 — photographs are references", () => {
  const PHOTO_PLAN: ColumnPlan = {
    columns: [
      { header: "Item Name", target: { kind: "name" } },
      { header: "Part No", target: { kind: "sku" } },
      { header: "Photo File", target: { kind: "photo" } },
    ],
  };

  it("gives forty products one file, not forty copies", async () => {
    /*
       Criterion 7. `3i` settled that a file is referenced rather than copied —
       one datasheet on four products — and this is the only bulk route to
       media, so it is where forty copies would be created if anywhere.
    */
    const t = tag();
    const rows = Array.from(
      { length: 40 },
      (_, i) => `${t} valve ${i},${t}-${i},${PREFIX}-datasheet.jpg`,
    );
    const result = await applyImport(actor, {
      businessId,
      fallbackCategoryId,
      filename: "photos.csv",
      text: ["Item Name,Part No,Photo File", ...rows].join("\n"),
      plan: PHOTO_PLAN,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    runIds.push(result.importRunId);
    expect(result.created).toBe(40);

    const joins = await prisma.productMedia.findMany({
      where: { product: { importRunId: result.importRunId } },
      select: { mediaId: true, sortOrder: true },
    });
    expect(joins).toHaveLength(40);
    // Forty rows in the join table, one row in `media`.
    expect(new Set(joins.map((join) => join.mediaId)).size).toBe(1);
    expect(joins.every((join) => join.sortOrder === 0)).toBe(true);

    // Nothing was uploaded. Uploading is not part of this route.
    expect(await prisma.media.count({ where: { businessId, id: { notIn: mediaIds } , storagePath: { contains: PREFIX } } })).toBe(0);
  });

  it("matches a file uploaded before Media.filename existed", async () => {
    // Its `filename` is null and its stored path carries `safeName`'s random
    // suffix, which is every row in production before this board's migration.
    const t = tag();
    const preview = await analyseImport({
      businessId,
      fallbackCategoryId,
      text: ["Item Name,Part No,Photo File", `${t} legacy,${t}-L,${PREFIX}-legacy.jpg`].join("\n"),
      plan: PHOTO_PLAN,
    });
    expect(preview.photos.matched).toBe(1);
    expect(preview.photos.unmatched).toBe(0);
  });

  it("imports a row whose filename resolves to nothing, without a photo", async () => {
    // Criterion 8. The 7 of 412 that do not resolve are not failed rows.
    const t = tag();
    const result = await applyImport(actor, {
      businessId,
      fallbackCategoryId,
      filename: "missing-photo.csv",
      text: ["Item Name,Part No,Photo File", `${t} lonely,${t}-X,not-in-the-library.jpg`].join("\n"),
      plan: PHOTO_PLAN,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    runIds.push(result.importRunId);

    expect(result.created).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(
      await prisma.productMedia.count({ where: { product: { importRunId: result.importRunId } } }),
    ).toBe(0);
  });
});

describe("criterion 12 — rollback restores rather than deletes", () => {
  it("unlists what the run created and returns what it overwrote", async () => {
    const t = tag();
    const columns: ColumnPlan = {
      columns: [
        { header: "Item Name", target: { kind: "name" } },
        { header: "Part No", target: { kind: "sku" } },
        { header: "Qty", target: { kind: "stock_qty" } },
      ],
    };

    const first = await applyImport(actor, {
      businessId,
      fallbackCategoryId,
      filename: "rollback-1.csv",
      text: ["Item Name,Part No,Qty", `${t} original name,${t}-R1,10`].join("\n"),
      plan: columns,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    runIds.push(first.importRunId);

    const created = await prisma.product.findFirstOrThrow({
      where: { importRunId: first.importRunId },
      select: { id: true, name: true, stockQty: true },
    });

    // Second run rewrites it by reference match.
    const second = await applyImport(actor, {
      businessId,
      fallbackCategoryId,
      filename: "rollback-2.csv",
      text: ["Item Name,Part No,Qty", `${t} overwritten name,${t}-R1,999`].join("\n"),
      plan: columns,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    runIds.push(second.importRunId);
    expect(second.updated).toBe(1);

    const overwritten = await prisma.product.findUniqueOrThrow({
      where: { id: created.id },
      select: { name: true, stockQty: true },
    });
    expect(overwritten.name).toBe(`${t} overwritten name`);
    expect(overwritten.stockQty).toBe(999);

    /*
       Undo the second run. The board promised 24 hours and said nothing about
       what it restored, which — on an import that rewrote a live product — is
       the only part anyone needs.
    */
    const reverted = await revertImport(actor, second.importRunId);
    expect(reverted.ok).toBe(true);
    if (!reverted.ok) return;
    expect(reverted.restored).toBe(1);

    const restored = await prisma.product.findUniqueOrThrow({
      where: { id: created.id },
      select: { name: true, stockQty: true },
    });
    expect(restored.name).toBe(created.name);
    expect(restored.stockQty).toBe(created.stockQty);
  });

  it("keeps the record when it unlists a run's own products", async () => {
    const t = tag();
    const result = await applyImport(actor, {
      businessId,
      fallbackCategoryId,
      filename: "rollback-3.csv",
      text: ["Item Name,Part No", `${t} keep me,${t}-K1`].join("\n"),
      plan: {
        columns: [
          { header: "Item Name", target: { kind: "name" } },
          { header: "Part No", target: { kind: "sku" } },
        ],
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    runIds.push(result.importRunId);

    await revertImport(actor, result.importRunId);

    // Still there, and not listed. No import event destroys a record.
    const after = await prisma.product.findMany({
      where: { importRunId: result.importRunId },
      select: { status: true },
    });
    expect(after).toHaveLength(1);
    expect(after[0]!.status).toBe("draft");
  });
});

describe("criterion 13 — the round trip", () => {
  it("re-imports its own export with every column matched", async () => {
    /*
       Board `3f` Q3's answer, end to end: whatever `Export ▾` writes, the
       mapper reads back. `3f` shipped without the export at all and `3h` §6
       recorded it as one-way until this board.
    */
    const t = tag();
    const seeded = await applyImport(actor, {
      businessId,
      fallbackCategoryId,
      filename: "seed.csv",
      text: [
        "Item Name,Part No,Category,Size",
        `${t} round trip,${t}-RT,${valveSlug},DN125`,
      ].join("\n"),
      plan: SPEC_PLAN(),
    });
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    runIds.push(seeded.importRunId);

    const product = await prisma.product.findFirstOrThrow({
      where: { importRunId: seeded.importRunId },
      select: { id: true, name: true, sku: true, specValues: true },
    });

    const file = await exportCatalogue({
      businessId,
      origin: "https://example.test",
      productIds: [product.id],
    });
    expect(file.rows).toBe(1);

    const headers = file.csv.split("\r\n")[0]!.split(",");
    expect(looksLikeExport(headers)).toBe(true);
    // No price column leaves the building, because there is none to leave.
    expect(headers.some((header) => /price/i.test(header))).toBe(false);

    // Read it back with no mapping at all: the round trip has to map itself.
    const preview = await analyseImport({ businessId, fallbackCategoryId, text: file.csv });
    expect(preview.roundTrip).not.toBeNull();
    expect(preview.roundTrip!.unknown).toEqual([]);
    // One row, and it matches the product it came from rather than making a new one.
    expect(preview.outcome.updated).toBe(1);
    expect(preview.outcome.created).toBe(0);
    expect(preview.outcome.errors).toBe(0);

    const applied = await applyImport(actor, {
      businessId,
      fallbackCategoryId,
      filename: file.filename,
      text: file.csv,
      plan: preview.plan,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    runIds.push(applied.importRunId);
    expect(applied.updated).toBe(1);

    // Nothing lost on the way home.
    const after = await prisma.product.findUniqueOrThrow({
      where: { id: product.id },
      select: { name: true, sku: true, specValues: true },
    });
    expect(after.name).toBe(product.name);
    expect(after.sku).toBe(product.sku);
    expect(after.specValues).toEqual(product.specValues);
  });
});

describe("criterion 2 — the status tally sums to the column count", () => {
  it("counts every column in the file exactly once", async () => {
    const t = tag();
    const preview = await analyseImport({
      businessId,
      fallbackCategoryId,
      // Nine columns, as the board's own file has.
      text: [
        "Item Description,Part No,Category,Size,Material,Qty on hand,Photo File,Unit Price AED,Supplier Ref",
        `${t} valve,${t}-9,${valveSlug},DN100,Ductile iron,12,${PREFIX}-datasheet.jpg,1240.00,SUP-1`,
      ].join("\n"),
    });

    expect(preview.columns).toHaveLength(9);
    expect(preview.tally.total).toBe(9);
    expect(
      preview.tally.matched + preview.tally.needs_you + preview.tally.blocked + preview.tally.ignored,
    ).toBe(9);

    // Criterion 4: the price column has one destination and it is not a field.
    const price = preview.columns.find((column) => column.header === "Unit Price AED");
    expect(price?.status).toBe("blocked");
    expect(price?.suggestion.reason).toContain("belong on a quote");
  });
});
