import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  chipKey,
  coverageCheck,
  coverageStateFor,
  selectAllCoverage,
  setCoverageArea,
  setDeliveryModes,
  setFreeZone,
} from "@/lib/onboarding/coverage";
import { goLive } from "@/lib/onboarding/service";
import { EMIRATES } from "@/lib/uae";

/**
 * Board `2d-s` — the coverage step, against a database.
 *
 * What a unit test cannot reach: that Al Ain is stored under Abu Dhabi rather
 * than as an eighth emirate, that the partial unique indexes make a double
 * click a no-op rather than a 500, that the publish gate lets a firm with no
 * branch through and still refuses one with no coverage, and that a business
 * switching kind keeps everything it had.
 */

const PREFIX = "cov-2ds-";

let categoryId: string;
let areaId: string;
let alAinId: string;
let freeZoneId: string;
let notAFreeZoneId: string;
const made: string[] = [];

let seq = 0;
const stamp = () => `${Date.now().toString(36)}${(seq += 1)}`;

async function makeSeller(fields?: {
  sellsKind?: "goods" | "services" | "both" | "unset";
  withBranch?: boolean;
  published?: boolean;
}): Promise<string> {
  const mark = stamp();
  const business = await prisma.business.create({
    data: {
      displayName: `${PREFIX}${mark}`,
      tradeName: `${PREFIX}${mark} LLC`,
      slug: `${PREFIX}${mark}`,
      licenceNumber: `DED-C${mark.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
      primaryCategoryId: categoryId,
      claimStatus: "claimed",
      sellsKind: fields?.sellsKind ?? "services",
      publishedAt: fields?.published === false ? null : new Date(),
      ...(fields?.withBranch
        ? {
            locations: {
              create: {
                type: "head_office",
                emirate: "dubai",
                areaId,
                addressLine: "Office 1204, Bay Square Building 3",
                phone: "+97143456789",
                lat: 25.1852,
                lng: 55.2744,
                geocodePrecision: "exact",
              },
            },
          }
        : {}),
    },
    select: { id: true },
  });
  made.push(business.id);
  return business.id;
}

beforeAll(async () => {
  const category = await prisma.category.findFirstOrThrow({ select: { id: true } });
  categoryId = category.id;

  const dubai = await prisma.area.findFirstOrThrow({
    where: { emirate: "dubai", isFreeZone: false },
    select: { id: true },
  });
  areaId = dubai.id;
  notAFreeZoneId = dubai.id;

  const alAin = await prisma.area.findFirstOrThrow({
    where: { searchedAsEmirate: true },
    select: { id: true },
  });
  alAinId = alAin.id;

  const zone = await prisma.area.findFirstOrThrow({
    where: { isFreeZone: true, publishedAt: { not: null } },
    orderBy: { name: "asc" },
    select: { id: true },
  });
  freeZoneId = zone.id;
});

afterAll(async () => {
  await prisma.freeZoneRegistration.deleteMany({ where: { businessId: { in: made } } });
  await prisma.serviceCoverage.deleteMany({ where: { businessId: { in: made } } });
  await prisma.location.deleteMany({ where: { businessId: { in: made } } });
  await prisma.business.deleteMany({ where: { id: { in: made } } });
});

describe("the taxonomy this screen picks from", () => {
  it("offers Al Ain beside the seven and keeps the enum at seven — AC4", async () => {
    const id = await makeSeller();
    const state = await coverageStateFor(id);
    expect(state).not.toBeNull();

    const labels = state!.chips.map((chip) => chip.label);
    expect(labels).toContain("Al Ain");
    expect(labels.length).toBe(EMIRATES.length + 1);

    // And it is stored as an area under Abu Dhabi, never as an emirate value.
    const alAin = state!.chips.find((chip) => chip.label === "Al Ain");
    expect(alAin?.scope).toEqual({ emirate: "abu_dhabi", areaId: alAinId });
  });

  it("holds more than forty free zones, which is what the screen says", async () => {
    /*
       The list was four — enough for a toggle that filters a warehouse's
       address, and nowhere near enough for a picker a firm uses to name the
       zones it is approved to work in. The screen counts the rows rather than
       claiming a number, so this is the assertion that keeps the sentence true.
    */
    const id = await makeSeller();
    const state = await coverageStateFor(id);
    expect(state!.freeZones.length).toBeGreaterThan(40);
  });

  it("keeps free zones out of the emirate picker — AC5", async () => {
    const id = await makeSeller();
    const state = await coverageStateFor(id);
    const zoneIds = new Set(state!.freeZones.map((zone) => zone.id));
    expect(state!.chips.some((chip) => chip.scope.areaId && zoneIds.has(chip.scope.areaId))).toBe(
      false,
    );
  });
});

describe("claiming areas", () => {
  it("writes Al Ain with emirate = abu_dhabi — B3", async () => {
    const id = await makeSeller();
    await setCoverageArea(id, { emirate: "abu_dhabi", areaId: alAinId }, true);

    const rows = await prisma.serviceCoverage.findMany({
      where: { businessId: id },
      select: { emirate: true, areaId: true },
    });
    expect(rows).toEqual([{ emirate: "abu_dhabi", areaId: alAinId }]);
  });

  it("reads the emirate from the area rather than from the request", async () => {
    /*
       A form that said Al Ain is in Dubai would otherwise be stored exactly
       that way and be wrong in every facet for ever. The same rule `Location`
       and `BusinessCoverage` follow, written in one place.
    */
    const id = await makeSeller();
    await setCoverageArea(id, { emirate: "dubai", areaId: alAinId }, true);
    const row = await prisma.serviceCoverage.findFirstOrThrow({
      where: { businessId: id },
      select: { emirate: true },
    });
    expect(row.emirate).toBe("abu_dhabi");
  });

  it("treats a second click on the same chip as a no-op, not an error", async () => {
    // The two partial unique indexes are what make this true under a race;
    // `skipDuplicates` is what makes it quiet.
    const id = await makeSeller();
    await setCoverageArea(id, { emirate: "dubai", areaId: null }, true);
    const again = await setCoverageArea(id, { emirate: "dubai", areaId: null }, true);
    expect(again.ok).toBe(true);
    expect(await prisma.serviceCoverage.count({ where: { businessId: id } })).toBe(1);
  });

  it("refuses an area that is not in the taxonomy", async () => {
    const id = await makeSeller();
    const result = await setCoverageArea(id, { emirate: "dubai", areaId: "not-an-area" }, true);
    expect(result).toEqual({ ok: false, reason: "unknown_area" });
  });

  it("takes a chip off again", async () => {
    const id = await makeSeller();
    await setCoverageArea(id, { emirate: "sharjah", areaId: null }, true);
    await setCoverageArea(id, { emirate: "sharjah", areaId: null }, false);
    expect(await prisma.serviceCoverage.count({ where: { businessId: id } })).toBe(0);
  });

  it("selects all eight and stays at eight when pressed twice — Q1", async () => {
    const id = await makeSeller();
    await selectAllCoverage(id);
    const first = await prisma.serviceCoverage.count({ where: { businessId: id } });
    await selectAllCoverage(id);
    expect(first).toBe(EMIRATES.length + 1);
    expect(await prisma.serviceCoverage.count({ where: { businessId: id } })).toBe(first);
  });

  it("never meters coverage against the plan — AC10", async () => {
    /*
       A Free-plan practice covering all eight is not a plan violation. It is a
       claim buyers can judge, and `Plan.locationLimit` has nothing to say about
       it — the seller here is on no plan at all.
    */
    const id = await makeSeller();
    const result = await selectAllCoverage(id);
    expect(result.ok).toBe(true);
    const state = await coverageStateFor(id);
    expect(state!.chips.every((chip) => chip.on)).toBe(true);
  });
});

describe("free-zone registrations — B4", () => {
  it("records one, and refuses an area that is not a free zone", async () => {
    const id = await makeSeller();
    expect((await setFreeZone(id, freeZoneId, true)).ok).toBe(true);
    expect(await setFreeZone(id, notAFreeZoneId, true)).toEqual({
      ok: false,
      reason: "not_a_free_zone",
    });
    expect(await setFreeZone(id, "nope", true)).toEqual({ ok: false, reason: "unknown_area" });
  });

  it("is orthogonal to coverage — a zone claims no area", async () => {
    // A firm can be DMCC-approved and cover only Dubai; a firm can cover all
    // seven and be approved nowhere. So a registration writes no coverage row.
    const id = await makeSeller();
    await setFreeZone(id, freeZoneId, true);
    expect(await prisma.serviceCoverage.count({ where: { businessId: id } })).toBe(0);
  });

  it("takes one off again, and a second add is a no-op", async () => {
    const id = await makeSeller();
    await setFreeZone(id, freeZoneId, true);
    await setFreeZone(id, freeZoneId, true);
    expect(await prisma.freeZoneRegistration.count({ where: { businessId: id } })).toBe(1);
    await setFreeZone(id, freeZoneId, false);
    expect(await prisma.freeZoneRegistration.count({ where: { businessId: id } })).toBe(0);
  });
});

describe("delivery modes", () => {
  it("replaces the set and puts it in the screen's own order", async () => {
    const id = await makeSeller();
    await setDeliveryModes(id, ["at_client_site", "remote"]);
    const row = await prisma.business.findUniqueOrThrow({
      where: { id },
      select: { deliveryModes: true },
    });
    expect(row.deliveryModes).toEqual(["remote", "at_client_site"]);
  });

  it("accepts an empty set, because that is a state a seller can be in", async () => {
    const id = await makeSeller();
    await setDeliveryModes(id, ["remote"]);
    expect((await setDeliveryModes(id, [])).ok).toBe(true);
    const row = await prisma.business.findUniqueOrThrow({
      where: { id },
      select: { deliveryModes: true },
    });
    expect(row.deliveryModes).toEqual([]);
  });

  it("refuses a mode that is not one of the three", async () => {
    const id = await makeSeller();
    expect(await setDeliveryModes(id, ["by_carrier_pigeon"])).toEqual({
      ok: false,
      reason: "unknown_mode",
    });
  });
});

describe("the publish gate — B2, AC3", () => {
  it("lets a services listing with no branch at all go live", async () => {
    /*
       The defect this board exists to prevent. `2d` gates publish on `lat`/
       `lng`; carried across unchanged, a consultancy — which has no gate to pin
       — could never publish, and nobody would be able to say why.
    */
    const id = await makeSeller({ published: false, withBranch: false });
    await setDeliveryModes(id, ["remote"]);
    await setCoverageArea(id, { emirate: "dubai", areaId: null }, true);

    const result = await goLive(id);
    expect(result.ok).toBe(true);

    const row = await prisma.business.findUniqueOrThrow({
      where: { id },
      select: { publishedAt: true },
    });
    expect(row.publishedAt).not.toBeNull();
  });

  it("refuses a services listing with no mode, and names which half is missing", async () => {
    const id = await makeSeller({ published: false, withBranch: false });
    await setCoverageArea(id, { emirate: "dubai", areaId: null }, true);

    expect(await coverageCheck(id)).toEqual({ ready: false, missing: ["delivery_mode"] });
    expect((await goLive(id)).ok).toBe(false);
  });

  it("refuses a services listing with no area", async () => {
    const id = await makeSeller({ published: false, withBranch: false });
    await setDeliveryModes(id, ["remote"]);

    expect(await coverageCheck(id)).toEqual({ ready: false, missing: ["coverage_area"] });
    expect((await goLive(id)).ok).toBe(false);
  });

  it("still requires a branch of a goods listing", async () => {
    // AC1's other half: nothing about this board changes what a goods seller
    // has to do, and all 123 live businesses are goods or unset.
    const id = await makeSeller({ sellsKind: "goods", published: false, withBranch: false });
    expect((await goLive(id)).ok).toBe(false);
  });

  it("asks a `both` listing for both — B7", async () => {
    const id = await makeSeller({ sellsKind: "both", published: false, withBranch: true });
    // The branch is there, so the refusal can only be the coverage half.
    expect((await goLive(id)).ok).toBe(false);

    await setDeliveryModes(id, ["at_our_office"]);
    await setCoverageArea(id, { emirate: "dubai", areaId: null }, true);
    expect((await goLive(id)).ok).toBe(true);
  });
});

describe("nothing is converted — AC9", () => {
  it("keeps a business's branches when it is a services seller", async () => {
    /*
       The same no-conversion rule as `4d-s` B5, `2b-s` B5 and `2c-s` B5. A
       trading company that becomes a consultancy keeps its addresses; they are
       not rendered on this step and they are not deleted by it.
    */
    const id = await makeSeller({ sellsKind: "services", withBranch: true });
    await setDeliveryModes(id, ["remote"]);
    await selectAllCoverage(id);

    expect(await prisma.location.count({ where: { businessId: id } })).toBe(1);
  });

  it("keeps a services seller's coverage when it goes back to goods", async () => {
    const id = await makeSeller({ sellsKind: "services", withBranch: true });
    await setDeliveryModes(id, ["remote"]);
    await setCoverageArea(id, { emirate: "dubai", areaId: null }, true);

    await prisma.business.update({ where: { id }, data: { sellsKind: "goods" } });

    expect(await prisma.serviceCoverage.count({ where: { businessId: id } })).toBe(1);
    const row = await prisma.business.findUniqueOrThrow({
      where: { id },
      select: { deliveryModes: true },
    });
    expect(row.deliveryModes).toEqual(["remote"]);
  });
});

describe("what the screen reads", () => {
  it("fills the registered-office card from the licensed branch, read-only", async () => {
    const id = await makeSeller({ withBranch: true });
    const state = await coverageStateFor(id);
    expect(state!.registeredOffice?.addressLine).toBe("Office 1204, Bay Square Building 3");
    expect(state!.registeredOffice?.emirate).toBe("dubai");
  });

  it("says so rather than inventing one when there is no branch", async () => {
    const id = await makeSeller({ withBranch: false });
    const state = await coverageStateFor(id);
    expect(state!.registeredOffice).toBeNull();
  });

  it("lists a coverage row narrower than the eight chips instead of dropping it", async () => {
    /*
       `3c-s` will write finer default rows from the dashboard. A screen that
       renders eight chips and silently drops a ninth claim on save would be a
       screen that deletes work it never showed anybody, so the extras are
       listed read-only and the chip writer touches one row at a time.
    */
    const id = await makeSeller();
    await setCoverageArea(id, { emirate: "dubai", areaId }, true);
    const state = await coverageStateFor(id);

    expect(state!.chips.every((chip) => !chip.on)).toBe(true);
    expect(state!.otherScopes).toHaveLength(1);
    expect(state!.otherScopes[0]!.label).toContain("Dubai");

    // And it counts toward the gate, because it is real coverage.
    await setDeliveryModes(id, ["remote"]);
    expect((await coverageCheck(id)).ready).toBe(true);
  });

  it("keys every chip uniquely, so a click cannot hit the wrong row", async () => {
    const id = await makeSeller();
    const state = await coverageStateFor(id);
    expect(new Set(state!.chips.map((chip) => chip.key)).size).toBe(state!.chips.length);
    expect(chipKey({ emirate: "abu_dhabi", areaId: alAinId })).not.toBe(
      chipKey({ emirate: "abu_dhabi", areaId: null }),
    );
  });
});
