import "server-only";
import { Prisma } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { allowance, type PlanCaps } from "@/lib/plan/entitlements";
import { normalise, problemsWith, type RamadanHours, type WeekHours } from "@/lib/trade/hours";
import type { Emirate, LocationType } from "@/lib/db/generated/enums";
import {
  BRANCH_TYPES,
  RADIUS_DEFAULT,
  branchGaps,
  checkLandline,
  checkWhatsApp,
  clampRadius,
  isBranchType,
  isPinned,
  locationAllowance,
  roundCoord,
  withinUae,
  type BranchGap,
  type LocationAllowance,
  type PhoneProblem,
} from "./branch-fields";

/**
 * Board 2d — where the seller is, and the only onboarding step whose output a
 * buyer filters on directly.
 *
 * `2c` decided what a supplier sounds like. This decides where they are, and it
 * is the one step with a hard gate: **a branch with no pin cannot be published**,
 * because area is the second-most-used facet after category and an unpinned
 * location is excluded from the results map by a `where` clause and scores no
 * distance in the ranking. It is not a slightly worse listing. It is an absent
 * one, which is why the sub-line states the consequence rather than encouraging.
 *
 * That gate is also why locations are worth nothing on `2c`'s strength meter. A
 * lever moves a number; a gate lets you through or does not, and dressing one up
 * as the other tells a seller that skipping it costs fifteen points when it in
 * fact costs the listing.
 *
 * Everything here patches one field of one branch. Same contract as `2c`: the
 * autosave sends what changed, so two open tabs cannot have one post its stale
 * copy of the other's work over the top.
 */

/* ── What the page reads ─────────────────────────────────────────────────── */

export interface BranchState {
  id: string;
  type: LocationType;
  emirate: Emirate;
  areaId: string;
  areaName: string;
  isFreeZone: boolean;
  addressLine: string;
  phone: string | null;
  whatsapp: string | null;
  lat: number | null;
  lng: number | null;
  pinned: boolean;
  serviceRadiusKm: number | null;
  hours: WeekHours;
  ramadanHours: RamadanHours | null;
  /** Empty when this branch could be published as it stands. */
  gaps: BranchGap[];
  updatedAt: Date;
}

export interface AreaOption {
  id: string;
  name: string;
  emirate: Emirate;
  isFreeZone: boolean;
  /** The area's own centre, so a new pin starts near the right block. */
  lat: number | null;
  lng: number | null;
}

export interface LocationsState {
  businessId: string;
  displayName: string;
  branches: BranchState[];
  areas: AreaOption[];
  allowance: LocationAllowance;
  planId: string;
  /** The cheapest plan that raises the cap. Null on the best one for it. */
  upgrade: { planId: string; planName: string; cap: number | null } | null;
  /** Criterion 4: every branch complete, and at least one of them. */
  ready: boolean;
  savedAt: Date;
}

const PLAN_SELECT = {
  id: true,
  name: true,
  monthlyPriceAed: true,
  enquiriesPerMonth: true,
  productLimit: true,
  locationLimit: true,
  photoLimit: true,
  categoryLimit: true, storageMb: true,
  teamSeats: true,
  rankingMultiplier: true,
  customDomain: true,
  analytics: true,
  csvImport: true,
  sponsoredEligible: true,
  sortOrder: true,
} as const;

const BRANCH_SELECT = {
  id: true,
  type: true,
  emirate: true,
  areaId: true,
  addressLine: true,
  phone: true,
  whatsapp: true,
  lat: true,
  lng: true,
  serviceRadiusKm: true,
  hours: true,
  ramadanHours: true,
  updatedAt: true,
  area: { select: { name: true, isFreeZone: true } },
} as const;

type BranchRow = Prisma.LocationGetPayload<{ select: typeof BRANCH_SELECT }>;

