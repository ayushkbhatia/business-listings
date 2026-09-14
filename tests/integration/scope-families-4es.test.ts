import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  addFeeBasis,
  assignFamily,
  removeFeeBasis,
  saveRowOrder,
  scopeLibrary,
  setFamilyRetired,
} from "@/lib/services/family-library";
import { familyFor, publicServiceFor } from "@/lib/services/service";
import { setupServicesStateFor } from "@/lib/services/setup";
import { mayPublish, REQUIRED_FIELDS, scopeRows } from "@/lib/services/scope-sheet";
import type { Actor, Role } from "@/lib/auth/roles";

/**
 * Board `4e-s` — the scope-sheet families, against a database.
 *
 * What a unit test cannot reach: that the fee-basis list a family publishes is
 * the one `3g-s` validates against, that removing a basis flags services rather
 * than clearing them, that the row order reaches `1g-s`, that a retired family
 * keeps its work and stops being offered, and that a prompted credential
 * touches nothing on a publish path.
 */

const PREFIX = "fam-4es-";
const made: string[] = [];
const madeCategories: string[] = [];

let categoryId: string;
let opsLead: Actor;

let seq = 0;
const stamp = () => `${Date.now().toString(36)}${(seq += 1)}`;

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });

async function makeSeller(over?: { sheet?: string | null }): Promise<string> {
  const mark = stamp();
  const business = await prisma.business.create({
    data: {
      displayName: `${PREFIX}${mark}`,
      tradeName: `${PREFIX}${mark} LLC`,
      slug: `${PREFIX}${mark}`,
      licenceNumber: `DED-F${mark.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
      primaryCategoryId: categoryId,
      claimStatus: "claimed",
      sellsKind: "services",
      publishedAt: new Date(),
      scopeSheetFamilyId: over?.sheet ?? null,
    },
    select: { id: true },
  });
  made.push(business.id);
  return business.id;
}

beforeAll(async () => {
  categoryId = (await prisma.category.findFirstOrThrow({ select: { id: true } })).id;
  const staff = await prisma.user.findFirstOrThrow({
    where: { roles: { has: "staff_ops_lead" } },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  opsLead = actor(staff.id, "staff_ops_lead");
});

afterAll(async () => {
  await prisma.service.deleteMany({ where: { businessId: { in: made } } });
  await prisma.business.deleteMany({ where: { id: { in: made } } });
  await prisma.category.deleteMany({ where: { id: { in: madeCategories } } });
});

describe("five families, and a fallback that is not one of them", () => {
  it("authors the board's five beside the null answer — B10", async () => {
    const library = await scopeLibrary();
    const authored = library.families.filter((family) => !family.isDefault);

    expect(authored.map((family) => family.id)).toEqual([
      "professional-services",
      "on-site-maintenance",
      "inspection-certification",
      "logistics-clearance",
      "project-advisory",
    ]);
    // The fallback exists and is counted separately — B6.
    expect(library.families.filter((family) => family.isDefault)).toHaveLength(1);
  });

  it("gives every family the six required fields and no say in them — B4, AC3", async () => {
    const library = await scopeLibrary();
    expect(library.requiredFields).toEqual(REQUIRED_FIELDS);

    /*
       A family's rows are the *public table* — how a buyer reads the answers —
       and several of them display a required field. What a family cannot do is
       change which six are required: that list is a module constant with no
       data feeding it, and `completeness` reads the service's own columns.

       So the assertion is that a family adding a row moves neither. An invented
       row key is dropped by `scopeRows` because the renderer has nowhere to
       read a value from, which is the other half of the same rule.
    */
    const mark = stamp();
    const family = await prisma.scopeSheetFamily.create({
      data: { id: `${PREFIX}${mark}`, name: `${PREFIX}${mark}` },
      select: { id: true },
    });
    await prisma.scopeSheetRow.create({
      data: { familyId: family.id, key: "invented_field", label: "Invented", position: 0, filterable: true },
    });

    const resolved = await familyFor(categoryId, family.id);
    expect(resolved.rows.map((row) => row.key)).toContain("invented_field");
    // The public table drops it: a label with nowhere to read a value from
    // renders an empty row for ever.
    expect(scopeRows(resolved.rows, {}).map((row) => row.key)).not.toContain("invented_field");
    // And the six are untouched.
    expect((await scopeLibrary()).requiredFields).toEqual(REQUIRED_FIELDS);

    await prisma.scopeSheetFamily.delete({ where: { id: family.id } });
  });
});

describe("fee bases are per family and are the only source — B2, AC2", () => {
  it("offers a tax practice nothing a freight forwarder is offered", async () => {
    const professional = await familyFor(categoryId, "professional-services");
    const logistics = await familyFor(categoryId, "logistics-clearance");

    const shared = professional.feeBases
      .map((basis) => basis.key)
      .filter((key) => logistics.feeBases.some((basis) => basis.key === key));

    // "Offering per container to a tax practice is the same failure as
    // offering a stock level to a service seller."
    expect(shared).toEqual([]);
    expect(logistics.feeBases.map((b) => b.key)).toContain("per_container");
    expect(professional.feeBases.map((b) => b.key)).not.toContain("per_container");
  });

  it("removes a basis and flags the services holding it — B9, AC7", async () => {
    const id = await makeSeller({ sheet: "on-site-maintenance" });
    const mark = stamp();
    const category = await prisma.category.create({
      data: {
        name: `${PREFIX}${mark}`,
        slug: `${PREFIX}${mark}`,
        code: `${PREFIX}${mark}`,
        scopeFamilyId: "on-site-maintenance",
      },
      select: { id: true },
    });
    madeCategories.push(category.id);

    const service = await prisma.service.create({
      data: {
        businessId: id,
        categoryId: category.id,
        name: `${PREFIX}${mark}`,
        slug: `${PREFIX}${mark}`,
        status: "live",
        feeBasis: "per_job",
      },
      select: { id: true },
    });

    const removed = await removeFeeBasis(
      opsLead,
      "on-site-maintenance",
      "per_job",
      "Per job overlaps per visit and nobody picked it.",
    );
    expect(removed).toEqual({ ok: true, flagged: 1 });

    /*
       Kept, never cleared. A seller's fee basis is their statement about their
       own pricing, and tidying a taxonomy is not a reason to unmake it — the
       editor refuses the key on the next save, where the seller is present to
       choose a replacement.
    */
    const after = await prisma.service.findUniqueOrThrow({
      where: { id: service.id },
      select: { feeBasis: true },
    });
    expect(after.feeBasis).toBe("per_job");

    // Put it back for the tests that follow.
    await addFeeBasis(opsLead, "on-site-maintenance", "per_job", "Per job", "Restoring.");
  });

  it("refuses to remove the last one", async () => {
    const mark = stamp();
    const family = await prisma.scopeSheetFamily.create({
      data: { id: `${PREFIX}${mark}`, name: `${PREFIX}${mark}` },
      select: { id: true },
    });
    await addFeeBasis(opsLead, family.id, "only_one", "Only one", "Seeding the test.");

    expect(
      await removeFeeBasis(opsLead, family.id, "only_one", "Trying to empty it."),
    ).toEqual({ ok: false, reason: "last_basis" });

    await prisma.scopeSheetFamily.delete({ where: { id: family.id } });
  });
});

describe("the row order reaches the buyer — B7, AC6", () => {
  it("reorders a family's rows and says how many pages moved", async () => {
    const id = await makeSeller({ sheet: "inspection-certification" });
    const mark = stamp();
    const category = await prisma.category.create({
      data: {
        name: `${PREFIX}${mark}`,
        slug: `${PREFIX}${mark}`,
        code: `${PREFIX}${mark}`,
        scopeFamilyId: "inspection-certification",
      },
      select: { id: true },
    });
    madeCategories.push(category.id);

    await prisma.service.create({
      data: {
        businessId: id,
        categoryId: category.id,
        name: `${PREFIX}${mark}`,
        slug: `${PREFIX}${mark}`,
        status: "live",
        turnaround: "2 days",
        engagementType: "one_off_job",
      },
    });

    const before = await familyFor(category.id, "inspection-certification");
    const flipped = [before.rows[1]!.key, before.rows[0]!.key];

    const saved = await saveRowOrder(
      opsLead,
      "inspection-certification",
      flipped,
      "Turnaround is what a buyer reads first in this trade.",
    );
    expect(saved.ok).toBe(true);
    expect(saved.ok && saved.affected).toBeGreaterThanOrEqual(1);

    // And it is the order the public page renders — the comparison instrument.
    const business = await prisma.business.findUniqueOrThrow({
      where: { id },
      select: { slug: true },
    });
    const page = await publicServiceFor(business.slug, `${PREFIX}${mark}`);
    expect(page!.rows.slice(0, 2).map((row) => row.key)).toEqual(flipped);

    // Back the way it was.
    await saveRowOrder(
      opsLead,
      "inspection-certification",
      before.rows.map((row) => row.key),
      "Restoring the authored order.",
    );
  });
});

describe("a prompted credential never gates — B3, AC4", () => {
  it("declares one and changes nothing about publishing", async () => {
    const library = await scopeLibrary();
    const inspection = library.families.find((f) => f.id === "inspection-certification")!;
    expect(inspection.credentialKind).toBe("professional_body");

    /*
       The whole of AC4, and it is a property of the code rather than a test of
       a screen: `mayPublish` takes no argument at all, so there is no shape a
       family could take that would reach it.
    */
    expect(mayPublish()).toBe(true);
    expect(mayPublish.length).toBe(0);
  });

  it("leaves Professional services prompting nothing — Q3", async () => {
    /*
       The board's column reads *Regulator-dependent*, and Q3 answers its own
       question: that is a lookup, not a kind. Prompting a law firm for an FTA
       tax agent number is worse than prompting it for nothing.
    */
    const library = await scopeLibrary();
    const professional = library.families.find((f) => f.id === "professional-services")!;
    expect(professional.credentialKind).toBeNull();
  });
});

describe("assignment and the null fallback — B5, B6, AC5", () => {
  it("assigns one subcategory to exactly one family, and back to null", async () => {
    const mark = stamp();
    const category = await prisma.category.create({
      data: {
        name: `${PREFIX}${mark}`,
        slug: `${PREFIX}${mark}`,
        code: `${PREFIX}${mark}`,
        tradeKind: "services",
      },
      select: { id: true },
    });
    madeCategories.push(category.id);

    expect(
      await assignFamily(opsLead, category.id, "logistics-clearance", "It is customs work."),
    ).toEqual({ ok: true });
    expect(
      (await prisma.category.findUniqueOrThrow({
        where: { id: category.id },
        select: { scopeFamilyId: true },
      })).scopeFamilyId,
    ).toBe("logistics-clearance");

    // Null is a real state, not an error — B6.
    expect(await assignFamily(opsLead, category.id, null, "Filed wrongly; unassigning.")).toEqual({
      ok: true,
    });

    /*
       And it still works: the fallback's six required fields and its full
       fee-basis list. Usable and noticeably worse, which is the intended
       pressure to assign.
    */
    const family = await familyFor(category.id, null);
    expect(family.id).toBe("general");
    expect(family.feeBases.length).toBeGreaterThan(0);
  });

  it("refuses a family that is not a family", async () => {
    const mark = stamp();
    const category = await prisma.category.create({
      data: { name: `${PREFIX}${mark}`, slug: `${PREFIX}${mark}`, code: `${PREFIX}${mark}` },
      select: { id: true },
    });
    madeCategories.push(category.id);

    expect(await assignFamily(opsLead, category.id, "not-a-family", "Typo.")).toEqual({
      ok: false,
      reason: "unknown_family",
    });
  });

  it("counts what has no family, from the resolver rather than the column", async () => {
    /*
       `Category.tradeKind` is null on almost every row, so "a services
       subcategory" is what `4d-s`'s walk resolves rather than what a column
       says. The board's 420 is this number in a classified taxonomy; here it is
       what the taxonomy actually holds.
    */
    const library = await scopeLibrary();
    expect(library.servicesSubcategories).toBeGreaterThan(0);
    expect(library.unassigned.length).toBeLessThanOrEqual(library.servicesSubcategories);
  });
});

describe("retiring — B8, AC8", () => {
  it("keeps existing work and stops offering it to new sellers", async () => {
    const onIt = await makeSeller({ sheet: "logistics-clearance" });
    const other = await makeSeller();

    expect(
      await setFamilyRetired(opsLead, "logistics-clearance", true, "Folded into project work."),
    ).toEqual({ ok: true });

    // The seller already on it keeps it, and still sees it as their choice.
    const kept = await setupServicesStateFor(onIt);
    expect(kept!.chosenFamilyId).toBe("logistics-clearance");
    expect(kept!.sheets.map((sheet) => sheet.id)).toContain("logistics-clearance");
    expect(await familyFor(categoryId, "logistics-clearance")).toMatchObject({
      id: "logistics-clearance",
    });

    // Nobody new is offered it.
    const fresh = await setupServicesStateFor(other);
    expect(fresh!.sheets.map((sheet) => sheet.id)).not.toContain("logistics-clearance");

    await setFamilyRetired(opsLead, "logistics-clearance", false, "Restoring after the test.");
  });

  it("refuses to retire the fallback", async () => {
    /*
       Every unassigned subcategory resolves to it, so retiring it would leave
       them with no family at all — and `familyFor` throws rather than rendering
       a fee-basis control with no options.
    */
    expect(await setFamilyRetired(opsLead, "general", true, "Trying it on.")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});

describe("every change is audited — CLAUDE.md non-negotiable 3", () => {
  it("writes a row with the reason the admin typed", async () => {
    const mark = stamp();
    const category = await prisma.category.create({
      data: { name: `${PREFIX}${mark}`, slug: `${PREFIX}${mark}`, code: `${PREFIX}${mark}` },
      select: { id: true },
    });
    madeCategories.push(category.id);

    const reason = `Filed under project work — ${mark}`;
    await assignFamily(opsLead, category.id, "project-advisory", reason);

    const row = await prisma.auditEvent.findFirst({
      where: { subject: `Category:${category.id}` },
      orderBy: { createdAt: "desc" },
      select: { action: true, reason: true, before: true, after: true },
    });
    expect(row).not.toBeNull();
    expect(row!.action).toBe("taxonomy_changed");
    expect(row!.reason).toBe(reason);
    expect(row!.after).toEqual({ scopeFamilyId: "project-advisory" });
  });

  it("refuses a change with no reason", async () => {
    const mark = stamp();
    const category = await prisma.category.create({
      data: { name: `${PREFIX}${mark}`, slug: `${PREFIX}${mark}`, code: `${PREFIX}${mark}` },
      select: { id: true },
    });
    madeCategories.push(category.id);

    await expect(assignFamily(opsLead, category.id, "project-advisory", "   ")).rejects.toThrow();
  });
});
