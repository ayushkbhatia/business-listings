import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { coverageCheck, coverageStateFor, setCoverageArea } from "@/lib/onboarding/coverage";
import {
  resetServiceCoverage,
  serviceCoverageFor,
  setServiceCoverageArea,
} from "@/lib/services/coverage";

/**
 * Board `3c-s` — one service's own coverage, against a database.
 *
 * `effectiveCoverage` has been unit-tested since `1g-s` and its interesting
 * branch was unreachable: nothing could write a row that belonged to a
 * service. These are the facts a pure test cannot reach — that the four
 * partial unique indexes let a business and one of its services both claim
 * Dubai, that a double click is a no-op rather than a 500, that deleting a
 * service takes its narrowing with it rather than promoting it into the
 * default, and that every reader which means *the business default* still
 * means it now that the table holds two kinds of row.
 */

const PREFIX = "cov-3cs-";

let categoryId: string;
let dubaiAreaId: string;
const made: string[] = [];

let seq = 0;
const stamp = () => `${Date.now().toString(36)}${(seq += 1)}`;

async function makeSeller(): Promise<string> {
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
      sellsKind: "services",
      deliveryModes: ["at_client_site"],
      publishedAt: new Date(),
    },
    select: { id: true },
  });
  made.push(business.id);
  return business.id;
}

async function makeService(businessId: string, name = "Statutory audit"): Promise<string> {
  const mark = stamp();
  const service = await prisma.service.create({
    data: { businessId, categoryId, name, slug: `${PREFIX}${mark}` },
    select: { id: true },
  });
  return service.id;
}

beforeAll(async () => {
  const category = await prisma.category.findFirstOrThrow({ select: { id: true } });
  categoryId = category.id;

  const dubai = await prisma.area.findFirstOrThrow({
    where: { emirate: "dubai", isFreeZone: false, searchedAsEmirate: false },
    orderBy: { name: "asc" },
    select: { id: true },
  });
  dubaiAreaId = dubai.id;
});

afterAll(async () => {
  await prisma.serviceCoverage.deleteMany({ where: { businessId: { in: made } } });
  await prisma.service.deleteMany({ where: { businessId: { in: made } } });
  await prisma.business.deleteMany({ where: { id: { in: made } } });
});

describe("inheritance, and that it is resolved rather than copied", () => {
  it("a service with no rows of its own is shown the firm's coverage", async () => {
    const businessId = await makeSeller();
    await setCoverageArea(businessId, { emirate: "dubai", areaId: null }, true);
    await setCoverageArea(businessId, { emirate: "sharjah", areaId: null }, true);
    const serviceId = await makeService(businessId);

    const state = await serviceCoverageFor(businessId, serviceId);
    expect(state).not.toBeNull();
    expect(state!.narrowed).toBe(false);
    expect(state!.chips.every((chip) => !chip.on)).toBe(true);
    expect(state!.inherited).toEqual(expect.arrayContaining(["Dubai", "Sharjah"]));
    expect(state!.effective).toEqual(expect.arrayContaining(["Dubai", "Sharjah"]));
  });

  it("widening the firm's coverage reaches an inheriting service with no second write", async () => {
    const businessId = await makeSeller();
    await setCoverageArea(businessId, { emirate: "dubai", areaId: null }, true);
    const serviceId = await makeService(businessId);

    const before = await serviceCoverageFor(businessId, serviceId);
    expect(before!.effective).toEqual(["Dubai"]);

    await setCoverageArea(businessId, { emirate: "ajman", areaId: null }, true);

    const after = await serviceCoverageFor(businessId, serviceId);
    expect(after!.effective).toEqual(expect.arrayContaining(["Dubai", "Ajman"]));
    // And nothing was stamped onto the service to make that happen.
    expect(await prisma.serviceCoverage.count({ where: { serviceId } })).toBe(0);
  });

  it("one tick narrows all the way, and the firm's default is untouched", async () => {
    const businessId = await makeSeller();
    await setCoverageArea(businessId, { emirate: "dubai", areaId: null }, true);
    await setCoverageArea(businessId, { emirate: "sharjah", areaId: null }, true);
    const serviceId = await makeService(businessId);

    const write = await setServiceCoverageArea(
      businessId,
      serviceId,
      { emirate: "dubai", areaId: null },
      true,
    );
    expect(write).toMatchObject({ ok: true, narrowed: true, effective: ["Dubai"] });

    const state = await serviceCoverageFor(businessId, serviceId);
    expect(state!.effective).toEqual(["Dubai"]);
    // The firm still works in both. Narrowing one service is not an edit of
    // the listing — B6's whole point.
    expect(state!.inherited).toEqual(expect.arrayContaining(["Dubai", "Sharjah"]));
    expect(
      await prisma.serviceCoverage.count({ where: { businessId, serviceId: null } }),
    ).toBe(2);
  });

  it("unticking the last row is the way back to inheriting", async () => {
    const businessId = await makeSeller();
    await setCoverageArea(businessId, { emirate: "dubai", areaId: null }, true);
    await setCoverageArea(businessId, { emirate: "sharjah", areaId: null }, true);
    const serviceId = await makeService(businessId);

    await setServiceCoverageArea(businessId, serviceId, { emirate: "dubai", areaId: null }, true);
    const back = await setServiceCoverageArea(
      businessId,
      serviceId,
      { emirate: "dubai", areaId: null },
      false,
    );

    expect(back).toMatchObject({ ok: true, narrowed: false });
    expect(back.ok && back.effective).toEqual(expect.arrayContaining(["Dubai", "Sharjah"]));
  });

  it("`Use our coverage` clears every own row at once", async () => {
    const businessId = await makeSeller();
    await setCoverageArea(businessId, { emirate: "dubai", areaId: null }, true);
    const serviceId = await makeService(businessId);

    await setServiceCoverageArea(businessId, serviceId, { emirate: "ajman", areaId: null }, true);
    await setServiceCoverageArea(businessId, serviceId, { emirate: "sharjah", areaId: null }, true);
    expect(await prisma.serviceCoverage.count({ where: { serviceId } })).toBe(2);

    const reset = await resetServiceCoverage(businessId, serviceId);
    expect(reset).toMatchObject({ ok: true, narrowed: false, effective: ["Dubai"] });
    expect(await prisma.serviceCoverage.count({ where: { serviceId } })).toBe(0);
  });
});

