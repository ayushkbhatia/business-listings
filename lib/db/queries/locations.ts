import "server-only";
import { prisma } from "@/lib/db/client";
import { branchCounts, branchStatus, pinIssues, pinState } from "@/lib/locations/branch";
import { orderCoverage } from "@/lib/locations/coverage";
import type { BranchStatus, PinState } from "@/lib/locations/branch";
import type { Emirate, LocationType } from "@/lib/db/generated/enums";

/**
 * Board 3c, loaded once.
 *
 * The header count, the table and the map overlay all come out of one query and
 * one derivation, which is criterion 1 made structural rather than remembered.
 * The board it replaces read `4 branches` over five rows while its map counted
 * `4 PINS · 1 MISSING` — two arithmetics over one table, and the kind of thing
 * that survives review because each number is defensible on its own.
 */

export interface BranchRow {
  id: string;
  /** What the seller calls this branch: its type and its area, never the company. */
  name: string;
  type: LocationType;
  /** Resolved here: a function prop cannot cross into a client component. */
  typeName: string;
  emirate: Emirate;
  areaId: string;
  areaName: string;
  isFreeZone: boolean;
  addressLine: string;
  phone: string | null;
  whatsapp: string | null;
  serviceRadiusKm: number | null;
  lat: number | null;
  lng: number | null;
  status: BranchStatus;
  pin: PinState;
  /** The area's centre, for opening the branch editor's map on an unpinned row. */
  areaCentre: { lat: number; lng: number } | null;
}

export interface CoverageRow {
  id: string;
  emirate: Emirate;
  areaId: string | null;
  areaName: string | null;
  leadTimeHours: number;
  /*
     The chip's two halves, already words.

     Resolved by the caller and stored on the row rather than passed down as
     two formatters. This is the repo's most repeated defect — a function prop
     does not survive the server/client boundary, and `tests/unit/client-labels`
     fails the build over it — but it is also simply the right shape: the panel
     renders a chip, and a chip is text.
  */
  scope: string;
  promise: string;
}

export interface LocationsBoard {
  branches: BranchRow[];
  coverage: CoverageRow[];
  counts: ReturnType<typeof branchCounts>;
  issues: ReturnType<typeof pinIssues>;
}

/**
 * A branch's own name.
 *
 * The schema has no `Location.name` and this screen needs one — the table's
 * widest column is `BRANCH` and a row reading only "Warehouse" over five rows
 * is five identical rows. The render's names ("Al Quoz trade counter",
 * "Sharjah depot") are the type and the place, which is exactly what the two
 * columns beside it already hold, so it is composed rather than stored: a name
 * column would be a sixth field to keep in step with the area a seller can
 * change, and it would go stale the first time they moved a depot.
 *
 * The type label is resolved by the caller — `t()` does not belong in a query.
 */
export function branchName(areaName: string, typeLabel: string): string {
  return `${areaName} ${typeLabel.toLocaleLowerCase("en")}`;
}

export interface BoardLabels {
  /** `Head office`, `Trade counter`. */
  type: (type: LocationType) => string;
  /** `Dubai, everywhere` · `Al Quoz Industrial 3, Dubai`. */
  scope: (row: { emirate: Emirate; areaName: string | null }) => string;
  /** `Same day`, `48 hours`. */
  promise: (leadTimeHours: number) => string;
}

export async function getLocationsBoard(
  businessId: string,
  labels: BoardLabels,
): Promise<LocationsBoard> {
  const [locations, coverage] = await Promise.all([
    prisma.location.findMany({
      where: { businessId },
      /*
         Head office first, then oldest first.

         Not by status: a seller scanning for the branch they came to fix looks
         for its name, and a table that reorders itself when they hide a row
         moves every other row out from under the pointer.
      */
      orderBy: [{ type: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        type: true,
        emirate: true,
        areaId: true,
        addressLine: true,
        phone: true,
        whatsapp: true,
        serviceRadiusKm: true,
        lat: true,
        lng: true,
        geocodePrecision: true,
        published: true,
        publishedAt: true,
        area: { select: { name: true, isFreeZone: true, lat: true, lng: true } },
      },
    }),
    prisma.businessCoverage.findMany({
      where: { businessId },
      select: {
        id: true,
        emirate: true,
        areaId: true,
        leadTimeHours: true,
        area: { select: { name: true } },
      },
    }),
  ]);

  const branches: BranchRow[] = locations.map((location) => ({
    id: location.id,
    name: branchName(location.area.name, labels.type(location.type)),
    typeName: labels.type(location.type),
    type: location.type,
    emirate: location.emirate,
    areaId: location.areaId,
    areaName: location.area.name,
    isFreeZone: location.area.isFreeZone,
    addressLine: location.addressLine,
    phone: location.phone,
    whatsapp: location.whatsapp,
    serviceRadiusKm: location.serviceRadiusKm,
    lat: location.lat,
    lng: location.lng,
    status: branchStatus(location),
    pin: pinState(location),
    areaCentre:
      location.area.lat === null || location.area.lng === null
        ? null
        : { lat: location.area.lat, lng: location.area.lng },
  }));

  const areaNames = new Map(
    coverage.filter((row) => row.area).map((row) => [row.areaId!, row.area!.name]),
  );

  return {
    branches,
    coverage: orderCoverage(coverage, (id) => areaNames.get(id) ?? "").map((row) => ({
      id: row.id,
      emirate: row.emirate,
      areaId: row.areaId,
      areaName: row.area?.name ?? null,
      leadTimeHours: row.leadTimeHours,
      scope: labels.scope({ emirate: row.emirate, areaName: row.area?.name ?? null }),
      promise: labels.promise(row.leadTimeHours),
    })),
    counts: branchCounts(locations),
    issues: pinIssues(branches),
  };
}

/** The scopes a seller has already claimed, for the picker to grey out. */
export async function coverageScopes(businessId: string) {
  return prisma.businessCoverage.findMany({
    where: { businessId },
    select: { emirate: true, areaId: true },
  });
}
