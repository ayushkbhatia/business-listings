import "server-only";
import { prisma } from "@/lib/db/client";
import { EMIRATES } from "@/lib/uae";
import {
  DELIVERY_MODES,
  coverageReadiness,
  isDeliveryMode,
  type CoverageGap,
} from "@/lib/locations/service-coverage";
import type { CoverageScope } from "@/lib/locations/coverage";
import type { DeliveryMode, Emirate, SellsKind } from "@/lib/db/generated/enums";

/**
 * Board `2d-s` — the coverage step, which is board `2d`'s fourth step with a
 * different model underneath it.
 *
 * `2d` writes `Location` rows: an address, a dropped pin, a branch type, opening
 * hours, a service radius. Almost none of it applies to a firm that sells work.
 * A tax practice has one office and it is on the trade licence we already hold;
 * what a buyer wants to know is which emirates the practice will work in and
 * whether the work happens remotely at all.
 *
 * So: same route, same step number, same seat rules, **different model**. Six
 * things from `2d` are gone and each has a reason:
 *
 * | Dropped | Why |
 * |---|---|
 * | The map, the pin, `lat`/`lng` | A coordinate answers *where is your gate*. It also **blocks publish** on `2d`, so carried across it means no services business could ever publish |
 * | The service-radius circle | A radius is a distance from a point. Coverage here is a set of named areas, which is what buyers filter on |
 * | Opening hours, the Ramadan band | `1f-s`'s position: for a firm working remotely across three emirates, when the office door is unlocked is not the useful fact. Response time is, and we measure it |
 * | Branch type | One office, and its type is *office* |
 * | `N of M locations used on <plan>` | Coverage is not metered — AC10. A Free-plan practice covering all seven emirates is not a plan violation, it is a claim buyers can judge |
 *
 * **Nothing is dropped from `Location`.** A business that switches kind keeps
 * its branches, unrendered — the same no-conversion rule as `4d-s` B5, `2b-s` B5
 * and `2c-s` B5, and AC9 asserts it in both directions.
 *
 * Every mutation here takes the `businessId` from the caller's seat and never
 * from a form value, and every write is scoped by it, so a half-finished funnel
 * cannot be pointed at somebody else's listing by editing a hidden field.
 */

/* ── What the screen reads ───────────────────────────────────────────────── */

/** One of the eight chips: seven emirates, and Al Ain beside them. */
export interface CoverageChip {
  /** Stable across renders and safe in a form value. `dubai`, `area:<id>`. */
  key: string;
  label: string;
  scope: CoverageScope;
  on: boolean;
}

export interface FreeZoneOption {
  id: string;
  name: string;
  emirate: Emirate;
}

export interface CoverageState {
  businessId: string;
  displayName: string;
  sellsKind: SellsKind;
  deliveryModes: DeliveryMode[];
  /** The eight the screen offers, in federal order with Al Ain after its emirate. */
  chips: CoverageChip[];
  /**
   * Coverage rows that are not one of the eight chips.
   *
   * Empty today and not decoration: `3c-s` writes finer default rows from the
   * dashboard, and a screen that showed eight chips and silently dropped a
   * ninth claim on save would be a screen that deletes work it never rendered.
   * They are listed, read-only, with a link to where they are editable.
   */
  otherScopes: { id: string; label: string }[];
  /** The zones this firm says it is registered in. */
  registrations: FreeZoneOption[];
  /** Every free zone it could pick, for the search. A query, never a constant. */
  freeZones: FreeZoneOption[];
  /**
   * The licensed address, read-only. Null when the listing has no branch at
   * all, which is a real state — nothing invents one.
   */
  registeredOffice: { addressLine: string; areaName: string; emirate: Emirate } | null;
  ready: boolean;
  missing: CoverageGap[];
  savedAt: Date;
}

const EMIRATE_LABEL: Record<string, string> = Object.fromEntries(
  EMIRATES.map((row) => [row.value, row.label]),
);

export function chipKey(scope: CoverageScope): string {
  return scope.areaId === null ? scope.emirate : `area:${scope.areaId}`;
}