describe("what the indexes and the foreign key hold", () => {
  it("a business and one of its services can both claim Dubai", async () => {
    const businessId = await makeSeller();
    await setCoverageArea(businessId, { emirate: "dubai", areaId: null }, true);
    const serviceId = await makeService(businessId);

    const write = await setServiceCoverageArea(
      businessId,
      serviceId,
      { emirate: "dubai", areaId: null },
      true,
    );
    expect(write.ok).toBe(true);
    expect(await prisma.serviceCoverage.count({ where: { businessId, emirate: "dubai" } })).toBe(2);
  });

  it("two services of one firm can each claim Dubai", async () => {
    const businessId = await makeSeller();
    const audit = await makeService(businessId, "Statutory audit");
    const desk = await makeService(businessId, "On-site IT desk");

    expect(
      (await setServiceCoverageArea(businessId, audit, { emirate: "dubai", areaId: null }, true)).ok,
    ).toBe(true);
    expect(
      (await setServiceCoverageArea(businessId, desk, { emirate: "dubai", areaId: null }, true)).ok,
    ).toBe(true);
    expect(await prisma.serviceCoverage.count({ where: { businessId, emirate: "dubai" } })).toBe(2);
  });

  it("a double click is a no-op rather than a unique violation", async () => {
    const businessId = await makeSeller();
    const serviceId = await makeService(businessId);
    const scope = { emirate: "dubai", areaId: dubaiAreaId };

    await setServiceCoverageArea(businessId, serviceId, scope, true);
    await setServiceCoverageArea(businessId, serviceId, scope, true);

    expect(await prisma.serviceCoverage.count({ where: { serviceId } })).toBe(1);
  });

  it("deleting the service takes its narrowing with it, and never widens the firm", async () => {
    const businessId = await makeSeller();
    await setCoverageArea(businessId, { emirate: "dubai", areaId: null }, true);
    const serviceId = await makeService(businessId);
    await setServiceCoverageArea(businessId, serviceId, { emirate: "ajman", areaId: null }, true);

    await prisma.service.delete({ where: { id: serviceId } });

    // `SET NULL` here would have promoted Ajman into the firm's default —
    // deleting a service would widen what the listing claims.
    const rows = await prisma.serviceCoverage.findMany({
      where: { businessId },
      select: { emirate: true, serviceId: true },
    });
    expect(rows).toEqual([{ emirate: "dubai", serviceId: null }]);
  });

  it("another firm's service is refused before anything is written", async () => {
    const mine = await makeSeller();
    const theirs = await makeSeller();
    const theirService = await makeService(theirs);

    const write = await setServiceCoverageArea(
      mine,
      theirService,
      { emirate: "dubai", areaId: null },
      true,
    );
    expect(write).toEqual({ ok: false, reason: "not_found" });
    expect(await prisma.serviceCoverage.count({ where: { serviceId: theirService } })).toBe(0);
  });

  it("an area that is not on the list is refused", async () => {
    const businessId = await makeSeller();
    const serviceId = await makeService(businessId);

    const write = await setServiceCoverageArea(
      businessId,
      serviceId,
      { emirate: "dubai", areaId: "area-that-does-not-exist" },
      true,
    );
    expect(write).toEqual({ ok: false, reason: "unknown_area" });
  });
});

describe("every reader that means the business default still means it", () => {
  it("the publish gate is not satisfied by one narrowed service", async () => {
    const businessId = await makeSeller();
    const serviceId = await makeService(businessId);
    await setServiceCoverageArea(businessId, serviceId, { emirate: "dubai", areaId: null }, true);

    const gate = await coverageCheck(businessId);
    expect(gate.ready).toBe(false);
    expect(gate.missing).toContain("coverage_area");
  });

  it("the coverage step's chips do not light up from a service's own row", async () => {
    const businessId = await makeSeller();
    const serviceId = await makeService(businessId);
    await setServiceCoverageArea(businessId, serviceId, { emirate: "dubai", areaId: null }, true);

    const state = await coverageStateFor(businessId);
    expect(state).not.toBeNull();
    expect(state!.chips.filter((chip) => chip.on)).toEqual([]);
    expect(state!.ready).toBe(false);
  });

  it("clearing the firm's Dubai chip leaves a service's own Dubai row alone", async () => {
    const businessId = await makeSeller();
    await setCoverageArea(businessId, { emirate: "dubai", areaId: null }, true);
    const serviceId = await makeService(businessId);
    await setServiceCoverageArea(businessId, serviceId, { emirate: "dubai", areaId: null }, true);

    await setCoverageArea(businessId, { emirate: "dubai", areaId: null }, false);

    expect(
      await prisma.serviceCoverage.count({ where: { businessId, serviceId: null } }),
    ).toBe(0);
    expect(await prisma.serviceCoverage.count({ where: { serviceId } })).toBe(1);
  });
});
