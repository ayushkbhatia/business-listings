import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import type { Actor, Role } from "@/lib/auth/roles";
import { PermissionError } from "@/lib/auth/errors";
import {
  addSection,
  createTemplate,
  setSectionSettings,
  templateScopeFor,
} from "@/lib/storefront/service";

/**
 * Board `5c-s` — the section library filtered by trade kind, against a real
 * database.
 *
 * Every fixture here is this file's own: a sector made for the test, a template
 * on it, and a listing in it, removed afterwards. The seeded Industrial template
 * is read and never written, because sibling suites assert on it.
 */

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });

let opsLeadId: string;
let moderatorId: string;
const madeCategories: string[] = [];
const madeTemplates: string[] = [];
const madeBusinesses: string[] = [];

beforeAll(async () => {
  opsLeadId = (
    await prisma.user.findFirstOrThrow({
      where: { roles: { has: "staff_ops_lead" } },
      orderBy: { id: "asc" },
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

afterAll(async () => {
  await prisma.business.deleteMany({ where: { id: { in: madeBusinesses } } });
  await prisma.storefrontTemplate.deleteMany({ where: { id: { in: madeTemplates } } });
  await prisma.category.deleteMany({ where: { parentId: { in: madeCategories } } });
  await prisma.category.deleteMany({ where: { id: { in: madeCategories } } });
  await prisma.$disconnect();
});

/** A sector of this test's own, a draft template on it, and optionally a services leaf. */
async function trade(kind: "goods" | "services", name: string, status: "draft" | "live" = "draft") {
  const stamp = `${Date.now()}${madeCategories.length}`;
  const sector = await prisma.category.create({
    data: { name: `CS Test ${name} ${stamp}`, slug: `cs-test-${stamp}`, code: "CS", tradeKind: kind },
    select: { id: true },
  });
  madeCategories.push(sector.id);

  const created = await createTemplate({
    actor: actor(opsLeadId, "staff_ops_lead"),
    sectorId: sector.id,
    name: `CS Test ${name} ${stamp}`,
    reason: "A template for this trade, so the library has something to filter.",
  });
  if (!created.ok) throw new Error(`fixture failed: ${created.error}`);
  madeTemplates.push(created.id);
  if (status === "live") {
    /*
       A live template with only the sections the test places. `createTemplate`
       starts one with a default set, which would make "which sections render"
       an assertion about that default rather than about the filter.
    */
    await prisma.templateSection.deleteMany({ where: { templateId: created.id } });
    await prisma.storefrontTemplate.update({ where: { id: created.id }, data: { status: "live" } });
  }
  return { templateId: created.id, sectorId: sector.id, stamp };
}

async function listingIn(sectorId: string, stamp: string, sellsKind: "goods" | "services" | "both") {
  const business = await prisma.business.create({
    data: {
      tradeName: `CS Listing ${stamp} LLC`,
      displayName: `CS Listing ${stamp}`,
      slug: `cs-listing-${stamp}`,
      licenceNumber: `DED-CS-${stamp.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 200 * 86_400_000),
      primaryCategoryId: sectorId,
      claimStatus: "claimed",
      publishedAt: new Date(),
      sellsKind,
    },
    select: { id: true, slug: true, sectorId: true, themePreset: true, sellsKind: true },
  });
  madeBusinesses.push(business.id);
  return business;
}

describe("criterion 1 — the library resolves per template", () => {
  it("gives a services trade the services library, and refuses goods sections on it", async () => {
    const { templateId, sectorId } = await trade("services", "Practice");
    expect(await templateScopeFor(sectorId)).toBe("services");

    const refused = await addSection({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId,
      type: "catalogue_grid",
      reason: "Trying to put a catalogue on a practice.",
    });
    expect(refused).toMatchObject({ ok: false, error: "unavailable_here" });

    const added = await addSection({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId,
      type: "scope_grid",
      reason: "The scope grid is what a buyer compares a practice on.",
    });
    expect(added.ok).toBe(true);
  }, 60_000);

  it("widens to both when a published store in the trade sells both (B9)", async () => {
    const { sectorId, stamp } = await trade("services", "Mixed");
    await listingIn(sectorId, stamp, "both");
    expect(await templateScopeFor(sectorId)).toBe("both");
  }, 60_000);

  it("resolves the seeded goods trade that files a services firm as both", async () => {
    // Meridian, the service track's fixture, sells work and is filed under valves.
    const valves = await prisma.category.findFirstOrThrow({
      where: { slug: "valves-and-fittings" },
      select: { id: true },
    });
    const meridian = await prisma.business.findUnique({
      where: { slug: "meridian-chartered-accountants" },
      select: { sectorId: true, publishedAt: true },
    });
    if (!meridian?.publishedAt || meridian.sectorId !== valves.id) return;
    expect(await templateScopeFor(valves.id)).toBe("both");
  }, 60_000);

  it("refuses process steps on every template, held for its decision (B3)", async () => {
    const { templateId } = await trade("services", "Held");
    const result = await addSection({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId,
      type: "process_steps",
      reason: "Trying to add process steps before Q1 is decided.",
    });
    expect(result).toMatchObject({ ok: false, error: "held" });
  }, 60_000);
});

describe("criterion 3 — configuration only, audited", () => {
  async function gridOn() {
    const { templateId } = await trade("services", "Settings");
    const added = await addSection({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId,
      type: "scope_grid",
      reason: "A scope grid to configure.",
    });
    if (!added.ok) throw new Error(added.error);
    return { templateId, sectionId: added.sectionId };
  }

  it("stores a column choice and writes an audit row with the reason and the store count", async () => {
    const { templateId, sectionId } = await gridOn();
    const result = await setSectionSettings({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId,
      sectionId,
      settings: { columns: ["engagement", "turnaround", "fee_basis"] },
      reason: "Buyers of this trade read engagement type first.",
    });
    expect(result.ok).toBe(true);

    const row = await prisma.templateSection.findUniqueOrThrow({
      where: { id: sectionId },
      select: { settings: true },
    });
    expect(row.settings).toEqual({ columns: ["engagement", "turnaround", "fee_basis"] });

    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { subject: `StorefrontTemplate:${templateId}` },
      orderBy: { createdAt: "desc" },
      select: { after: true, reason: true },
    });
    expect((audit.after as { storeCount: number }).storeCount).toBe(0);
    expect(audit.reason).toBe("Buyers of this trade read engagement type first.");
  }, 60_000);

  it("refuses a renamed column, a free-text value and an empty grid — B4, Q2", async () => {
    const { templateId, sectionId } = await gridOn();
    const base = { actor: actor(opsLeadId, "staff_ops_lead"), templateId, sectionId, reason: "Trying it on." };

    expect(
      await setSectionSettings({ ...base, settings: { columns: ["fee_basis"], labels: { fee_basis: "From" } } }),
    ).toMatchObject({ ok: false, error: "unknown_setting" });
    expect(await setSectionSettings({ ...base, settings: { columns: ["AED 4,000"] } })).toMatchObject({
      ok: false,
      error: "not_an_option",
    });
    expect(await setSectionSettings({ ...base, settings: { columns: [] } })).toMatchObject({
      ok: false,
      error: "no_columns",
    });

    // And nothing was written.
    const row = await prisma.templateSection.findUniqueOrThrow({
      where: { id: sectionId },
      select: { settings: true },
    });
    expect(row.settings).toEqual({});
  }, 60_000);

  it("refuses a section with nothing to configure, and a moderator", async () => {
    const { templateId } = await trade("services", "Display only");
    const sectors = await addSection({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId,
      type: "sectors_served",
      reason: "Sectors, display only.",
    });
    if (!sectors.ok) throw new Error(sectors.error);
    expect(
      await setSectionSettings({
        actor: actor(opsLeadId, "staff_ops_lead"),
        templateId,
        sectionId: sectors.sectionId,
        settings: {},
        reason: "Nothing to set.",
      }),
    ).toMatchObject({ ok: false, error: "not_configurable" });

    const { sectionId, templateId: gridTemplate } = await gridOn();
    await expect(
      setSectionSettings({
        actor: actor(moderatorId, "staff_moderator"),
        templateId: gridTemplate,
        sectionId,
        settings: { columns: ["turnaround"] },
        reason: "Not my row.",
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  }, 60_000);
});

describe("at the storefront — each listing renders the half it can fill", () => {
  it("drops services sections for a goods listing and goods sections for a services one", async () => {
    const { storefrontPlan } = await import("@/lib/storefront/loader");
    const { templateId, sectorId, stamp } = await trade("goods", "Storefront", "live");
    for (const [index, type] of ["hero", "catalogue_grid", "scope_grid", "reviews"].entries()) {
      await prisma.templateSection.create({
        data: { templateId, type, sortOrder: index, singleton: true },
      });
    }

    const goods = await listingIn(sectorId, `${stamp}g`, "goods");
    const goodsPlan = await storefrontPlan(goods);
    expect(goodsPlan.sections.map((section) => section.type)).toEqual(["hero", "catalogue_grid", "reviews"]);
    expect(goodsPlan.data.work).toBeNull();
    expect(goodsPlan.data.kind).toBe("goods");

    const both = await listingIn(sectorId, `${stamp}b`, "both");
    const bothPlan = await storefrontPlan(both);
    expect(bothPlan.sections.map((section) => section.type)).toEqual([
      "hero",
      "catalogue_grid",
      "scope_grid",
      "reviews",
    ]);
    // Loaded, because a scope grid is on the page and the firm sells work.
    expect(bothPlan.data.work).not.toBeNull();
    expect(bothPlan.data.work!.services).toEqual([]);
  }, 120_000);

  it("drops a seller's hero headline that states a price before it renders — B4", async () => {
    const { storefrontPlan } = await import("@/lib/storefront/loader");
    const { templateId, sectorId, stamp } = await trade("goods", "Price", "live");
    const hero = await prisma.templateSection.create({
      data: {
        templateId,
        type: "hero",
        sortOrder: 0,
        singleton: true,
        sellerEditableFields: ["headline", "eyebrow"],
      },
      select: { id: true },
    });
    const listing = await listingIn(sectorId, `${stamp}p`, "goods");
    await prisma.storefrontContent.create({
      data: {
        businessId: listing.id,
        sectionId: hero.id,
        values: { headline: "Valves from AED 40 a piece", eyebrow: "Al Quoz", buttonLabel: "Not opened" },
      },
    });

    const plan = await storefrontPlan(listing);
    expect(plan.content[hero.id]).toEqual({ eyebrow: "Al Quoz" });
  }, 120_000);

  it("carries no fee amount in the work a section reads", async () => {
    const { sectionWorkFor } = await import("@/lib/storefront/loader");
    const meridian = await prisma.business.findUnique({
      where: { slug: "meridian-chartered-accountants" },
      select: { id: true },
    });
    if (!meridian) return;

    const work = await sectionWorkFor(meridian.id);
    expect(work.services.length).toBeGreaterThan(0);
    for (const service of work.services) {
      expect(Object.keys(service).sort()).toEqual(
        ["deliveredWhere", "engagementType", "feeBasis", "id", "name", "places", "scope", "slug", "turnaround"].sort(),
      );
    }
    expect(JSON.stringify(work)).not.toMatch(/indicativeFee|AED\s*[\d,]/);
  }, 60_000);
});