/** Everything board `2d-s` renders, in one read. */
export async function coverageStateFor(businessId: string): Promise<CoverageState | null> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      displayName: true,
      sellsKind: true,
      deliveryModes: true,
      updatedAt: true,
      serviceCoverage: {
        select: { id: true, emirate: true, areaId: true, updatedAt: true, area: { select: { name: true } } },
      },
      freeZoneRegistrations: {
        select: { area: { select: { id: true, name: true, emirate: true } } },
      },
      /*
         The registered office. First branch by age, which is the one the
         licence import created — and `take: 1` rather than a join on every
         branch, because this card is one address and a services business that
         somehow has four still only has one licensed one.
      */
      locations: {
        orderBy: [{ createdAt: "asc" }],
        take: 1,
        select: { addressLine: true, emirate: true, area: { select: { name: true } } },
      },
    },
  });
  if (!business) return null;

  const [cities, freeZones] = await Promise.all([
    /*
       Al Ain, and whatever joins it. A query rather than a constant, so board
       `2d-s` Q2's "Khor Fakkan and Ruwais come up" is a row somebody adds
       rather than a deploy.
    */
    prisma.area.findMany({
      where: { searchedAsEmirate: true },
      orderBy: [{ emirate: "asc" }, { name: "asc" }],
      select: { id: true, name: true, emirate: true },
    }),
    /*
       Published free zones, plus any this firm has already claimed.

       The second half is the lesson board 2d learned the hard way: a zone can
       be held back while the taxonomy is checked, and a registration already
       pointing at one would then have no matching option — the seller edits
       something else and their claim disappears in a save nobody thought
       touched it.
    */
    prisma.area.findMany({
      where: {
        isFreeZone: true,
        OR: [
          { publishedAt: { not: null } },
          { freeZoneRegistrations: { some: { businessId } } },
        ],
      },
      orderBy: [{ name: "asc" }],
      select: { id: true, name: true, emirate: true },
    }),
  ]);

  const held = new Map(business.serviceCoverage.map((row) => [chipKey(row), row]));

  const chips: CoverageChip[] = [];
  for (const emirate of EMIRATES) {
    const scope: CoverageScope = { emirate: emirate.value, areaId: null };
    chips.push({
      key: chipKey(scope),
      label: emirate.label,
      scope,
      on: held.has(chipKey(scope)),
    });
    // The city sits immediately after the emirate it is in, because that is
    // where a seller looks for it and it is where it actually is.
    for (const city of cities.filter((row) => row.emirate === emirate.value)) {
      const cityScope: CoverageScope = { emirate: city.emirate, areaId: city.id };
      chips.push({
        key: chipKey(cityScope),
        label: city.name,
        scope: cityScope,
        on: held.has(chipKey(cityScope)),
      });
    }
  }

  const chipKeys = new Set(chips.map((chip) => chip.key));
  const otherScopes = business.serviceCoverage
    .filter((row) => !chipKeys.has(chipKey(row)))
    .map((row) => ({
      id: row.id,
      label: row.area ? `${row.area.name}, ${EMIRATE_LABEL[row.emirate] ?? row.emirate}` : (EMIRATE_LABEL[row.emirate] ?? row.emirate),
    }));

  const scopes: CoverageScope[] = business.serviceCoverage.map((row) => ({
    emirate: row.emirate,
    areaId: row.areaId,
  }));
  const readiness = coverageReadiness({ deliveryModes: business.deliveryModes, coverage: scopes });

  const office = business.locations[0];

  return {
    businessId: business.id,
    displayName: business.displayName,
    sellsKind: business.sellsKind,
    deliveryModes: business.deliveryModes,
    chips,
    otherScopes,
    registrations: business.freeZoneRegistrations.map((row) => row.area),
    freeZones,
    registeredOffice: office
      ? { addressLine: office.addressLine, areaName: office.area.name, emirate: office.emirate }
      : null,
    ready: readiness.ready,
    missing: readiness.missing,
    savedAt: latestSave(business.serviceCoverage, business.updatedAt),
  };
}

/**
 * The header's receipt: the most recent coverage write, or the business row.
 *
 * A firm that has not claimed an area yet has never saved a coverage row, and
 * the business's own `updatedAt` is the closest true thing — the delivery modes
 * live on it, so a seller who has answered only the first question still gets a
 * timestamp that refers to something they did.
 */
function latestSave(rows: readonly { updatedAt: Date }[], fallback: Date): Date {
  let latest: Date | null = null;
  for (const row of rows) if (!latest || row.updatedAt > latest) latest = row.updatedAt;
  return latest && latest > fallback ? latest : fallback;
}

/* ── Writing ─────────────────────────────────────────────────────────────── */

export type CoverageWrite =
  | { ok: true; savedAt: Date }
  | { ok: false; reason: "not_found" | "unknown_mode" | "unknown_area" | "not_a_free_zone" };

/**
 * The whole mode set, replaced.
 *
 * Replaced rather than toggled because the three are one answer to one
 * question, and the control is a group of three checkboxes the seller reads
 * together. An empty set is allowed and is a real state — it is what every
 * business that has not reached this step has — and it is the half of the
 * publish gate that `continueCheck` refuses on rather than this call.
 */
export async function setDeliveryModes(
  businessId: string,
  raw: readonly string[],
): Promise<CoverageWrite> {
  if (raw.some((value) => !isDeliveryMode(value))) {
    return { ok: false, reason: "unknown_mode" };
  }
  // Deduplicated and put back in the screen's own order, so two tabs that sent
  // the same answer in different orders do not produce different rows.
  const modes = DELIVERY_MODES.filter((mode) => raw.includes(mode));

  const { count } = await prisma.business.updateMany({
    where: { id: businessId },
    data: { deliveryModes: modes },
  });
  if (count === 0) return { ok: false, reason: "not_found" };
  return { ok: true, savedAt: new Date() };
}

/**
 * One coverage chip on or off.
 *
 * One row at a time rather than replacing the set, and that is load-bearing:
 * `3c-s` writes finer default rows from the dashboard, and a wholesale replace
 * from a screen that only renders eight chips would delete a claim it never
 * showed the seller.
 *
 * `deleteMany`/`createMany`-shaped so a double click is a no-op rather than a
 * unique-constraint error — the two partial indexes are what make it true under
 * a race, and this is what makes it quiet.
 */
