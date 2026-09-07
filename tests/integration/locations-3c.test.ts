import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { getLocationsBoard } from "@/lib/db/queries/locations";
import {
  addCoverage,
  clearPin,
  deleteBranch,
  hideConsequence,
  removeCoverage,
  setBranchVisibility,
  setPin,
} from "@/lib/locations/service";
import { nearestKm } from "@/lib/geo/distance";
import { measurable } from "@/lib/locations/branch";
import type { Actor, Role } from "@/lib/auth/roles";
import type { Emirate, LocationType } from "@/lib/db/generated/enums";

/**
 * Board 3c — the locations manager.
 *
 * The criteria a unit test cannot reach: what the constraint actually refuses,
 * what a hide costs before it happens, and whether a supplier whose every pin
 * is approximate can still be ranked by distance.
 */

const PREFIX = "l3c-";
const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });
/* The words the screen resolves. Identity-ish here: this file is about what the
   query selects and derives, not about the catalogue. */
const labels = {
  type: (type: LocationType) => type.replace("_", " "),
  scope: (row: { emirate: Emirate; areaName: string | null }) => row.areaName ?? row.emirate,
  promise: (hours: number) => `${hours}h`,
};

let areaIds: { id: string; emirate: Emirate; lat: number | null; lng: number | null }[];
let categoryId: string;
let seq = 0;

async function removeFixtures() {
  const ours = await prisma.business.findMany({
    where: { slug: { startsWith: PREFIX } },
    select: { id: true },
  });
  const ids = ours.map((row) => row.id);
  if (ids.length === 0) return;
  await prisma.listingRevision.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.businessCoverage.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.location.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.user.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.business.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  areaIds = await prisma.area.findMany({
    orderBy: { slug: "asc" },
    take: 4,
    select: { id: true, emirate: true, lat: true, lng: true },
  });
  categoryId = (
    await prisma.category.findFirstOrThrow({
      where: { children: { none: {} } },
      select: { id: true },
    })
  ).id;
  await removeFixtures();
});

afterAll(removeFixtures);

interface BranchSeed {
  type?: LocationType;
  area?: number;
  lat?: number | null;
  lng?: number | null;
  precision?: "exact" | "approximate" | null;
  published?: boolean;
  everPublished?: boolean;
}

