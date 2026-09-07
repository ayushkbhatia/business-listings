import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { getHoursBoard, needsConfirming, ramadanCollisions } from "@/lib/db/queries/hours";
import {
  addClosure,
  confirmRamadanHours,
  copyHours,
  pickerBranches,
  saveBranchWeek,
  scheduleClosure,
} from "@/lib/hours/service";
import { rulingFor } from "@/lib/trade/closures";
import { openNow } from "@/lib/trade/open-now";
import type { Actor, Role } from "@/lib/auth/roles";
import type { LocationType } from "@/lib/db/generated/enums";
import type { WeekHours } from "@/lib/trade/hours";

/**
 * Board 3d — hours, holidays and Ramadan.
 *
 * The criteria a unit test cannot reach: what one save actually writes, what
 * the constraint refuses, and whether the precedence order survives the round
 * trip through the columns that hold it.
 */

const PREFIX = "h3d-";
const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });
/* The words the screen resolves. Identity-ish here: this file is about what
   the query selects and derives, not about the catalogue. */
const typeLabel = (type: LocationType) => type.replace("_", " ");

const WEEK: WeekHours = {
  sun: [],
  mon: [{ open: "08:00", close: "18:00" }],
  tue: [{ open: "08:00", close: "18:00" }],
  wed: [{ open: "08:00", close: "18:00" }],
  thu: [{ open: "08:00", close: "18:00" }],
  fri: [{ open: "08:00", close: "12:00" }, { open: "14:00", close: "18:00" }],
  sat: [],
};
const DEPOT_WEEK: WeekHours = { ...WEEK, mon: [{ open: "06:00", close: "14:00" }] };
const RAMADAN = { all: [{ open: "09:00", close: "15:00" }] };

let areaId: string;
let categoryId: string;
let seq = 0;