/** Everything board 2d renders, in one read. */
export async function locationsStateFor(businessId: string): Promise<LocationsState | null> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      displayName: true,
      planId: true,
      plan: { select: PLAN_SELECT },
      locations: { orderBy: [{ createdAt: "asc" }], select: BRANCH_SELECT },
    },
  });
  if (!business) return null;

  /*
     A business with no plan row is on Free until the plan step says otherwise —
     criterion 3 of the funnel, where the listing goes live before anybody is
     asked for money. Read rather than assumed, so the cap and the name on the
     counter come from the same row the rest of the product bills against.
  */
  const plan: PlanCaps | null =
    business.plan ?? (await prisma.plan.findUnique({ where: { id: "free" }, select: PLAN_SELECT }));

  const [areas, plans] = await Promise.all([
    /*
       Published areas, plus any this business already sits in.

       The second half is not a nicety, and board 3c learned it the hard way: an
       area can be held back while the taxonomy is checked, and a branch already
       assigned to one would then have no matching option in the select. The
       seller edits their phone number, the area silently becomes whatever the
       select fell back to, and a supplier's address is lost by a save nobody
       thought touched it.
    */
    prisma.area.findMany({
      where: {
        OR: [
          { publishedAt: { not: null } },
          { locations: { some: { businessId } } },
        ],
      },
      orderBy: [{ emirate: "asc" }, { name: "asc" }],
      select: { id: true, name: true, emirate: true, isFreeZone: true, lat: true, lng: true },
    }),
    prisma.plan.findMany({ orderBy: { sortOrder: "asc" }, select: PLAN_SELECT }),
  ]);

  const branches = business.locations.map(toBranchState);
  const cap = plan?.locationLimit ?? null;

  /*
     The next plan up that actually raises this cap. Read from the table rather
     than named in copy: "Basic allows three" written into a sentence is a
     sentence that survives the plan being renamed, repriced or re-capped.
  */
  const current = plans.find((row) => row.id === (plan?.id ?? "free"));
  const better =
    cap === null
      ? null
      : (plans.find(
          (row) =>
            row.sortOrder > (current?.sortOrder ?? -1) &&
            (row.locationLimit === null || row.locationLimit > cap),
        ) ?? null);

  return {
    businessId: business.id,
    displayName: business.displayName,
    branches,
    areas,
    allowance: locationAllowance(cap, plan?.name ?? "Free", branches.length),
    planId: plan?.id ?? "free",
    upgrade: better
      ? { planId: better.id, planName: better.name, cap: better.locationLimit }
      : null,
    ready: branches.length > 0 && branches.every((branch) => branch.gaps.length === 0),
    savedAt: latestSave(branches),
  };
}

function toBranchState(row: BranchRow): BranchState {
  const facts = {
    areaId: row.areaId,
    addressLine: row.addressLine,
    phone: row.phone,
    whatsapp: row.whatsapp,
    lat: row.lat,
    lng: row.lng,
  };
  return {
    id: row.id,
    type: row.type,
    emirate: row.emirate,
    areaId: row.areaId,
    areaName: row.area.name,
    isFreeZone: row.area.isFreeZone,
    addressLine: row.addressLine,
    phone: row.phone,
    whatsapp: row.whatsapp,
    lat: row.lat,
    lng: row.lng,
    pinned: isPinned(facts),
    serviceRadiusKm: row.serviceRadiusKm,
    hours: (row.hours ?? {}) as WeekHours,
    ramadanHours: (row.ramadanHours ?? null) as RamadanHours | null,
    gaps: branchGaps(facts),
    updatedAt: row.updatedAt,
  };
}

/**
 * The header's timestamp: the most recent save across every branch.
 *
 * Board 2d's `Saved 20 seconds ago` is one line for a screen that edits several
 * branches, so it reports the last thing the seller did anywhere on it. A
 * business with no branches yet has never saved one, and the current time is the
 * only value that is not a lie about a row that does not exist.
 */
function latestSave(branches: readonly BranchState[]): Date {
  let latest: Date | null = null;
  for (const branch of branches) {
    if (!latest || branch.updatedAt > latest) latest = branch.updatedAt;
  }
  return latest ?? new Date();
}

/* ── Patching one field ──────────────────────────────────────────────────── */

export const BRANCH_FIELDS = ["type", "areaId", "addressLine", "phone", "whatsapp"] as const;
export type BranchField = (typeof BRANCH_FIELDS)[number];