async function supplier(branches: readonly BranchSeed[]) {
  seq += 1;
  const stamp = `${Date.now()}${String(seq).padStart(3, "0")}`;
  const business = await prisma.business.create({
    data: {
      tradeName: `Branch Fixture ${stamp} LLC`,
      displayName: `Branch Fixture ${stamp}`,
      slug: `${PREFIX}${stamp}`,
      licenceNumber: `DED-${stamp.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
      primaryCategoryId: categoryId,
      claimStatus: "claimed",
      publishedAt: new Date(),
    },
    select: { id: true },
  });

  for (const [index, seed] of branches.entries()) {
    const area = areaIds[seed.area ?? index % areaIds.length]!;
    await prisma.location.create({
      data: {
        businessId: business.id,
        type: seed.type ?? "warehouse",
        emirate: area.emirate,
        areaId: area.id,
        addressLine: `Unit ${index + 1}`,
        lat: seed.lat ?? null,
        lng: seed.lng ?? null,
        geocodePrecision: seed.precision ?? null,
        published: seed.published ?? true,
        publishedAt: (seed.everPublished ?? seed.published ?? true) ? new Date() : null,
        hours: {},
      },
    });
  }

  const owner = await prisma.user.create({
    data: {
      id: crypto.randomUUID(),
      businessId: business.id,
      roles: ["seller_owner"],
      fullName: "S. Menon",
    },
    select: { id: true },
  });

  return {
    id: business.id,
    owner: { ...actor(owner.id, "seller_owner"), businessId: business.id },
  };
}

describe("the pin and its precision", () => {
  it("refuses coordinates with no precision, and a precision with no coordinates", async () => {
    const { id } = await supplier([{}]);
    const area = areaIds[0]!;

    /*
       `location_precision_matches_pin`. The pair is the whole point of the
       column: "missing" is `lat IS NULL`, so a row carrying coordinates and no
       precision would be one board 3c's table could not describe.
    */
    await expect(
      prisma.location.create({
        data: {
          businessId: id,
          type: "depot",
          emirate: area.emirate,
          areaId: area.id,
          addressLine: "Unconstrained",
          lat: 25.1,
          lng: 55.2,
          hours: {},
        },
      }),
    ).rejects.toThrow(/location_precision_matches_pin/);

    await expect(
      prisma.location.create({
        data: {
          businessId: id,
          type: "depot",
          emirate: area.emirate,
          areaId: area.id,
          addressLine: "Precision with no pin",
          geocodePrecision: "exact",
          hours: {},
        },
      }),
    ).rejects.toThrow(/location_precision_matches_pin/);
  });

  it("marks a pin the seller dragged as exact", async () => {
    const supplierRow = await supplier([{ lat: 25.3, lng: 55.4, precision: "approximate" }]);
    const branch = await prisma.location.findFirstOrThrow({
      where: { businessId: supplierRow.id },
      select: { id: true },
    });

    // `exact` is a record of who placed it, not a judgement about the numbers.
    // This is the only path where a person did.
    expect(await setPin(supplierRow.owner, supplierRow.id, branch.id, { lat: 25.1281, lng: 55.2296 }))
      .toEqual({ ok: true });

    const after = await prisma.location.findUniqueOrThrow({
      where: { id: branch.id },
      select: { lat: true, geocodePrecision: true },
    });
    expect(after.geocodePrecision).toBe("exact");
    expect(after.lat).toBe(25.1281);
  });

  it("refuses a pin outside the country rather than storing it", async () => {
    const supplierRow = await supplier([{}]);
    const branch = await prisma.location.findFirstOrThrow({
      where: { businessId: supplierRow.id },
      select: { id: true },
    });
    // London. A mis-drag or a bad paste, and storing it would put a marker on
    // board 1c's map where no supplier is.
    expect(await setPin(supplierRow.owner, supplierRow.id, branch.id, { lat: 51.5, lng: -0.12 }))
      .toEqual({ ok: false, error: "outside_uae" });
  });

  it("clears the precision with the coordinates", async () => {
    const supplierRow = await supplier([{ lat: 25.1, lng: 55.2, precision: "exact" }]);
    const branch = await prisma.location.findFirstOrThrow({
      where: { businessId: supplierRow.id },
      select: { id: true },
    });
    expect(await clearPin(supplierRow.owner, supplierRow.id, branch.id)).toEqual({ ok: true });

    const after = await prisma.location.findUniqueOrThrow({
      where: { id: branch.id },
      select: { lat: true, lng: true, geocodePrecision: true },
    });
    expect(after).toEqual({ lat: null, lng: null, geocodePrecision: null });
  });

  it("cannot touch another supplier's branch", async () => {
    const mine = await supplier([{}]);
    const theirs = await supplier([{}]);
    const branch = await prisma.location.findFirstOrThrow({
      where: { businessId: theirs.id },
      select: { id: true },
    });
    // Same answer as "no such branch", which is what somebody guessing ids
    // should be told.
    expect(await setPin(mine.owner, mine.id, branch.id, { lat: 25.1, lng: 55.2 }))
      .toEqual({ ok: false, error: "not_found" });
  });
});

describe("criterion 3 — only an exact pin is measured", () => {
  it("gives a supplier with only approximate pins no distance at all", () => {
    const origin = { lat: 25.2048, lng: 55.2708 };
    const approximate = [{ lat: 25.21, lng: 55.28, geocodePrecision: "approximate" as const }];

    // Without the filter this is about 1 km and ranks near the top. The
    // coordinates are the area's centre, so the kilometre is the distance to
    // the area and was being presented as the distance to the address.
    expect(nearestKm(origin, approximate)).toBeCloseTo(1, 0);
    expect(nearestKm(origin, measurable(approximate))).toBeNull();
  });

  it("measures the exact branch and ignores a nearer approximate one", () => {
    const origin = { lat: 25.2048, lng: 55.2708 };
    const branches = [
      { lat: 25.205, lng: 55.271, geocodePrecision: "approximate" as const },
      { lat: 25.33, lng: 55.39, geocodePrecision: "exact" as const },
    ];
    const km = nearestKm(origin, measurable(branches));
    expect(km).not.toBeNull();
    expect(km!).toBeGreaterThan(10);
  });
});

describe("criterion 1 — the three counts reconcile", () => {
  it("reads the board the render draws", async () => {
    const supplierRow = await supplier([
      { type: "head_office", area: 0, lat: 25.0, lng: 55.1, precision: "exact" },
      { type: "trade_counter", area: 1, lat: 25.1, lng: 55.2, precision: "exact" },
      { type: "depot", area: 2, lat: 25.3, lng: 55.4, precision: "approximate" },
      { type: "sales_office", area: 3, lat: 24.3, lng: 54.5, precision: "exact", published: false, everPublished: true },
      { type: "workshop", area: 0, published: false, everPublished: false },
    ]);

    const board = await getLocationsBoard(supplierRow.id, labels);

    expect(board.counts).toEqual({ total: 5, shown: 3, pinned: 4, missing: 1 });
    expect(board.branches.map((branch) => branch.status)).toEqual(
      expect.arrayContaining(["published", "hidden", "draft"]),
    );
    // Worst first, and the exact ones are absent so the card can be too.
    expect(board.issues.map((issue) => issue.state)).toEqual(["missing", "approximate"]);
  });
});

describe("criterion 2 and Q4 — what hiding costs", () => {
  it("names the areas the listing would drop off, before it happens", async () => {
    const supplierRow = await supplier([
      { area: 0, published: true },
      { area: 1, published: true },
      { area: 1, published: true },
    ]);
    const branches = await prisma.location.findMany({
      where: { businessId: supplierRow.id },
      orderBy: { addressLine: "asc" },
      select: { id: true, areaId: true },
    });

    // The only branch in area 0: hiding it takes the listing off that area page.
    const alone = branches.find((branch) => branch.areaId === areaIds[0]!.id)!;
    const first = await hideConsequence(supplierRow.id, [alone.id]);
    expect(first.areasLost).toHaveLength(1);
    expect(first.lastPublished).toBe(false);

    // One of two in area 1: the other still holds the area, so nothing is lost.
    const paired = branches.find((branch) => branch.areaId === areaIds[1]!.id)!;
    const second = await hideConsequence(supplierRow.id, [paired.id]);
    expect(second.areasLost).toEqual([]);

    // All three: every area, and the listing has no address left.
    const all = await hideConsequence(supplierRow.id, branches.map((branch) => branch.id));
    expect(all.areasLost).toHaveLength(2);
    expect(all.lastPublished).toBe(true);
  });

  it("hides without clearing the date, so the branch is hidden and not a draft", async () => {
    const supplierRow = await supplier([{ published: true }, { published: true }]);
    const branch = await prisma.location.findFirstOrThrow({
      where: { businessId: supplierRow.id },
      select: { id: true },
    });

    await setBranchVisibility(supplierRow.owner, supplierRow.id, branch.id, false);
    const board = await getLocationsBoard(supplierRow.id, labels);
    expect(board.branches.find((row) => row.id === branch.id)?.status).toBe("hidden");

    // And back again, without becoming a draft on the way through.
    await setBranchVisibility(supplierRow.owner, supplierRow.id, branch.id, true);
    await setBranchVisibility(supplierRow.owner, supplierRow.id, branch.id, false);
    const again = await getLocationsBoard(supplierRow.id, labels);
    expect(again.branches.find((row) => row.id === branch.id)?.status).toBe("hidden");
  });

  it("refuses to delete the last published branch", async () => {
    const supplierRow = await supplier([
      { published: true },
      { published: false, everPublished: false },
    ]);
    const live = await prisma.location.findFirstOrThrow({
      where: { businessId: supplierRow.id, published: true },
      select: { id: true },
    });

    // A published listing with no address is one a buyer cannot reach. Hiding
    // is the reversible way to take a branch out of circulation.
    expect(await deleteBranch(supplierRow.owner, supplierRow.id, live.id)).toEqual({
      ok: false,
      error: "last_published",
    });
  });
});

describe("criterion 6 — coverage comes from the taxonomy", () => {
  it("takes the emirate off the area rather than the caller", async () => {
    const supplierRow = await supplier([{}]);
    // A form claiming Fujairah beside a Dubai area id. The area wins, because
    // two fields that must agree are two fields that eventually will not.
    const area = areaIds.find((row) => row.emirate !== "fujairah")!;
    const result = await addCoverage(supplierRow.owner, supplierRow.id, {
      emirate: "fujairah",
      areaId: area.id,
      leadTimeHours: 24,
    });
    expect(result.ok).toBe(true);

    const rows = await prisma.businessCoverage.findMany({
      where: { businessId: supplierRow.id },
      select: { emirate: true },
    });
    expect(rows[0]!.emirate).toBe(area.emirate);
  });

  it("refuses an area id that is not in the table", async () => {
    const supplierRow = await supplier([{}]);
    // What a typed area looks like by the time it reaches the service.
    expect(
      await addCoverage(supplierRow.owner, supplierRow.id, {
        emirate: "dubai",
        areaId: "Al Quoz",
        leadTimeHours: 24,
      }),
    ).toEqual({ ok: false, error: "unknown_area" });
  });

  it("refuses a lead time the column would refuse", async () => {
    const supplierRow = await supplier([{}]);
    expect(
      await addCoverage(supplierRow.owner, supplierRow.id, {
        emirate: "dubai",
        areaId: null,
        leadTimeHours: -1,
      }),
    ).toEqual({ ok: false, error: "bad_lead_time" });
  });

  it("holds both scales at once, and each of them only once", async () => {
    const supplierRow = await supplier([{}]);
    const area = areaIds.find((row) => row.emirate === "dubai") ?? areaIds[0]!;

    expect(
      (
        await addCoverage(supplierRow.owner, supplierRow.id, {
          emirate: area.emirate,
          areaId: null,
          leadTimeHours: 48,
        })
      ).ok,
    ).toBe(true);
    // The finer promise inside it. Not a duplicate: this is what the two scales
    // exist for.
    expect(
      (
        await addCoverage(supplierRow.owner, supplierRow.id, {
          emirate: area.emirate,
          areaId: area.id,
          leadTimeHours: 0,
        })
      ).ok,
    ).toBe(true);
    // The same scope twice is what a seller produces by clicking it again.
    expect(
      await addCoverage(supplierRow.owner, supplierRow.id, {
        emirate: area.emirate,
        areaId: null,
        leadTimeHours: 24,
      }),
    ).toEqual({ ok: false, error: "already_covered" });

    const board = await getLocationsBoard(supplierRow.id, labels);
    expect(board.coverage).toHaveLength(2);
    // Broadest first.
    expect(board.coverage[0]!.areaId).toBeNull();

    await removeCoverage(supplierRow.owner, supplierRow.id, board.coverage[0]!.id);
    const after = await getLocationsBoard(supplierRow.id, labels);
    expect(after.coverage).toHaveLength(1);
  });

  it("refuses the same scope twice under a double submit, in the database", async () => {
    const supplierRow = await supplier([{}]);
    /*
       The service checks first so the seller gets a sentence. The two partial
       unique indexes are what make it true — Postgres treats NULLs as distinct
       in a unique index, so `(business, emirate, NULL)` would happily duplicate
       without the `WHERE area_id IS NULL` half.
    */
    await prisma.businessCoverage.create({
      data: { businessId: supplierRow.id, emirate: "ajman", areaId: null, leadTimeHours: 48 },
    });
    await expect(
      prisma.businessCoverage.create({
        data: { businessId: supplierRow.id, emirate: "ajman", areaId: null, leadTimeHours: 24 },
      }),
    ).rejects.toThrow();
  });
});