async function removeFixtures() {
  const ours = await prisma.business.findMany({
    where: { slug: { startsWith: PREFIX } },
    select: { id: true },
  });
  const ids = ours.map((row) => row.id);
  if (ids.length > 0) {
    await prisma.listingRevision.deleteMany({ where: { businessId: { in: ids } } });
    await prisma.locationClosure.deleteMany({ where: { location: { businessId: { in: ids } } } });
    await prisma.location.deleteMany({ where: { businessId: { in: ids } } });
    await prisma.user.deleteMany({ where: { businessId: { in: ids } } });
    await prisma.business.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.publicHoliday.deleteMany({ where: { name: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  areaId = (await prisma.area.findFirstOrThrow({ select: { id: true } })).id;
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
  hours?: WeekHours;
  ramadan?: object | null;
  confirmedYear?: number | null;
  published?: boolean;
  everPublished?: boolean;
}

async function supplier(branches: readonly BranchSeed[]) {
  seq += 1;
  const stamp = `${Date.now()}${String(seq).padStart(3, "0")}`;
  const business = await prisma.business.create({
    data: {
      tradeName: `Hours Fixture ${stamp} LLC`,
      displayName: `Hours Fixture ${stamp}`,
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

  const ids: string[] = [];
  for (const [index, seed] of branches.entries()) {
    const row = await prisma.location.create({
      data: {
        businessId: business.id,
        type: seed.type ?? "warehouse",
        emirate: "dubai",
        areaId,
        addressLine: `Unit ${index + 1}`,
        hours: (seed.hours ?? WEEK) as object,
        ...(seed.ramadan === undefined ? {} : seed.ramadan === null ? {} : { ramadanHours: seed.ramadan }),
        ramadanConfirmedYear: seed.confirmedYear ?? null,
        published: seed.published ?? true,
        publishedAt: (seed.everPublished ?? seed.published ?? true) ? new Date() : null,
      },
      select: { id: true },
    });
    ids.push(row.id);
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
    branchIds: ids,
    owner: { ...actor(owner.id, "seller_owner"), businessId: business.id },
  };
}

describe("criterion 1 — the save writes one branch", () => {
  it("leaves every other branch alone", async () => {
    const seller = await supplier([{ hours: WEEK }, { hours: DEPOT_WEEK }]);
    const [head, depot] = seller.branchIds;

    const changed: WeekHours = { ...WEEK, mon: [{ open: "07:00", close: "19:00" }] };
    expect(await saveBranchWeek(seller.owner, seller.id, { locationId: head!, hours: changed }))
      .toEqual({ ok: true, applied: 1 });

    const after = await prisma.location.findMany({
      where: { businessId: seller.id },
      select: { id: true, hours: true },
    });
    const depotHours = after.find((row) => row.id === depot)!.hours as WeekHours;
    // Board 3d's fifth correction is exactly this: a picker, a copy button and
    // a Save in one header is how a depot ends up with a head office's hours.
    expect(depotHours.mon).toEqual([{ open: "06:00", close: "14:00" }]);
  });

  it("cannot reach another supplier's branch", async () => {
    const mine = await supplier([{}]);
    const theirs = await supplier([{}]);
    expect(
      await saveBranchWeek(mine.owner, mine.id, {
        locationId: theirs.branchIds[0]!,
        hours: WEEK,
      }),
    ).toEqual({ ok: false, error: "not_found" });
  });
});

describe("criterion 2 — copying names its targets", () => {
  it("writes exactly the branches it was given, and no others", async () => {
    const seller = await supplier([{ hours: WEEK }, { hours: DEPOT_WEEK }, { hours: DEPOT_WEEK }]);
    const [head, depot, other] = seller.branchIds;

    expect(
      await copyHours(seller.owner, seller.id, {
        fromLocationId: head!,
        toLocationIds: [depot!],
      }),
    ).toEqual({ ok: true, applied: 1 });

    const after = await prisma.location.findMany({
      where: { businessId: seller.id },
      select: { id: true, hours: true },
    });
    expect((after.find((row) => row.id === depot)!.hours as WeekHours).mon).toEqual(WEEK.mon);
    // The third branch was not in the list the preview named, so it is untouched.
    expect((after.find((row) => row.id === other)!.hours as WeekHours).mon).toEqual(DEPOT_WEEK.mon);
  });

  it("does not carry the Ramadan confirmation across with the hours", async () => {
    /*
       A seller confirming the head office's Ramadan times has said something
       about the head office. Clearing board 3a's reminder for four branches
       nobody has looked at would be the reminder quietly lying.
    */
    const seller = await supplier([
      { ramadan: RAMADAN, confirmedYear: 2027 },
      { ramadan: RAMADAN, confirmedYear: null },
    ]);
    await copyHours(seller.owner, seller.id, {
      fromLocationId: seller.branchIds[0]!,
      toLocationIds: [seller.branchIds[1]!],
    });

    const target = await prisma.location.findUniqueOrThrow({
      where: { id: seller.branchIds[1]! },
      select: { ramadanConfirmedYear: true, ramadanHours: true },
    });
    expect(target.ramadanHours).toEqual(RAMADAN);
    expect(target.ramadanConfirmedYear).toBeNull();
  });
});

describe("criteria 3, 4 and 5 — whose dates, whose hours", () => {
  it("asks for a confirmation, and stops once it is given", async () => {
    const seller = await supplier([{ ramadan: RAMADAN, confirmedYear: 2026 }]);
    const board = await getHoursBoard(seller.id, typeLabel);
    const branch = board.branches[0]!;

    expect(board.ramadan).not.toBeNull();
    expect(needsConfirming(branch, board)).toBe(true);

    await confirmRamadanHours(seller.owner, seller.id, {
      locationId: seller.branchIds[0]!,
      year: board.ramadan!.year,
    });

    const after = await getHoursBoard(seller.id, typeLabel);
    expect(needsConfirming(after.branches[0]!, after)).toBe(false);
    expect(after.branches[0]!.ramadanConfirmedYear).toBe(board.ramadan!.year);
  });

  it("keeps carried-over hours in force while they are unconfirmed", async () => {
    /*
       Criterion 5. An unconfirmed Ramadan is not an unset one — the alternative
       is a listing that goes silent for a month.
    */
    const seller = await supplier([{ ramadan: RAMADAN, confirmedYear: null }]);
    const board = await getHoursBoard(seller.id, typeLabel);
    const branch = board.branches[0]!;

    expect(needsConfirming(branch, board)).toBe(true);

    /*
       A Monday inside the window, not its first day.

       The fixture is shut on Sundays and Saturdays, and a Ramadan block never
       opens a day the seller has switched off — so asserting on whichever
       weekday the window happens to start on tests the calendar rather than
       the rule.
    */
    const inRamadan = atNoon(nextMonday(board.ramadan!.from));
    const ruling = rulingFor(inRamadan, {
      hours: branch.hours,
      ramadanHours: branch.ramadanHours,
    });
    expect(ruling.kind).toBe("ramadan");
    expect(ruling.shifts).toEqual([{ open: "09:00", close: "15:00" }]);
  });

  it("carries the estimated flag on the platform's dates", async () => {
    const seller = await supplier([{}]);
    const board = await getHoursBoard(seller.id, typeLabel);
    // Every compiled entry is an astronomical estimate; only a platform row
    // that says `confirmed: true` is an announcement.
    expect(board.ramadan?.confirmed).toBe(false);
  });
});

describe("criteria 6 and 7 — the order, and the collision", () => {
  it("resolves a day that is both a holiday and Ramadan to the holiday", async () => {
    const seller = await supplier([{ ramadan: RAMADAN }]);
    const board = await getHoursBoard(seller.id, typeLabel);
    const window = board.ramadan!;

    // A holiday inside the platform's own Ramadan window.
    const inside = new Date(window.from.getTime() + 3 * 86_400_000);
    const holiday = await prisma.publicHoliday.create({
      data: {
        name: `${PREFIX}Clash`,
        startsOn: startOfDay(inside),
        endsOn: startOfDay(inside),
        confirmed: true,
      },
      select: { id: true, name: true, startsOn: true, endsOn: true, openFrom: true, openUntil: true, confirmed: true },
    });

    const branch = board.branches[0]!;
    const ruling = rulingFor(inside, {
      hours: branch.hours,
      ramadanHours: branch.ramadanHours,
      holidays: [holiday],
    });

    expect(ruling).toMatchObject({ kind: "holiday", alsoRamadan: true, shifts: [] });
    // And the screen is told, so it can say so on the row.
    expect(ramadanCollisions(branch, [holiday]).has(holiday.id)).toBe(true);
  });

  it("puts a scheduled closure above the holiday, through openNow", async () => {
    const seller = await supplier([{ ramadan: RAMADAN }]);
    const board = await getHoursBoard(seller.id, typeLabel);
    const branch = board.branches[0]!;

    // A Monday, so the standard week is open.
    const monday = nextMonday(new Date());
    const holiday = {
      id: "h",
      name: "National Day",
      startsOn: startOfDay(monday),
      endsOn: startOfDay(monday),
      openFrom: null,
      openUntil: null,
    };

    const withHoliday = openNow(branch.hours, branch.ramadanHours, atNoon(monday), undefined, {
      holidays: [holiday],
    });
    expect(withHoliday.state).toBe("closed");
    if (withHoliday.state === "closed") {
      expect(withHoliday.because).toEqual({ kind: "holiday", name: "National Day" });
    }

    const withClosure = openNow(branch.hours, branch.ramadanHours, atNoon(monday), undefined, {
      holidays: [holiday],
      temporaryClosure: {
        from: startOfDay(monday),
        until: startOfDay(monday),
        reason: "Roof repairs",
      },
    });
    expect(withClosure.state).toBe("closed");
    if (withClosure.state === "closed") {
      expect(withClosure.because).toEqual({ kind: "temporary_closure", name: "Roof repairs" });
    }
  });

  it("does not announce an opening on a day a holiday has closed", async () => {
    const seller = await supplier([{}]);
    const board = await getHoursBoard(seller.id, typeLabel);
    const branch = board.branches[0]!;

    // Sunday evening, with Monday and Tuesday shut for a holiday.
    const sunday = previousSunday(nextMonday(new Date()));
    const monday = new Date(sunday.getTime() + 86_400_000);
    const tuesday = new Date(sunday.getTime() + 2 * 86_400_000);

    const state = openNow(branch.hours, null, atNoon(sunday), undefined, {
      holidays: [
        {
          id: "h",
          name: "Eid",
          startsOn: startOfDay(monday),
          endsOn: startOfDay(tuesday),
          openFrom: null,
          openUntil: null,
        },
      ],
    });

    expect(state.state).toBe("closed");
    if (state.state === "closed") {
      // Wednesday, not Monday. "Opens 08:00" on the first morning of Eid is a
      // buyer driving to a closed gate.
      expect(state.opensDay).toBe("wed");
    }
  });
});

describe("criterion 8 — a half day carries its hours", () => {
  it("refuses one time without the other", async () => {
    const seller = await supplier([{}]);
    expect(
      await addClosure(seller.owner, seller.id, {
        locationId: seller.branchIds[0]!,
        startsOn: new Date("2027-08-02T00:00:00Z"),
        endsOn: new Date("2027-08-02T00:00:00Z"),
        reason: "Stock-take morning",
        openFrom: "08:00",
        openUntil: null,
      }),
    ).toEqual({ ok: false, error: "half_day_needs_hours" });
  });

  it("refuses it in the database too", async () => {
    const seller = await supplier([{}]);
    await expect(
      prisma.locationClosure.create({
        data: {
          locationId: seller.branchIds[0]!,
          startsOn: new Date("2027-08-02T00:00:00Z"),
          endsOn: new Date("2027-08-02T00:00:00Z"),
          reason: "Half set",
          openFrom: "08:00",
        },
      }),
    ).rejects.toThrow(/location_closure_half_day_carries_hours/);
  });

  it("refuses a date with no reason, and a range that runs backwards", async () => {
    const seller = await supplier([{}]);
    const base = {
      locationId: seller.branchIds[0]!,
      startsOn: new Date("2027-08-02T00:00:00Z"),
      endsOn: new Date("2027-08-06T00:00:00Z"),
    };
    expect(await addClosure(seller.owner, seller.id, { ...base, reason: "  " }))
      .toEqual({ ok: false, error: "no_reason" });
    expect(
      await addClosure(seller.owner, seller.id, {
        ...base,
        startsOn: base.endsOn,
        endsOn: base.startsOn,
        reason: "Backwards",
      }),
    ).toEqual({ ok: false, error: "backwards" });
  });
});

describe("criterion 11 — the picker", () => {
  it("offers a hidden branch and skips a draft", async () => {
    const seller = await supplier([
      { published: true },
      { published: false, everPublished: true },
      { published: false, everPublished: false },
    ]);

    const board = await getHoursBoard(seller.id, typeLabel);
    expect(board.branches).toHaveLength(2);
    // A branch nobody has published has no buyers to make claims to. One that
    // was live and is hidden still has hours worth keeping straight.
    expect(board.branches.filter((branch) => branch.hidden)).toHaveLength(1);

    const rows = await prisma.location.findMany({
      where: { businessId: seller.id },
      select: { published: true, publishedAt: true },
    });
    expect(pickerBranches(rows)).toHaveLength(2);
  });
});

describe("the temporary closure", () => {
  it("shows a notice and changes nothing about visibility — Q2", async () => {
    const seller = await supplier([{}]);
    await scheduleClosure(seller.owner, seller.id, {
      locationId: seller.branchIds[0]!,
      from: new Date("2027-09-01T00:00:00Z"),
      until: new Date("2027-09-14T00:00:00Z"),
      reason: "Moving to a larger warehouse",
    });

    const row = await prisma.location.findUniqueOrThrow({
      where: { id: seller.branchIds[0]! },
      select: { published: true, closedFrom: true, closureReason: true },
    });
    // A closed warehouse still wants next week's enquiries. Board 3c already
    // establishes hiding as the way to stop routing.
    expect(row.published).toBe(true);
    expect(row.closureReason).toContain("larger warehouse");
    expect(row.closedFrom).not.toBeNull();
  });
});

function startOfDay(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

function atNoon(at: Date): Date {
  return new Date(startOfDay(at).getTime() + 8 * 3_600_000);
}

function nextMonday(from: Date): Date {
  const at = startOfDay(from);
  while (at.getUTCDay() !== 1) at.setUTCDate(at.getUTCDate() + 1);
  return at;
}

function previousSunday(from: Date): Date {
  return new Date(startOfDay(from).getTime() - 86_400_000);
}
