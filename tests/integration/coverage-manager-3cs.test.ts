import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import type { Actor } from "@/lib/auth/roles";
import {
  coverageManagerFor,
  saveDefaultCoverage,
  saveServiceCoverageSet,
} from "@/lib/services/coverage-manager";
import { publicCoverageFor } from "@/lib/storefront/services";

/**
 * Board `3c-s` — the coverage manager, against a database.
 *
 * The markers and the chip are unit-tested in `lib/locations/coverage-marker.test.ts`.
 * These are the facts that need rows: that the manager reads the markers off the
 * rows rather than anything stored, that a default edit moves inheriting services
 * and leaves overriding ones alone, that the listing headline is the union over
 * **live** services only and agrees with the function `1d-s` renders, that a
 * published listing cannot be emptied through the back door, and that a sales
 * seat is refused.
 */

const PREFIX = "cov-3cs-mgr-";

let categoryId: string;
let dmccId: string;
const made: string[] = [];

let seq = 0;
const stamp = () => `${Date.now().toString(36)}${(seq += 1)}`;

async function firm(fields: { published?: boolean } = {}): Promise<{ id: string; owner: Actor; sales: Actor }> {
  const mark = stamp();
  const business = await prisma.business.create({
    data: {
      displayName: `${PREFIX}${mark}`,
      tradeName: `${PREFIX}${mark} LLC`,
      slug: `${PREFIX}${mark}`,
      licenceNumber: `DED-M${mark.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
      primaryCategoryId: categoryId,
      claimStatus: "claimed",
      sellsKind: "services",
      deliveryModes: ["remote", "at_our_office"],
      publishedAt: fields.published === false ? null : new Date(),
      serviceCoverage: {
        create: [
          { emirate: "dubai" },
          { emirate: "sharjah" },
          { emirate: "abu_dhabi" },
        ],
      },
    },
    select: { id: true },
  });
  made.push(business.id);
  return {
    id: business.id,
    owner: { id: crypto.randomUUID(), roles: ["seller_owner"], businessId: business.id },
    sales: { id: crypto.randomUUID(), roles: ["seller_sales"], businessId: business.id },
  };
}

async function service(
  businessId: string,
  name: string,
  status: "live" | "draft" = "live",
  deliveredWhere: "remote" | "on_site" | null = "remote",
): Promise<string> {
  const row = await prisma.service.create({
    data: { businessId, categoryId, name, slug: `${PREFIX}${stamp()}`, status, deliveredWhere },
    select: { id: true },
  });
  return row.id;
}

beforeAll(async () => {
  categoryId = (await prisma.category.findFirstOrThrow({ select: { id: true } })).id;
  const zone = await prisma.area.findFirstOrThrow({
    where: { isFreeZone: true, emirate: "dubai" },
    orderBy: { name: "asc" },
    select: { id: true },
  });
  dmccId = zone.id;
});

afterAll(async () => {
  await prisma.freeZoneRegistration.deleteMany({ where: { businessId: { in: made } } });
  await prisma.serviceCoverage.deleteMany({ where: { businessId: { in: made } } });
  await prisma.service.deleteMany({ where: { businessId: { in: made } } });
  await prisma.business.deleteMany({ where: { id: { in: made } } });
});

describe("the board's four rows, read back", () => {
  it("derives every marker and the header chip from the rows — B1, B3, B4", async () => {
    const f = await firm();
    const vat = await service(f.id, "VAT return filing");
    const books = await service(f.id, "Monthly bookkeeping");
    const tax = await service(f.id, "Corporate tax registration", "live", null);
    const audit = await service(f.id, "Statutory audit", "live", "on_site");

    expect((await saveServiceCoverageSet(f.owner, f.id, books, ["dubai", "sharjah"])).ok).toBe(true);
    expect(
      (
        await saveServiceCoverageSet(f.owner, f.id, tax, [
          "abu_dhabi", "dubai", "sharjah", "ajman", "umm_al_quwain", "ras_al_khaimah", "fujairah",
        ])
      ).ok,
    ).toBe(true);
    expect((await saveServiceCoverageSet(f.owner, f.id, audit, ["dubai"])).ok).toBe(true);

    const state = await coverageManagerFor(f.id);
    expect(state).not.toBeNull();
    const byId = new Map(state!.rows.map((row) => [row.serviceId, row]));

    expect(byId.get(vat)).toMatchObject({ marker: "inherited", places: ["Abu Dhabi", "Dubai", "Sharjah"] });
    expect(byId.get(books)).toMatchObject({ marker: "narrowed", places: ["Dubai", "Sharjah"] });
    expect(byId.get(tax)).toMatchObject({ marker: "wider", everyEmirate: true, deliveredWhere: null });
    expect(byId.get(audit)).toMatchObject({ marker: "narrowed", places: ["Dubai"], deliveredWhere: "on_site" });

    // `3 EMIRATES DEFAULT · 2 NARROWER · 1 WIDER`, counted, not typed.
    expect(state!.tally).toEqual({ defaultEmirates: 3, inherited: 1, same: 0, narrowed: 2, wider: 1 });
  });
});

describe("inheritance, and the blast radius of the default — B2, B11", () => {
  it("never copies the default into a row, and an emptied row inherits again", async () => {
    const f = await firm();
    const svc = await service(f.id, "Payroll");

    await saveServiceCoverageSet(f.owner, f.id, svc, ["dubai"]);
    expect(await prisma.serviceCoverage.count({ where: { serviceId: svc } })).toBe(1);

    await saveServiceCoverageSet(f.owner, f.id, svc, []);
    expect(await prisma.serviceCoverage.count({ where: { serviceId: svc } })).toBe(0);
    const state = await coverageManagerFor(f.id);
    expect(state!.rows[0]!.marker).toBe("inherited");
  });

  it("counts inheriting services before the write and moves exactly those", async () => {
    const f = await firm();
    const inheritingLive = await service(f.id, "Inherits, live");
    const inheritingDraft = await service(f.id, "Inherits, draft", "draft");
    const narrowed = await service(f.id, "Narrowed");
    await saveServiceCoverageSet(f.owner, f.id, narrowed, ["dubai"]);

    const before = await coverageManagerFor(f.id);
    expect(before!.inheriting).toEqual({ total: 2, live: 1 });

    const write = await saveDefaultCoverage(f.owner, f.id, {
      areaKeys: ["dubai", "ajman"],
      modes: ["remote"],
      freeZoneIds: [],
    });
    expect(write).toMatchObject({ ok: true, moved: 2 });

    const after = await coverageManagerFor(f.id);
    const byId = new Map(after!.rows.map((row) => [row.serviceId, row]));
    expect(byId.get(inheritingLive)!.places).toEqual(["Dubai", "Ajman"]);
    expect(byId.get(inheritingDraft)!.places).toEqual(["Dubai", "Ajman"]);
    // The override did not move, and against the new default it is now `same`
    // only if it matches — here Dubai alone is narrower than Dubai and Ajman.
    expect(byId.get(narrowed)).toMatchObject({ places: ["Dubai"], marker: "narrowed" });
    expect(after!.defaults.deliveryModes).toEqual(["remote"]);
  });

  it("keeps a finer default row the editor does not offer", async () => {
    const f = await firm();
    const quarter = await prisma.area.findFirstOrThrow({
      where: { emirate: "dubai", isFreeZone: false, searchedAsEmirate: false },
      select: { id: true },
    });
    await prisma.serviceCoverage.create({
      data: { businessId: f.id, emirate: "dubai", areaId: quarter.id },
    });

    await saveDefaultCoverage(f.owner, f.id, { areaKeys: ["sharjah"], modes: ["remote"], freeZoneIds: [] });

    const rows = await prisma.serviceCoverage.findMany({
      where: { businessId: f.id, serviceId: null },
      select: { emirate: true, areaId: true },
    });
    // Sharjah replaced the three chips; the area row nobody was shown survived.
    expect(rows).toEqual(
      expect.arrayContaining([
        { emirate: "sharjah", areaId: null },
        { emirate: "dubai", areaId: quarter.id },
      ]),
    );
    expect(rows).toHaveLength(2);
  });
});

describe("the public union — B5, and it agrees with 1d-s", () => {
  it("is the union over live services, and a draft cannot widen it", async () => {
    const f = await firm();
    const live = await service(f.id, "Live, narrowed");
    const draft = await service(f.id, "Draft, all seven", "draft");
    await saveServiceCoverageSet(f.owner, f.id, live, ["dubai"]);
    await saveServiceCoverageSet(f.owner, f.id, draft, [
      "abu_dhabi", "dubai", "sharjah", "ajman", "umm_al_quwain", "ras_al_khaimah", "fujairah",
    ]);

    const state = await coverageManagerFor(f.id);
    expect(state!.publicPlaces).toEqual(["Dubai"]);

    // The same answer the storefront renders, from the function it renders with.
    const storefront = await publicCoverageFor(f.id, [live]);
    expect(storefront.map((place) => place.label)).toEqual(state!.publicPlaces);
  });

  it("counts a live service with no coverage when it inherits an empty default", async () => {
    const f = await firm({ published: false });
    await service(f.id, "Nowhere");
    await saveDefaultCoverage(f.owner, f.id, { areaKeys: [], modes: [], freeZoneIds: [] });
    const state = await coverageManagerFor(f.id);
    expect(state!.uncovered).toBe(1);
    expect(state!.rows[0]!.places).toEqual([]);
  });
});

describe("free zones are a second axis — B6", () => {
  it("stores a registration, never a coverage row, and qualifies every row that reaches its emirate", async () => {
    const f = await firm();
    const svc = await service(f.id, "Audit");
    await saveServiceCoverageSet(f.owner, f.id, svc, ["dubai"]);
    const write = await saveDefaultCoverage(f.owner, f.id, {
      areaKeys: ["dubai", "sharjah"],
      modes: ["remote"],
      freeZoneIds: [dmccId],
    });
    expect(write.ok).toBe(true);

    expect(await prisma.serviceCoverage.count({ where: { businessId: f.id, areaId: dmccId } })).toBe(0);
    expect(await prisma.freeZoneRegistration.count({ where: { businessId: f.id, areaId: dmccId } })).toBe(1);

    const state = await coverageManagerFor(f.id);
    expect(state!.rows[0]!.qualifiers).toHaveLength(1);
  });

  it("refuses a free-zone id that is not a free zone", async () => {
    const f = await firm();
    const notZone = await prisma.area.findFirstOrThrow({ where: { isFreeZone: false }, select: { id: true } });
    expect(
      await saveDefaultCoverage(f.owner, f.id, { areaKeys: ["dubai"], modes: ["remote"], freeZoneIds: [notZone.id] }),
    ).toEqual({ ok: false, reason: "not_a_free_zone" });
  });
});

describe("the refusals", () => {
  it("holds the publish gate after publish: no mode, no area", async () => {
    const f = await firm();
    expect(
      await saveDefaultCoverage(f.owner, f.id, { areaKeys: ["dubai"], modes: [], freeZoneIds: [] }),
    ).toEqual({ ok: false, reason: "live_needs_mode" });
    expect(
      await saveDefaultCoverage(f.owner, f.id, { areaKeys: [], modes: ["remote"], freeZoneIds: [] }),
    ).toEqual({ ok: false, reason: "live_needs_area" });
    // And nothing moved.
    expect(await prisma.serviceCoverage.count({ where: { businessId: f.id, serviceId: null } })).toBe(3);
  });

  it("refuses a sales seat, which cannot shape the public profile", async () => {
    const f = await firm();
    const svc = await service(f.id, "Audit");
    expect(
      await saveDefaultCoverage(f.sales, f.id, { areaKeys: ["dubai"], modes: ["remote"], freeZoneIds: [] }),
    ).toEqual({ ok: false, reason: "forbidden" });
    expect(await saveServiceCoverageSet(f.sales, f.id, svc, ["dubai"])).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });

  it("refuses another firm's service and an area key that is not a chip", async () => {
    const mine = await firm();
    const theirs = await firm();
    const theirService = await service(theirs.id, "Theirs");
    expect(await saveServiceCoverageSet(mine.owner, mine.id, theirService, ["dubai"])).toEqual({
      ok: false,
      reason: "not_found",
    });
    const mineService = await service(mine.id, "Mine");
    expect(await saveServiceCoverageSet(mine.owner, mine.id, mineService, ["area:not-a-chip"])).toEqual({
      ok: false,
      reason: "unknown_area",
    });
  });
});