export async function setCoverageArea(
  businessId: string,
  scope: { emirate: string; areaId: string | null },
  on: boolean,
): Promise<CoverageWrite> {
  const emirate = await resolveScope(businessId, scope);
  if (!emirate.ok) return emirate;

  if (!on) {
    await prisma.serviceCoverage.deleteMany({
      where: { businessId, emirate: emirate.scope.emirate, areaId: emirate.scope.areaId },
    });
    return { ok: true, savedAt: new Date() };
  }

  await prisma.serviceCoverage.createMany({
    data: [{ businessId, emirate: emirate.scope.emirate, areaId: emirate.scope.areaId }],
    skipDuplicates: true,
  });
  return { ok: true, savedAt: new Date() };
}

/**
 * `Select all` — every chip on, and no confirmation.
 *
 * Board `2d-s` Q1. The sub-line already says what claiming everywhere costs;
 * a confirm dialog on an action we allow trains sellers to dismiss dialogs,
 * which is expensive the first time one of them matters.
 */
export async function selectAllCoverage(businessId: string): Promise<CoverageWrite> {
  const exists = await prisma.business.count({ where: { id: businessId } });
  if (exists === 0) return { ok: false, reason: "not_found" };

  const cities = await prisma.area.findMany({
    where: { searchedAsEmirate: true },
    select: { id: true, emirate: true },
  });

  await prisma.serviceCoverage.createMany({
    data: [
      ...EMIRATES.map((row) => ({ businessId, emirate: row.value, areaId: null })),
      ...cities.map((city) => ({ businessId, emirate: city.emirate, areaId: city.id })),
    ],
    skipDuplicates: true,
  });
  return { ok: true, savedAt: new Date() };
}

/** A free-zone registration, on or off. B4. */
export async function setFreeZone(
  businessId: string,
  areaId: string,
  on: boolean,
): Promise<CoverageWrite> {
  const exists = await prisma.business.count({ where: { id: businessId } });
  if (exists === 0) return { ok: false, reason: "not_found" };

  if (!on) {
    await prisma.freeZoneRegistration.deleteMany({ where: { businessId, areaId } });
    return { ok: true, savedAt: new Date() };
  }

  /*
     Checked against the taxonomy, not against the form. There is no free entry
     on this field — unlike the sectors on `2c-s`, a free zone is a closed,
     verifiable list, and a typed one is a registration nobody can check.
  */
  const area = await prisma.area.findUnique({
    where: { id: areaId },
    select: { isFreeZone: true },
  });
  if (!area) return { ok: false, reason: "unknown_area" };
  if (!area.isFreeZone) return { ok: false, reason: "not_a_free_zone" };

  await prisma.freeZoneRegistration.createMany({
    data: [{ businessId, areaId }],
    skipDuplicates: true,
  });
  return { ok: true, savedAt: new Date() };
}

type ResolvedScope =
  | { ok: true; scope: CoverageScope }
  | { ok: false; reason: "not_found" | "unknown_area" };

/**
 * Turn what the form sent into a scope the table will accept.
 *
 * The emirate on an area row is read from the area rather than trusted from the
 * request — the same rule `Location` and `BusinessCoverage` follow, written in
 * one place so the two cannot drift. Al Ain arriving with `emirate: dubai`
 * would otherwise be stored exactly that way and be wrong everywhere for ever.
 */
async function resolveScope(
  businessId: string,
  scope: { emirate: string; areaId: string | null },
): Promise<ResolvedScope> {
  const exists = await prisma.business.count({ where: { id: businessId } });
  if (exists === 0) return { ok: false, reason: "not_found" };

  if (scope.areaId === null) {
    const emirate = EMIRATES.find((row) => row.value === scope.emirate);
    if (!emirate) return { ok: false, reason: "unknown_area" };
    return { ok: true, scope: { emirate: emirate.value, areaId: null } };
  }

  const area = await prisma.area.findUnique({
    where: { id: scope.areaId },
    select: { id: true, emirate: true },
  });
  if (!area) return { ok: false, reason: "unknown_area" };
  return { ok: true, scope: { emirate: area.emirate, areaId: area.id } };
}

/* ── The gate ────────────────────────────────────────────────────────────── */

/**
 * B2, AC3. Re-read from the rows rather than trusted from the page, because the
 * page's copy is as old as its last render and a second tab may have cleared
 * the only area it is describing.
 */
export async function coverageCheck(businessId: string): Promise<{
  ready: boolean;
  missing: CoverageGap[];
}> {
  const [business, coverage] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId }, select: { deliveryModes: true } }),
    prisma.serviceCoverage.findMany({
      where: { businessId },
      select: { emirate: true, areaId: true },
    }),
  ]);
  if (!business) return { ready: false, missing: ["delivery_mode", "coverage_area"] };
  return coverageReadiness({ deliveryModes: business.deliveryModes, coverage });
}