export type BranchProblem =
  | { kind: "not_found" }
  | { kind: "unknown_area" }
  | { kind: "unknown_type" }
  | { kind: "address_required" }
  | { kind: "phone"; field: "phone" | "whatsapp"; problem: PhoneProblem };

export type BranchPatch =
  | { ok: true; field: BranchField; savedAt: Date; emirate?: Emirate }
  | { ok: false; field: BranchField; problem: BranchProblem };

export function isBranchField(value: string): value is BranchField {
  return (BRANCH_FIELDS as readonly string[]).includes(value);
}

/**
 * One field, one branch, scoped to one business.
 *
 * The `businessId` is always the caller's own seat — never a form value — so a
 * half-finished funnel cannot be pointed at somebody else's branch by editing a
 * hidden field. `updateMany` with both ids in the `where` is what enforces it:
 * a row that is not theirs matches nothing and reports `not_found` rather than
 * being silently written.
 */
export async function patchBranchField(
  businessId: string,
  branchId: string,
  field: BranchField,
  raw: string,
): Promise<BranchPatch> {
  if (field === "type") {
    if (!isBranchType(raw)) return { ok: false, field, problem: { kind: "unknown_type" } };
    return write(businessId, branchId, field, { type: raw });
  }

  if (field === "areaId") {
    /*
       Criterion 6: the area is a select over the `Area` table and there is no
       code path that takes free text. Every area page on board 6a is generated
       from this join, so a typed area is a listing that appears on no area page
       at all — invisible in the one place the seller came here to be found.

       The emirate is derived from the chosen area and never read from the form.
       The screen has an emirate control because the board asks for one and
       because it is how a seller narrows a list of seventeen areas, but it
       filters the options rather than being stored beside them. Two independent
       fields that must agree are two fields that eventually will not.
    */
    const area = await prisma.area.findUnique({
      where: { id: raw },
      select: { emirate: true },
    });
    if (!area) return { ok: false, field, problem: { kind: "unknown_area" } };
    return write(businessId, branchId, field, { areaId: raw, emirate: area.emirate }, area.emirate);
  }

  if (field === "addressLine") {
    const value = raw.trim();
    // UAE addressing is not structured, so this is free text by design — but
    // it is the line a driver follows, and an empty one is a branch nobody can
    // reach. Criterion 4 blocks Continue on it; this refuses to store it.
    if (value === "") return { ok: false, field, problem: { kind: "address_required" } };
    return write(businessId, branchId, field, { addressLine: value });
  }

  const check = field === "phone" ? checkLandline(raw) : checkWhatsApp(raw);
  if (!check.ok) {
    return { ok: false, field, problem: { kind: "phone", field, problem: check.problem } };
  }
  return write(businessId, branchId, field, { [field]: check.value });
}

async function write(
  businessId: string,
  branchId: string,
  field: BranchField,
  data: Prisma.LocationUncheckedUpdateManyInput,
  emirate?: Emirate,
): Promise<BranchPatch> {
  const { count } = await prisma.location.updateMany({
    where: { id: branchId, businessId },
    data,
  });
  if (count === 0) return { ok: false, field, problem: { kind: "not_found" } };
  return { ok: true, field, savedAt: new Date(), ...(emirate ? { emirate } : {}) };
}

/* ── The pin, and the radius ─────────────────────────────────────────────── */

export type PinResult =
  | { ok: true; lat: number; lng: number; savedAt: Date }
  | { ok: false; reason: "not_found" | "out_of_bounds" };

/**
 * Criterion 11: the map's `pinmove`, landed on the row.
 *
 * Rounded to six decimals here as well as in the component, because the
 * component is a browser and a browser is not where a rule is enforced. A point
 * outside the country is refused rather than stored — it is a mis-drag or a bad
 * paste, and it would put this supplier's marker in the Gulf of Oman on every
 * search that draws a map.
 *
 * **`exact`, because a person put it there.** Board 3c's `geocode_precision`
 * records who placed a pin rather than how precise the decimals look — nothing
 * can examine a pair of floats and tell a gate from an area centre. This
 * function and board 3c's `setPin` are the only two paths where somebody did,
 * so they are the only two that write `exact`, and everything derived from the
 * area writes `approximate`.
 *
 * A CHECK ties the column to the coordinates, which is how this was found: it
 * refused every write here the moment it went on.
 */
