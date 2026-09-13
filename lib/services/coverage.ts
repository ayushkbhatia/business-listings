import "server-only";
import { prisma } from "@/lib/db/client";
import { EMIRATES } from "@/lib/uae";
import { chipKey } from "@/lib/onboarding/coverage";
import { effectiveCoverage } from "@/lib/locations/service-coverage";
import type { CoverageScope } from "@/lib/locations/coverage";

/**
 * Board `3c-s` — one service's own coverage, and the half `2d-s` was owed.
 *
 * `2d-s` writes the business default: *where this firm works*. `1g-s` B8 then
 * resolves what a buyer is shown through `effectiveCoverage(default, own)` —
 * a service's own rows if it has any, otherwise the default. That helper
 * shipped with tests and with an unreachable branch, because `service_coverage`
 * had no way to say which service a row belonged to. This module is what makes
 * `own` a thing a seller can create.
 *
 * ## Narrowing starts empty, and never from a copy
 *
 * `2d-s` B5 is the rule the whole model hangs off: the default is inherited at
 * read time and **never copied down**. Seeding a service's rows from the
 * default the moment a seller opens this card would satisfy the screen and
 * break the rule — every later edit of the business default would silently
 * fail to reach the services that were stamped from it, and nothing would ever
 * say so.
 *
 * So the card starts with every chip off and the inherited set written out
 * beside them. The first chip ticked is the narrowing, and it narrows all the
 * way: a service with one row covers one place. That reads as a big jump from
 * one click, and it is the honest one — the stored state is exactly what the
 * line under the chips says it is, at every point.
 *
 * Untick the last chip and the service is back to inheriting. There is no
 * third state to store and no `inherits` flag to disagree with the rows.
 *
 * ## Tenancy
 *
 * Every function takes `businessId` from the caller's seat and resolves the
 * service by `{ id, businessId }` before it writes. That pair is what keeps
 * `service_coverage.business_id` in step with `service.business_id` — the
 * migration explains why that is a service-layer guarantee rather than a
 * composite foreign key.
 */

/* ── What the card reads ─────────────────────────────────────────────────── */

export interface ServiceCoverageChip {
  /** Stable across renders and safe in a form value. `dubai`, `area:<id>`. */
  key: string;
  label: string;
  scope: CoverageScope;
  /** Whether this service holds a row of its own for this scope. */
  on: boolean;
}

export interface ServiceCoverageState {
  serviceId: string;
  /** False while the service has no rows of its own — the ordinary state. */
  narrowed: boolean;
  chips: ServiceCoverageChip[];
  /**
   * The business default, written out in full whether or not it applies.
   *
   * Rendered even while this service is narrowed, because the seller is
   * choosing between two claims and can only do that if both are on screen.
   * Empty is a real answer and renders as one — a firm that has not finished
   * `2d-s` sees that here rather than a blank line.
   */
  inherited: string[];
  /** What a buyer is shown for this service right now, `1g-s` B8. */
  effective: string[];
  /**
   * Own rows narrower than the chips the card offers — read-only, the same
   * defence `2d-s` gives the business default. A card that rendered eight
   * chips and silently dropped a ninth claim on save would delete work it
   * never showed.
   */
  otherScopes: { id: string; label: string }[];
  savedAt: Date;
}

export type ServiceCoverageWrite =
  | { ok: true; savedAt: Date; narrowed: boolean; effective: string[] }
  | { ok: false; reason: "not_found" | "unknown_area" };

const EMIRATE_LABEL: Record<string, string> = Object.fromEntries(
  EMIRATES.map((row) => [row.value, row.label]),
);

