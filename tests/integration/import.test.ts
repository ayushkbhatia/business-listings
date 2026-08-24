import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { applyImport, revertableRuns, revertImport, REVERSIBLE_FOR_MS } from "@/lib/import/service";
import { PriceColumnError, type ColumnPlan } from "@/lib/import/columns";
import type { Actor } from "@/lib/auth/roles";

/**
 * Handoff 3 criterion 7, against a real database.
 *
 *   "A CSV with a price column cannot import prices — the mapper blocks it with
 *    the reason shown. An import is reversible for 24 hours."
 *
 * The checkpoint for this step is the first half, demonstrated on a real file.
 */

const SLUG = "al-marwan-industrial-supplies-llc";

let actor: Actor;
let businessId: string;
let categoryId: string;
const runIds: string[] = [];

/** A supplier's export, price column and all. This is the file the board draws. */
const FILE = [
  "Item Name,Part No,Unit Price AED,Qty,Lead Time,Body material",
  '"Gate valve, flanged, DN150",GV-150,1240.00,24,7,Ductile iron',
  '"Gate valve, flanged, DN200",GV-200,1980.00,12,7,Ductile iron',
  '"Butterfly valve, lugged, DN200",BV-200,860.00,30,14,Cast iron',
].join("\n");

const NAME_ONLY: ColumnPlan = {
  columns: [
    { header: "Item Name", target: { kind: "name" } },
    { header: "Part No", target: { kind: "sku" } },
    { header: "Unit Price AED", target: { kind: "blocked" } },
    { header: "Qty", target: { kind: "stock_qty" } },
    { header: "Lead Time", target: { kind: "lead_time_days" } },
    { header: "Body material", target: { kind: "ignore" } },
  ],
};

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
  categoryId = business.primaryCategoryId;
  const owner = business.team[0]!;
  actor = { id: owner.id, roles: owner.roles, businessId: business.id };
});

afterAll(async () => {
  for (const id of runIds.splice(0)) {
    await prisma.product.deleteMany({ where: { importRunId: id } });
    await prisma.importRun.deleteMany({ where: { id } });
  }
  await prisma.importMapping.deleteMany({ where: { businessId, name: { startsWith: "test " } } });
  await prisma.$disconnect();
});

