import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { applyImport, revertableRuns, revertImport, REVERSIBLE_FOR_MS } from "@/lib/import/service";
import { PriceColumnError, type ColumnPlan } from "@/lib/import/columns";
import { readHidden } from "@/lib/billing/plan-caps";
import { Prisma } from "@/lib/db/generated/client";
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
/** Fixtures carry this and are deleted by it. The database is shared. */
const PREFIX = "IMPORT-CAP-FIXTURE";

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
        fallbackCategoryId: categoryId,
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
      fallbackCategoryId: categoryId,
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
      /*
         The number in the file was 1240.00, 1980.00 or 860.00. None of them is
         anywhere on the row, under any name.

         Checked against the row's *values*, not its serialised form. Searching
         the JSON matched the id as well, and a cuid holding those three digits
         is a matter of luck — `cmtm6gz86000y3oits6wbhrxa` contains "860" and
         failed this on a run that had nothing to do with prices. The values are
         what the claim is about; the id is not a price under any name.
      */
      const values = Object.entries(product)
        .filter(([key]) => key !== "id" && !key.endsWith("Id"))
        .map(([, value]) => String(value))
        .join(" ");
      expect(values).not.toContain("1240");
      expect(values).not.toContain("1980");
      expect(values).not.toContain("860");
    }

    // And the schema still has nowhere to put one.
    expect(Object.keys(products[0]!)).not.toContain("price");
    expect(Object.keys(products[0]!)).not.toContain("unitPrice");
  });

  it("lists what it imports, up to the plan and the platform's own rules", async () => {
    /*
       Board 11d §4 states `Listed immediately 386`, so an import lists rather
       than landing everything as a draft. Two things can hold a product back
       and neither refuses it: the plan's cap (`3f` §6) and an unfilled required
       spec field (`3h` §5, which `saveProduct` enforces and this path used to
       bypass with `createMany`).

       Asserted as an invariant rather than a fixed count, because which of the
       two applies depends on the seeded plan and template.
    */
    const products = await prisma.product.findMany({
      where: { importRunId: runIds[0] },
      select: { status: true },
    });
    expect(products.length).toBeGreaterThan(0);
    expect(products.every((p) => p.status === "live" || p.status === "draft")).toBe(true);

    const run = await prisma.importRun.findUniqueOrThrow({
      where: { id: runIds[0]! },
      select: { createdCount: true, listedCount: true },
    });
    expect(run.listedCount).toBe(products.filter((p) => p.status === "live").length);
    expect(run.listedCount).toBeLessThanOrEqual(run.createdCount);
  });
});

