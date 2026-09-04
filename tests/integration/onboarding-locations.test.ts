import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  addBranch,
  branchesWithHours,
  continueCheck,
  locationsStateFor,
  patchBranchField,
  pinBranch,
  removeBranch,
  saveBranchHours,
  setBranchRadius,
} from "@/lib/onboarding/locations";
import { RADIUS_MAX } from "@/lib/onboarding/branch-fields";
import { hoursInEffect, type WeekHours } from "@/lib/trade/hours";
import { openNow } from "@/lib/trade/open-now";
import { parseRamadanCalendar, readRamadanCalendar, RAMADAN_SETTING_KEY } from "@/lib/trade/ramadan-calendar";

/**
 * Board 2d, against a real database.
 *
 * The claims worth proving here are the ones about rows: that the emirate
 * cannot drift from the area, that a plan cap actually refuses a branch, that a
 * pin outside the country is not stored, and that the Ramadan calendar is a
 * setting rather than a constant.
 */

let seller: { id: string; slug: string };
/** A branch this file created, cleaned up whatever the assertions did. */
let made: string[] = [];

let dubaiArea: { id: string; emirate: string };
let sharjahArea: { id: string; emirate: string };

beforeAll(async () => {
  seller = await prisma.business.findFirstOrThrow({
    where: { claimStatus: "claimed", locations: { some: {} } },
    orderBy: { slug: "asc" },
    select: { id: true, slug: true },
  });

  dubaiArea = await prisma.area.findFirstOrThrow({
    where: { emirate: "dubai" },
    orderBy: { name: "asc" },
    select: { id: true, emirate: true },
  });
  sharjahArea = await prisma.area.findFirstOrThrow({
    where: { emirate: "sharjah" },
    orderBy: { name: "asc" },
    select: { id: true, emirate: true },
  });
});