describe("criterion 7 — the price column cannot get through", () => {
  it("refuses to run at all if a money column is mapped to a real target", async () => {
    // The mapper will not offer this, but the plan travels through a form and
    // through a saved mapping, and both are strings the seller could edit.
    const smuggled: ColumnPlan = {
      columns: [
        { header: "Item Name", target: { kind: "name" } },
        { header: "Unit Price AED", target: { kind: "description" } },
      ],
    };
    await expect(
      applyImport(actor, {
        businessId,
        categoryId,
        filename: "catalogue.csv",
        text: FILE,
        plan: smuggled,
      }),
    ).rejects.toThrow(PriceColumnError);

    // And nothing was written on the way to refusing.
    const runs = await prisma.importRun.count({ where: { businessId, filename: "catalogue.csv" } });
    expect(runs).toBe(0);
  });

  it("imports the rest of the file with the price left out", async () => {
    const result = await applyImport(actor, {
      businessId,
      categoryId,
      filename: "catalogue.csv",
      text: FILE,
      plan: NAME_ONLY,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    runIds.push(result.importRunId);
    expect(result.created).toBe(3);

    const products = await prisma.product.findMany({
      where: { importRunId: result.importRunId },
      orderBy: { name: "asc" },
    });
    expect(products).toHaveLength(3);

    for (const product of products) {
      // The number in the file was 1240.00, 1980.00 or 860.00. None of them is
      // anywhere on the row, under any name.
      const serialised = JSON.stringify(product);
      expect(serialised).not.toContain("1240");
      expect(serialised).not.toContain("1980");
      expect(serialised).not.toContain("860");
    }

    // And the schema still has nowhere to put one.
    expect(Object.keys(products[0]!)).not.toContain("price");
    expect(Object.keys(products[0]!)).not.toContain("unitPrice");
  });

  it("lands imported products as drafts", async () => {
    // A seller who mapped a column wrong should find out on their own
    // catalogue screen, not from a buyer.
    const products = await prisma.product.findMany({
      where: { importRunId: runIds[0] },
      select: { status: true },
    });
    expect(products.every((p) => p.status === "draft")).toBe(true);
  });
});

describe("criterion 7 — an import is reversible for 24 hours", () => {
  it("undoes a run and deletes exactly what it created", async () => {
    const before = await prisma.product.count({ where: { businessId } });

    const applied = await applyImport(actor, {
      businessId,
      categoryId,
      filename: "second.csv",
      text: [
        "Item Name,Part No",
        "Check valve DN80,CV-80",
        "Check valve DN100,CV-100",
      ].join("\n"),
      plan: { columns: [
        { header: "Item Name", target: { kind: "name" } },
        { header: "Part No", target: { kind: "sku" } },
      ] },
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    expect(await prisma.product.count({ where: { businessId } })).toBe(before + 2);

    const reverted = await revertImport(actor, applied.importRunId);
    expect(reverted).toEqual({ ok: true, deleted: 2 });

    // Back to exactly where it started — nothing else was touched.
    expect(await prisma.product.count({ where: { businessId } })).toBe(before);

    // The record of what happened survives the undo.
    const run = await prisma.importRun.findUniqueOrThrow({ where: { id: applied.importRunId } });
    expect(run.revertedAt).not.toBeNull();
    runIds.push(applied.importRunId);
  });

  it("refuses to undo the same run twice", async () => {
    const run = await prisma.importRun.findFirstOrThrow({
      where: { businessId, revertedAt: { not: null } },
      select: { id: true },
    });
    expect(await revertImport(actor, run.id)).toEqual({
      ok: false,
      error: "That import has already been undone.",
    });
  });

  it("refuses once the window has passed, and says what to do instead", async () => {
    const stale = await prisma.importRun.create({
      data: {
        businessId,
        actorId: actor.id,
        filename: "last-month.csv",
        rowCount: 4,
        createdCount: 4,
        columnPlan: {},
        createdAt: new Date(Date.now() - REVERSIBLE_FOR_MS - 60_000),
      },
      select: { id: true },
    });
    runIds.push(stale.id);

    const result = await revertImport(actor, stale.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("24 hours");
    // Never blames the seller, and says what correct looks like.
    expect(result.error).toContain("catalogue screen");
  });

  it("gives the same answer for another seller's run as for one that does not exist", async () => {
    const stranger = await prisma.business.findFirstOrThrow({
      where: { id: { not: businessId } },
      select: { id: true },
    });
    const theirs = await prisma.importRun.create({
      data: {
        businessId: stranger.id,
        actorId: actor.id,
        filename: "theirs.csv",
        rowCount: 1,
        createdCount: 1,
        columnPlan: {},
      },
      select: { id: true },
    });

    const notMine = await revertImport(actor, theirs.id);
    const notReal = await revertImport(actor, "does-not-exist");
    expect(notMine).toEqual(notReal);

    await prisma.importRun.delete({ where: { id: theirs.id } });
  });

  it("offers only runs still inside the window", async () => {
    const offered = await revertableRuns(businessId);
    const ids = offered.map((r) => r.id);
    const stale = await prisma.importRun.findFirstOrThrow({
      where: { businessId, filename: "last-month.csv" },
      select: { id: true },
    });
    expect(ids).not.toContain(stale.id);
  });
});

describe("a mapping saved for next month", () => {
  it("keeps the plan as applied, blocked column included", async () => {
    const result = await applyImport(actor, {
      businessId,
      categoryId,
      filename: "third.csv",
      text: "Item Name,Unit Price AED\nBall valve DN50,220.00\n",
      plan: {
        columns: [
          { header: "Item Name", target: { kind: "name" } },
          { header: "Unit Price AED", target: { kind: "blocked" } },
        ],
      },
      saveAs: "test monthly export",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    runIds.push(result.importRunId);

    const saved = await prisma.importMapping.findUniqueOrThrow({
      where: { businessId_name: { businessId, name: "test monthly export" } },
    });
    const plan = saved.columnPlan as unknown as ColumnPlan;
    const price = plan.columns.find((c) => c.header === "Unit Price AED");
    // Kept, not dropped: reusing this mapping next month has to refuse the
    // same column again without re-deriving why.
    expect(price?.target.kind).toBe("blocked");
  });
});