export async function pinBranch(
  businessId: string,
  branchId: string,
  lat: number,
  lng: number,
): Promise<PinResult> {
  if (!withinUae(lat, lng)) return { ok: false, reason: "out_of_bounds" };

  const rounded = { lat: roundCoord(lat), lng: roundCoord(lng) };
  const { count } = await prisma.location.updateMany({
    where: { id: branchId, businessId },
    data: { ...rounded, geocodePrecision: "exact" },
  });
  if (count === 0) return { ok: false, reason: "not_found" };
  return { ok: true, ...rounded, savedAt: new Date() };
}

export type RadiusResult =
  | { ok: true; km: number | null; savedAt: Date }
  | { ok: false; reason: "not_found" };

/**
 * How far this branch delivers.
 *
 * Null is a real answer and not a missing one: `coverageOf` on board `1f` reads
 * it as "this supplier has made no delivery promise" and renders no card, which
 * is different from promising zero kilometres.
 */
export async function setBranchRadius(
  businessId: string,
  branchId: string,
  km: number | null,
): Promise<RadiusResult> {
  const value = km === null ? null : clampRadius(km);
  const { count } = await prisma.location.updateMany({
    where: { id: branchId, businessId },
    data: { serviceRadiusKm: value },
  });
  if (count === 0) return { ok: false, reason: "not_found" };
  return { ok: true, km: value, savedAt: new Date() };
}

/* ── Adding and removing a branch ────────────────────────────────────────── */

export type AddBranchResult =
  | { ok: true; id: string }
  | { ok: false; reason: "at_cap" | "unknown_area" | "not_found" };

/**
 * A second branch, where the plan allows one.
 *
 * Criterion 2 is enforced here and stated on the screen: on Free the control is
 * an upgrade link rather than a button, so this refusal is the backstop and not
 * the thing a seller meets. A cap that is real only in the API's rejection is a
 * screen that disagrees with its own product.
 *
 * The new branch starts unpinned, on purpose. Dropping it at the area's centroid
 * would give it coordinates it has not earned, and this platform never
 * approximates a location to an area centre — a wrong pin is worse than no pin,
 * and the gap is surfaced to the seller instead. The area's centre is passed to
 * the map as *where to look*, which is a different thing from where the branch is.
 */
export async function addBranch(
  businessId: string,
  input: { areaId: string; type?: string },
): Promise<AddBranchResult> {
  const [business, area] = await Promise.all([
    prisma.business.findUnique({
      where: { id: businessId },
      select: { plan: { select: PLAN_SELECT } },
    }),
    prisma.area.findUnique({ where: { id: input.areaId }, select: { emirate: true } }),
  ]);
  if (!business) return { ok: false, reason: "not_found" };
  if (!area) return { ok: false, reason: "unknown_area" };

  const plan: PlanCaps | null =
    business.plan ?? (await prisma.plan.findUnique({ where: { id: "free" }, select: PLAN_SELECT }));

  if (plan) {
    const used = await prisma.location.count({ where: { businessId } });
    if (allowance(plan, "locations", used).atCap) return { ok: false, reason: "at_cap" };
  }

  const created = await prisma.location.create({
    data: {
      businessId,
      areaId: input.areaId,
      emirate: area.emirate,
      type: input.type && isBranchType(input.type) ? input.type : "warehouse",
      addressLine: "",
      serviceRadiusKm: RADIUS_DEFAULT,
      hours: {},
      /*
         Unpublished until it is finished. `goLive` publishes every branch when
         the step completes, and a half-typed address on the public directory in
         the meantime is worse than one branch fewer for ten minutes.
      */
      published: false,
    },
    select: { id: true },
  });
  return { ok: true, id: created.id };
}

export type RemoveBranchResult = { ok: true } | { ok: false; reason: "last_branch" | "not_found" };

/**
 * Removing a branch, but never the last one.
 *
 * A published listing with no address is a listing a buyer cannot visit, and it
 * would drop out of every area page silently. The screen offers no delete on a
 * single branch for that reason; this is what makes the rule true rather than
 * drawn.
 */