/** Everything the card renders, in one read. Null when the seat cannot see it. */
export async function serviceCoverageFor(
  businessId: string,
  serviceId: string,
): Promise<ServiceCoverageState | null> {
  const service = await prisma.service.findFirst({
    where: { id: serviceId, businessId },
    select: { id: true, updatedAt: true },
  });
  if (!service) return null;

  const [rows, cities] = await Promise.all([
    /*
       Both sets in one query rather than two, because the card is about the
       relationship between them and a reader that fetched them separately
       could render a default and a narrowing from two different moments.
    */
    prisma.serviceCoverage.findMany({
      where: { businessId, OR: [{ serviceId: null }, { serviceId }] },
      select: {
        id: true,
        emirate: true,
        areaId: true,
        serviceId: true,
        updatedAt: true,
        area: { select: { name: true } },
      },
    }),
    /*
       Al Ain, and whatever joins it — a query rather than a constant, the same
       row set `2d-s` offers so the two cards cannot drift apart on which eight
       places a seller is shown.
    */
    prisma.area.findMany({
      where: { searchedAsEmirate: true },
      orderBy: [{ emirate: "asc" }, { name: "asc" }],
      select: { id: true, name: true, emirate: true },
    }),
  ]);

  const own = rows.filter((row) => row.serviceId !== null);
  const fallback = rows.filter((row) => row.serviceId === null);
  const held = new Set(own.map((row) => chipKey(row)));

  const chips: ServiceCoverageChip[] = [];
  for (const emirate of EMIRATES) {
    const scope: CoverageScope = { emirate: emirate.value, areaId: null };
    chips.push({ key: chipKey(scope), label: emirate.label, scope, on: held.has(chipKey(scope)) });
    // The city sits immediately after the emirate it is in, `2d-s`'s order.
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
  const otherScopes = own
    .filter((row) => !chipKeys.has(chipKey(row)))
    .map((row) => ({ id: row.id, label: labelFor(row) }));

  const effective = effectiveCoverage(
    fallback.map(toScope),
    own.map(toScope),
  );
  const byKey = new Map(rows.map((row) => [chipKey(row), labelFor(row)]));

  const newest = own.reduce<Date>(
    (held, row) => (row.updatedAt > held ? row.updatedAt : held),
    service.updatedAt,
  );

  return {
    serviceId: service.id,
    narrowed: own.length > 0,
    chips,
    inherited: fallback.map(labelFor),
    effective: effective.map((scope) => byKey.get(chipKey(scope)) ?? EMIRATE_LABEL[scope.emirate] ?? scope.emirate),
    otherScopes,
    savedAt: newest,
  };
}

function toScope(row: { emirate: CoverageScope["emirate"]; areaId: string | null }): CoverageScope {
  return { emirate: row.emirate, areaId: row.areaId };
}

function labelFor(row: { emirate: string; area: { name: string } | null }): string {
  const emirate = EMIRATE_LABEL[row.emirate] ?? row.emirate;
  return row.area ? `${row.area.name}, ${emirate}` : emirate;
}

/* ── The writes ──────────────────────────────────────────────────────────── */

/**
 * One chip on or off, for one service.
 *
 * Row at a time rather than a replace, for `2d-s`'s reason: a card that renders
 * eight chips must not delete a ninth claim it never showed. `deleteMany` and
 * `createMany({ skipDuplicates })` make a double click a no-op rather than a
 * unique-constraint error — the two service-scoped partial indexes are what
 * make that true under a race, and this is what makes it quiet.
 */
export async function setServiceCoverageArea(
  businessId: string,
  serviceId: string,
  scope: { emirate: string; areaId: string | null },
  on: boolean,
): Promise<ServiceCoverageWrite> {
  const service = await prisma.service.findFirst({
    where: { id: serviceId, businessId },
    select: { id: true },
  });
  if (!service) return { ok: false, reason: "not_found" };

  const resolved = await resolveScope(scope);
  if (!resolved) return { ok: false, reason: "unknown_area" };

  if (on) {
    await prisma.serviceCoverage.createMany({
      data: [{ businessId, serviceId, emirate: resolved.emirate, areaId: resolved.areaId }],
      skipDuplicates: true,
    });
  } else {
    await prisma.serviceCoverage.deleteMany({
      where: { businessId, serviceId, emirate: resolved.emirate, areaId: resolved.areaId },
    });
  }

  return settle(businessId, serviceId);
}

/**
 * Back to the business default — every own row gone.
 *
 * Deleting the rows *is* the reset, because the emptiness is the signal. There
 * is nothing else to clear and nothing that could be left behind claiming this
 * service was narrowed when it is not.
 */
export async function resetServiceCoverage(
  businessId: string,
  serviceId: string,
): Promise<ServiceCoverageWrite> {
  const service = await prisma.service.findFirst({
    where: { id: serviceId, businessId },
    select: { id: true },
  });
  if (!service) return { ok: false, reason: "not_found" };

  await prisma.serviceCoverage.deleteMany({ where: { businessId, serviceId } });
  return settle(businessId, serviceId);
}

/**
 * What the card is told after a write.
 *
 * Re-read rather than computed from what was just sent, because the answer the
 * seller needs is *what does a buyer see now* — and that depends on the
 * business default, which a second tab may have changed while this card was
 * open.
 */
async function settle(businessId: string, serviceId: string): Promise<ServiceCoverageWrite> {
  const rows = await prisma.serviceCoverage.findMany({
    where: { businessId, OR: [{ serviceId: null }, { serviceId }] },
    select: { emirate: true, areaId: true, serviceId: true, area: { select: { name: true } } },
  });
  const own = rows.filter((row) => row.serviceId !== null);
  const effective = effectiveCoverage(
    rows.filter((row) => row.serviceId === null).map(toScope),
    own.map(toScope),
  );
  const byKey = new Map(rows.map((row) => [chipKey(row), labelFor(row)]));

  return {
    ok: true,
    savedAt: new Date(),
    narrowed: own.length > 0,
    effective: effective.map(
      (scope) => byKey.get(chipKey(scope)) ?? EMIRATE_LABEL[scope.emirate] ?? scope.emirate,
    ),
  };
}

/**
 * An emirate from the closed list, or an `Area` row that exists.
 *
 * The emirate is read off the area rather than trusted from the form, so a
 * posted pair that disagrees is stored as the area's own truth rather than as
 * a row claiming Al Quoz is in Sharjah.
 */
async function resolveScope(scope: {
  emirate: string;
  areaId: string | null;
}): Promise<CoverageScope | null> {
  if (scope.areaId === null) {
    const emirate = EMIRATES.find((row) => row.value === scope.emirate);
    return emirate ? { emirate: emirate.value, areaId: null } : null;
  }
  const area = await prisma.area.findUnique({
    where: { id: scope.areaId },
    select: { id: true, emirate: true },
  });
  return area ? { emirate: area.emirate, areaId: area.id } : null;
}