afterEach(async () => {
  if (made.length > 0) {
    await prisma.location.deleteMany({ where: { id: { in: made }, businessId: seller.id } });
    made = [];
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** A throwaway branch belonging to the fixture seller. */
async function scratchBranch(): Promise<string> {
  const created = await prisma.location.create({
    data: {
      businessId: seller.id,
      areaId: dubaiArea.id,
      emirate: "dubai",
      type: "warehouse",
      addressLine: "",
      hours: {},
    },
    select: { id: true },
  });
  made.push(created.id);
  return created.id;
}

describe("criterion 6 — the area is a select, and the emirate follows it", () => {
  it("takes the emirate off the chosen area rather than from the caller", async () => {
    const id = await scratchBranch();
    const result = await patchBranchField(seller.id, id, "areaId", sharjahArea.id);

    expect(result.ok).toBe(true);
    const row = await prisma.location.findUniqueOrThrow({
      where: { id },
      select: { emirate: true, areaId: true },
    });
    // Two independent fields that must agree are two fields that eventually
    // will not. There is one, and the area is it.
    expect(row.areaId).toBe(sharjahArea.id);
    expect(row.emirate).toBe("sharjah");
  });

  it("refuses an area id that is not an area", async () => {
    const id = await scratchBranch();
    const result = await patchBranchField(seller.id, id, "areaId", "not-an-area");
    expect(result).toMatchObject({ ok: false, problem: { kind: "unknown_area" } });
  });
});

describe("scoping — a branch that is not yours", () => {
  it("cannot be patched by pointing an id at it", async () => {
    const other = await prisma.location.findFirstOrThrow({
      where: { businessId: { not: seller.id } },
      select: { id: true, addressLine: true },
    });

    const result = await patchBranchField(seller.id, other.id, "addressLine", "Somewhere else");
    expect(result).toMatchObject({ ok: false, problem: { kind: "not_found" } });

    const after = await prisma.location.findUniqueOrThrow({
      where: { id: other.id },
      select: { addressLine: true },
    });
    expect(after.addressLine).toBe(other.addressLine);
  });
});

describe("criterion 11 — the pin", () => {
  it("stores what the map handed back, rounded to six decimals", async () => {
    const id = await scratchBranch();
    const result = await pinBranch(seller.id, id, 25.128134567891, 55.229612345678);

    expect(result).toMatchObject({ ok: true, lat: 25.128135, lng: 55.229612 });
    const row = await prisma.location.findUniqueOrThrow({
      where: { id },
      select: { lat: true, lng: true },
    });
    expect(row.lat).toBe(25.128135);
    expect(row.lng).toBe(55.229612);
  });

  it("refuses a point outside the country rather than storing it", async () => {
    // A mis-drag or a bad paste. Stored, it would put this supplier's marker
    // in the North Sea on every search that draws a map.
    const id = await scratchBranch();
    const result = await pinBranch(seller.id, id, 51.5074, -0.1278);

    expect(result).toEqual({ ok: false, reason: "out_of_bounds" });
    const row = await prisma.location.findUniqueOrThrow({
      where: { id },
      select: { lat: true, lng: true },
    });
    expect(row.lat).toBeNull();
  });
});

describe("criterion 4 — what Continue checks", () => {
  it("names every branch that is not ready, and what each is missing", async () => {
    const id = await scratchBranch();
    const check = await continueCheck(seller.id);

    expect(check.ready).toBe(false);
    const blocked = check.blocking.find((entry) => entry.branchId === id);
    // Brand new: no address, no number, no pin. The area came with it.
    expect(blocked?.gaps).toEqual(["address", "contact", "pin"]);
  });

  it("passes once the branch has an address, a number and a pin", async () => {
    const id = await scratchBranch();
    await patchBranchField(seller.id, id, "addressLine", "Warehouse 7, 4B Street");
    await patchBranchField(seller.id, id, "phone", "04 340 6688");
    await pinBranch(seller.id, id, 25.1281, 55.2296);

    const check = await continueCheck(seller.id);
    expect(check.blocking.find((entry) => entry.branchId === id)).toBeUndefined();
  });

  it("does not ask for hours", async () => {
    // Criterion 5: a branch with none renders "Hours not provided" on 1f.
    const id = await scratchBranch();
    await patchBranchField(seller.id, id, "addressLine", "Warehouse 7, 4B Street");
    await patchBranchField(seller.id, id, "whatsapp", "055 704 1120");
    await pinBranch(seller.id, id, 25.1281, 55.2296);

    const row = await prisma.location.findUniqueOrThrow({
      where: { id },
      select: { hours: true },
    });
    expect(row.hours).toEqual({});

    const check = await continueCheck(seller.id);
    expect(check.blocking.find((entry) => entry.branchId === id)).toBeUndefined();
  });
});

describe("the phone fields", () => {
  it("stores WhatsApp in E.164 because that is what the link dials", async () => {
    const id = await scratchBranch();
    await patchBranchField(seller.id, id, "whatsapp", "055 704 1120");

    const row = await prisma.location.findUniqueOrThrow({
      where: { id },
      select: { whatsapp: true },
    });
    expect(row.whatsapp).toBe("+971557041120");
  });

  it("refuses a mobile in the landline field, and says which field is wrong", async () => {
    const id = await scratchBranch();
    const result = await patchBranchField(seller.id, id, "phone", "050 641 2288");
    expect(result).toMatchObject({
      ok: false,
      problem: { kind: "phone", field: "phone", problem: "not_a_landline" },
    });
  });
});

describe("the service radius", () => {
  it("holds the number inside a range the country makes meaningful", async () => {
    const id = await scratchBranch();
    await setBranchRadius(seller.id, id, 100_000);

    const row = await prisma.location.findUniqueOrThrow({
      where: { id },
      select: { serviceRadiusKm: true },
    });
    expect(row.serviceRadiusKm).toBe(RADIUS_MAX);
  });

  it("stores null for a branch that makes no delivery promise", async () => {
    const id = await scratchBranch();
    await setBranchRadius(seller.id, id, 40);
    await setBranchRadius(seller.id, id, null);

    const row = await prisma.location.findUniqueOrThrow({
      where: { id },
      select: { serviceRadiusKm: true },
    });
    // `coverageOf` on 1f reads null as "no card". Zero would be a claim.
    expect(row.serviceRadiusKm).toBeNull();
  });
});

describe("criteria 1 and 2 — the counter and the cap", () => {
  it("counts every branch against the plan's cap", async () => {
    const state = await locationsStateFor(seller.id);
    expect(state?.allowance.used).toBe(state?.branches.length);
    expect(state?.allowance.cap).not.toBeUndefined();
  });

  it("refuses a branch past the cap rather than creating one it will hide", async () => {
    /*
       `findFirstOrThrow`, not a silent `return`. A fixture that has gone is a
       test that reports green while asserting nothing, which is worse than one
       that fails — and Free caps at one location, so any Free listing with a
       branch is already at its cap.
    */
    const free = await prisma.business.findFirstOrThrow({
      where: { planId: "free", locations: { some: {} } },
      select: { id: true },
      orderBy: { slug: "asc" },
    });

    const before = await prisma.location.count({ where: { businessId: free.id } });
    const result = await addBranch(free.id, { areaId: dubaiArea.id });

    expect(result).toEqual({ ok: false, reason: "at_cap" });
    expect(await prisma.location.count({ where: { businessId: free.id } })).toBe(before);
  });

  it("names an upgrade that actually raises the cap", async () => {
    const free = await prisma.business.findFirstOrThrow({
      where: { planId: "free", locations: { some: {} } },
      select: { id: true },
      orderBy: { slug: "asc" },
    });

    const state = await locationsStateFor(free.id);
    expect(state?.allowance.canAddMore).toBe(false);
    // Never a plan whose cap is the same or lower — that is not an upgrade for
    // this resource, whatever it costs.
    expect(state?.upgrade?.cap === null || (state?.upgrade?.cap ?? 0) > 1).toBe(true);
  });
});

describe("removing a branch", () => {
  it("never removes the last one", async () => {
    /*
       A published listing with no address is a listing a buyer cannot visit, and
       it drops out of every area page silently. The screen offers no delete on a
       single branch; this is what makes that true rather than drawn.
    */
    const candidates = await prisma.business.findMany({
      where: { locations: { some: {} } },
      select: { id: true, locations: { select: { id: true } } },
      orderBy: { slug: "asc" },
      take: 200,
    });
    /*
       Filtered here rather than in the `where`, because a relation count is not
       something Prisma can filter on — and because a Free plan is not the test:
       a listing over its cap after a downgrade is ordinary, so "on Free" is not
       the same fact as "has one branch".
    */
    const target = candidates.find((row) => row.locations.length === 1);
    if (!target) throw new Error("the seed has no business with exactly one branch");

    const result = await removeBranch(target.id, target.locations[0]!.id);
    expect(result).toEqual({ ok: false, reason: "last_branch" });
    expect(await prisma.location.count({ where: { businessId: target.id } })).toBe(1);
  });
});

describe("criterion 17 — what copy-to-all would overwrite", () => {
  it("counts the other branches that already have hours", async () => {
    const id = await scratchBranch();
    const count = await branchesWithHours(seller.id, id);
    const others = await prisma.location.count({
      where: { businessId: seller.id, id: { not: id } },
    });
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(others);
  });

  it("does not count the branch being copied from", async () => {
    const id = await scratchBranch();
    await saveBranchHours(
      seller.id,
      { branchId: id },
      { mon: [{ open: "08:00", close: "17:00" }] },
      null,
      () => "unused",
    );
    const withSelf = await branchesWithHours(seller.id, id);
    const withoutSelf = await branchesWithHours(seller.id, "no-such-branch");
    expect(withoutSelf - withSelf).toBe(1);
  });
});

describe("criterion 14 — the Ramadan band never opens a shut day", () => {
  const RAMADAN = { all: [{ open: "09:00", close: "15:00" }] };

  it("re-times the open days and leaves the closed ones closed", async () => {
    const week: WeekHours = {
      sun: [{ open: "08:00", close: "18:00" }],
      mon: [{ open: "08:00", close: "18:00" }],
      sat: [],
    };
    const inRamadan = new Date("2026-03-01T09:00:00Z");
    const effect = hoursInEffect(week, RAMADAN, inRamadan);

    expect(effect.isRamadan).toBe(true);
    expect(effect.hours.sun).toEqual([{ open: "09:00", close: "15:00" }]);
    expect(effect.hours.sat).toEqual([]);
  });

  it("does not report a shut Saturday as open on the storefront", async () => {
    // The same rule one layer up, because 1f reads `openNow` rather than
    // `hoursInEffect`, and a rule proved only in the layer below it is a rule
    // one refactor away from being lost.
    const week: WeekHours = { sun: [{ open: "08:00", close: "18:00" }], sat: [] };
    // 2026-03-07 is a Saturday inside the 2026 window.
    const saturday = new Date("2026-03-07T10:00:00Z");
    const state = openNow(week, RAMADAN, saturday);
    expect(state.state).not.toBe("open");
  });
});

describe("criterion 15 — the Ramadan dates are a platform setting", () => {
  it("has a row, seeded by the migration", async () => {
    const row = await prisma.platformSetting.findUnique({
      where: { key: RAMADAN_SETTING_KEY },
      select: { value: true },
    });
    expect(row).not.toBeNull();
    expect(Object.keys(parseRamadanCalendar(row?.value)).length).toBeGreaterThan(0);
  });

  it("reads through to a calendar the pure functions accept", async () => {
    const calendar = await readRamadanCalendar();
    expect(calendar[2026]).toEqual({ from: "2026-02-17", to: "2026-03-19" });
  });

  it("drops a malformed year rather than the whole calendar", () => {
    const parsed = parseRamadanCalendar({
      2026: { from: "2026-02-17", to: "2026-03-19" },
      2027: { from: "2027-03-08", to: "2027-02-07" }, // backwards
      2028: { from: "nonsense", to: "2028-02-25" },
    });
    expect(Object.keys(parsed)).toEqual(["2026"]);
  });

  it("has no seller-writable path to it", async () => {
    /*
       Criterion 15 is a negative, so it is asserted as one. `PlatformSetting`
       has exactly one reader in this codebase and no writer at all — board 12h
       owns the writer, and it owes an audit row when it lands.
    */
    const calendar = await import("@/lib/trade/ramadan-calendar");
    const writers = Object.keys(calendar).filter((name) => /^(set|save|write|update)/.test(name));
    expect(writers).toEqual([]);
  });
});

describe("what the page reads", () => {
  it("reports the gaps per branch, so the screen can point at one", async () => {
    const id = await scratchBranch();
    const state = await locationsStateFor(seller.id);
    const branch = state?.branches.find((row) => row.id === id);

    expect(branch?.pinned).toBe(false);
    expect(branch?.gaps).toContain("pin");
    expect(state?.ready).toBe(false);
  });

  it("offers an area this business already sits in even when it is unpublished", async () => {
    const state = await locationsStateFor(seller.id);
    const used = new Set(state?.branches.map((branch) => branch.areaId));
    const offered = new Set(state?.areas.map((area) => area.id));
    // A branch whose area is missing from the select loses its address the next
    // time anything else on the card is saved.
    for (const areaId of used) expect(offered.has(areaId)).toBe(true);
  });
});