describe("criterion 7 — an import is reversible for 24 hours", () => {
  it("undoes a run by unlisting exactly what it created, and destroys nothing", async () => {
    const before = await prisma.product.count({ where: { businessId } });

    const applied = await applyImport(actor, {
      businessId,
      fallbackCategoryId: categoryId,
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
    expect(reverted.ok).toBe(true);
    if (!reverted.ok) return;

    /*
       The board promised a 24-hour rollback and never said what it restored.
       §4 does: the new products are **unlisted**, not deleted. `3f` §6 and `3i`
       both hold that no billing or import event destroys a record, and an undo
       is the case that most looks like an exception and is not.

       It also makes the undo itself reversible: four hundred drafts to publish
       rather than four hundred rows to upload again.
    */
    expect(await prisma.product.count({ where: { businessId } })).toBe(before + 2);
    const after = await prisma.product.findMany({
      where: { importRunId: applied.importRunId },
      select: { status: true },
    });
    expect(after).toHaveLength(2);
    expect(after.every((product) => product.status === "draft")).toBe(true);

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
      fallbackCategoryId: categoryId,
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

/**
 * The other door onto the product cap.
 *
 * `saveRow` in lib/products/service.ts refuses at the limit one product at a
 * time — `board.atCap` — and this path wrote with `createMany` and no check at
 * all. So the cap was enforced against the slow way of adding products and not
 * against the fast one, through the same screen. A Free listing capped at ten
 * could import five hundred.
 */
describe("the plan's product cap", () => {
  /*
     Enough rows to overrun any plan the seed sells.

     Two columns, not one: `parseCsv` refuses a file whose header row has fewer
     than two named columns, on the grounds that it does not look like column
     headings at all. A one-column fixture fails for that reason and proves
     nothing about the cap.
  */
  /*
     Each test builds its own rows.

     They used to share one `MANY` constant, which worked only while the first
     test in the block refused its file and wrote nothing. Now that an over-cap
     import writes every row — which is the correction — the second test's rows
     already exist and come back as duplicates. Board 3i hit the same thing on
     gallery order and answered it the same way: a test that mutates shared
     fixture data has to bring its own.
  */
  let batch = 0;
  function ownRows(count: number, filled = false): { text: string; plan: ColumnPlan } {
    batch += 1;
    const tag = `${PREFIX}-B${batch}`;
    const header = filled
      ? "Item Name,Part No,Nominal diameter,Pressure rating,Body material"
      : "Item Name,Part No";
    const row = (i: number) =>
      filled
        ? `${tag} valve ${i},${tag}-${i},DN100,PN16,Ductile iron`
        : `${tag} valve ${i},${tag}-${i}`;
    return {
      text: [header, ...Array.from({ length: count }, (_, i) => row(i))].join("\n"),
      plan: {
        columns: [
          { header: "Item Name", target: { kind: "name" } },
          { header: "Part No", target: { kind: "sku" } },
          ...(filled
            ? [
                { header: "Nominal diameter", target: { kind: "spec" as const, specFieldKey: "nominal_diameter" } },
                { header: "Pressure rating", target: { kind: "spec" as const, specFieldKey: "pressure_rating" } },
                { header: "Body material", target: { kind: "spec" as const, specFieldKey: "body_material" } },
              ]
            : []),
        ],
      },
    };
  }

  let planId: string;
  let originalLimit: number | null;
  let originalSnapshot: unknown;

  beforeAll(async () => {
    const business = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: {
        planId: true,
        plan: { select: { productLimit: true } },
        subscription: { select: { entitlementSnapshot: true } },
      },
    });
    planId = business.planId!;
    originalLimit = business.plan?.productLimit ?? null;
    originalSnapshot = business.subscription?.entitlementSnapshot ?? null;

    /*
       The snapshot has to go, not just the plan row.

       `effectiveFor` prefers `Subscription.entitlementSnapshot` — that is board
       12e's grandfathering, and it is why the first version of this test
       imported forty products against a limit of five and reported success:
       the seeded snapshot still said Pro's `productLimit: null`, so the plan
       edit was correctly ignored. Clearing it makes the live plan row apply,
       which is what these cases are about.
    */
    await prisma.subscription.updateMany({
      where: { businessId },
      data: { entitlementSnapshot: Prisma.DbNull },
    });
  });

  afterAll(async () => {
    await prisma.plan.update({
      where: { id: planId },
      data: { productLimit: originalLimit },
    });
    await prisma.subscription.updateMany({
      where: { businessId },
      data: {
        entitlementSnapshot:
          originalSnapshot === null ? Prisma.DbNull : (originalSnapshot as never),
      },
    });
    await prisma.product.deleteMany({ where: { businessId, name: { startsWith: PREFIX } } });
  });

  it("imports every row and lists up to the cap — criterion 10", async () => {
    /*
       The correction this board makes, and the behaviour this test used to
       assert the opposite of.

       It read: *"refuses the whole file rather than importing up to the
       limit"*, on the reasoning that a truncated import hands a seller an
       arbitrary slice of their own catalogue. That reasoning is sound about
       **truncation** and the conclusion did not follow: refusing the file
       leaves a Free seller with a 412-row stock file unable to import their
       catalogue at all.

       §4 and criterion 10 settle it a third way. Every row imports — nothing is
       dropped and nothing is refused — the plan's worth are listed, and the
       rest are **stored unlisted** for the seller to choose from, which is
       exactly what `3f` §6's downgrade path already does to an existing
       catalogue. A plan limit never destroys a record, and it does not turn one
       away either.
    */
    const used = await prisma.product.count({ where: { businessId } });
    const rows = 40;
    /*
       Required fields filled, so the cap is the only thing that can hold a row
       back. Without them every row lands a draft for the `3h` §5 reason and
       this test would pass while proving nothing about the plan.
    */
    const file = ownRows(rows, true);

    // Room for five of them, and the file is bigger than that.
    await prisma.plan.update({ where: { id: planId }, data: { productLimit: used + 5 } });

    const result = await applyImport(actor, {
      businessId,
      fallbackCategoryId: categoryId,
      filename: "over-cap.csv",
      text: file.text,
      plan: file.plan,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    runIds.push(result.importRunId);

    // Criterion 10's own assertion: every record exists.
    expect(result.created).toBe(rows);
    expect(await prisma.product.count({ where: { importRunId: result.importRunId } })).toBe(rows);

    // And the seller's whole catalogue is still no more listed than the plan.
    const live = await prisma.product.count({ where: { businessId, status: "live" } });
    expect(live).toBeLessThanOrEqual(used + 5);

    // Most of the file did not list. That is the cap doing its work, not a
    // failure to import.
    const overCap = await prisma.product.findMany({
      where: { importRunId: result.importRunId, status: "draft" },
      select: { id: true },
    });
    expect(overCap.length).toBeGreaterThan(0);

    /*
       Stored, not lost. Every product the cap held back is on the
       subscription's list — which is what `3f` distinguishes from a seller's
       own draft, and what an upgrade reads to put them back. Without it a
       seller who upgrades finds four hundred drafts to republish by hand.
    */
    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { businessId },
      select: { hiddenByPlan: true },
    });
    const hidden = new Set(readHidden(subscription.hiddenByPlan));
    expect(overCap.every((product) => hidden.has(product.id))).toBe(true);
  });

  it("reads the cap from the plan record rather than a constant — criterion 11", async () => {
    /*
       Superadmin will be experimenting across Free, Basic and every tier, so
       the number must never be a constant in import code. Proved by moving it
       between two imports and watching the outcome move with it.
    */
    /*
       Listed, not every record — `3f`'s header counts the cap the same way,
       because the cap is on reach rather than on storage. Setting the limit to
       the total product count leaves listing slots free and proves nothing.
    */
    const listed = await prisma.product.count({ where: { businessId, status: "live" } });
    await prisma.plan.update({ where: { id: planId }, data: { productLimit: listed } });

    const first = ownRows(1, true);
    const noRoom = await applyImport(actor, {
      businessId,
      fallbackCategoryId: categoryId,
      filename: "no-room.csv",
      text: first.text,
      plan: first.plan,
    });
    expect(noRoom.ok).toBe(true);
    if (!noRoom.ok) return;
    runIds.push(noRoom.importRunId);
    // Imported, and not listed. Both halves matter.
    expect(noRoom.created).toBe(1);
    expect(noRoom.listed).toBe(0);

    await prisma.plan.update({ where: { id: planId }, data: { productLimit: null } });

    const second = ownRows(1, true);
    const room = await applyImport(actor, {
      businessId,
      fallbackCategoryId: categoryId,
      filename: "room.csv",
      text: second.text,
      plan: second.plan,
    });
    expect(room.ok).toBe(true);
    if (!room.ok) return;
    runIds.push(room.importRunId);
    expect(room.created).toBe(1);
    // The same file, the same code, a different number on the plan row.
    expect(room.listed).toBe(1);
  });

  it("imports a file that fits exactly", async () => {
    /*
       Exactly, not comfortably.

       The slug set inside the row loop does two jobs — the catalogue's slugs
       and the ones this file has already used — so reading its size after the
       loop counts the catalogue plus the file. An earlier version of this check
       did, and refused imports that fit.
    */
    const used = await prisma.product.count({ where: { businessId } });
    const rows = 12;
    const file = ownRows(rows, true);
    await prisma.plan.update({
      where: { id: planId },
      data: { productLimit: used + rows },
    });

    const result = await applyImport(actor, {
      businessId,
      fallbackCategoryId: categoryId,
      filename: "small.csv",
      text: file.text,
      plan: file.plan,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    runIds.push(result.importRunId);
    expect(result.created).toBe(rows);
    // Room for every one of them, so every one lists.
    expect(result.listed).toBe(rows);
  });

  it("re-importing the same file twice adds nothing and refuses nothing", async () => {
    /*
       A seller re-uploading last month's export. With no reference column there
       is nothing to match the rows to, so each one is an error row naming the
       product that already exists — rather than a second copy of the catalogue
       with no way to tell the two apart.

       The error also says what to do about it, which is the difference between
       this and the previous `You already have a product called…`: add a
       reference column and the same file updates instead.
    */
    const file = ownRows(4, true);
    await prisma.plan.update({ where: { id: planId }, data: { productLimit: null } });

    const first = await applyImport(actor, {
      businessId,
      fallbackCategoryId: categoryId,
      filename: "again-1.csv",
      text: file.text,
      plan: file.plan,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    runIds.push(first.importRunId);
    expect(first.created).toBe(4);

    // The same file, with the reference column dropped so nothing can match.
    const noReference: ColumnPlan = {
      columns: file.plan.columns.map((column) =>
        column.target.kind === "sku" ? { header: column.header, target: { kind: "ignore" } } : column,
      ),
    };
    const again = await applyImport(actor, {
      businessId,
      fallbackCategoryId: categoryId,
      filename: "again-2.csv",
      text: file.text,
      plan: noReference,
    });

    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error).not.toMatch(/allows/);

    // Nothing added.
    expect(
      await prisma.product.count({ where: { businessId, name: { startsWith: PREFIX } } }),
    ).toBeGreaterThan(0);
  });

  it("updates rather than duplicating when the same file keeps its reference column", async () => {
    // §5's whole point: export, edit in Excel, re-import, references match.
    const file = ownRows(3, true);
    await prisma.plan.update({ where: { id: planId }, data: { productLimit: null } });

    const first = await applyImport(actor, {
      businessId,
      fallbackCategoryId: categoryId,
      filename: "loop-1.csv",
      text: file.text,
      plan: file.plan,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    runIds.push(first.importRunId);

    const edited = file.text.replace(/ valve 0,/, " valve 0 renamed,");
    const second = await applyImport(actor, {
      businessId,
      fallbackCategoryId: categoryId,
      filename: "loop-2.csv",
      text: edited,
      plan: file.plan,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    runIds.push(second.importRunId);

    // Three rows, three matches, nothing new.
    expect(second.updated).toBe(3);
    expect(second.created).toBe(0);
  });
});