export async function removeBranch(
  businessId: string,
  branchId: string,
): Promise<RemoveBranchResult> {
  const count = await prisma.location.count({ where: { businessId } });
  if (count <= 1) return { ok: false, reason: "last_branch" };

  const { count: removed } = await prisma.location.deleteMany({
    where: { id: branchId, businessId },
  });
  return removed === 0 ? { ok: false, reason: "not_found" } : { ok: true };
}

/* ── Hours ───────────────────────────────────────────────────────────────── */

export type HoursTarget = { branchId: string } | { branchId: "all"; from: string };

export type SaveHoursResult =
  | { ok: true; applied: number; savedAt: Date }
  | { ok: false; problem: string };

/**
 * Hours for one branch, or the same hours for every branch.
 *
 * Criterion 17 lives on the screen rather than here — `Copy to all branches`
 * asks before it overwrites, because the seller may already have set a second
 * branch's hours and this control sits one click from the row they were
 * editing. The service still needs the confirmed intent to be explicit, which is
 * what `branchId: "all"` is: a caller cannot reach every branch by accident.
 *
 * Validated before it is written and with the same function the editor uses
 * while typing, so a seller cannot be told one thing in the form and another on
 * save.
 */
export async function saveBranchHours(
  businessId: string,
  target: HoursTarget,
  hours: WeekHours,
  ramadanHours: RamadanHours | null,
  describe: (problem: ReturnType<typeof problemsWith>[number]) => string,
): Promise<SaveHoursResult> {
  const problems = problemsWith(hours);
  if (problems.length > 0) return { ok: false, problem: describe(problems[0]!) };

  /*
     `Prisma.DbNull`, not `null`. A nullable Json column has two empty states —
     SQL NULL and the JSON value `null` — and Prisma makes you say which. A
     seller clearing their Ramadan block means the column has nothing in it.
  */
  const ramadan =
    ramadanHours === null
      ? Prisma.DbNull
      : (normalise(ramadanHours) as unknown as Prisma.InputJsonValue);

  const where =
    target.branchId === "all"
      ? { businessId }
      : { businessId, id: target.branchId };

  const { count } = await prisma.location.updateMany({
    where,
    data: { hours: normalise(hours) as unknown as object, ramadanHours: ramadan },
  });
  return { ok: true, applied: count, savedAt: new Date() };
}

/**
 * Which other branches already have hours on file.
 *
 * The confirm criterion 17 asks for should name what is about to be lost rather
 * than ask a generic "are you sure" — a seller who has set nothing elsewhere
 * should not be stopped, and one who has set three branches should be told it
 * is three.
 */
export async function branchesWithHours(
  businessId: string,
  exceptBranchId: string,
): Promise<number> {
  const rows = await prisma.location.findMany({
    where: { businessId, id: { not: exceptBranchId } },
    select: { hours: true },
  });
  return rows.filter((row) => {
    const hours = (row.hours ?? {}) as WeekHours;
    return Object.entries(hours).some(
      ([key, value]) => key !== "publicHolidays" && Array.isArray(value) && value.length > 0,
    );
  }).length;
}

/* ── Continue ────────────────────────────────────────────────────────────── */

export interface ContinueCheck {
  ready: boolean;
  /** Branch id to the gaps still open on it, so the screen can point at one. */
  blocking: { branchId: string; gaps: BranchGap[] }[];
}

/**
 * Criterion 4, from the rows rather than from the form.
 *
 * Re-read on submit rather than trusted from the page, because the page's copy
 * is as old as the last render and a second tab may have deleted the branch it
 * is describing.
 */
export async function continueCheck(businessId: string): Promise<ContinueCheck> {
  const rows = await prisma.location.findMany({
    where: { businessId },
    orderBy: [{ createdAt: "asc" }],
    select: { id: true, areaId: true, addressLine: true, phone: true, whatsapp: true, lat: true, lng: true },
  });

  if (rows.length === 0) {
    return { ready: false, blocking: [] };
  }

  const blocking = rows
    .map((row) => ({ branchId: row.id, gaps: branchGaps(row) }))
    .filter((entry) => entry.gaps.length > 0);

  return { ready: blocking.length === 0, blocking };
}

export { BRANCH_TYPES, RADIUS_DEFAULT };
