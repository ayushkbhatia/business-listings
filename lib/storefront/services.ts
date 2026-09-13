import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db/client";
import type { DeliveryMode, Emirate } from "@/lib/db/generated/enums";
import { publicServicesFor, type PublicService } from "@/lib/services/service";
import { publicCredentialsFor, type PublicCredential } from "@/lib/credentials/service";
import { businessCoverage, effectiveCoverage } from "@/lib/locations/service-coverage";
import type { CoverageScope } from "@/lib/locations/coverage";
import { EMIRATES } from "@/lib/uae";
import { declaredSectors, type DeclaredSector } from "./services-overview";

/**
 * Board `1d-s` — everything the storefront of a firm that sells work reads.
 *
 * **Reads only.** `Business` + `Service` + `Credential` + `ServiceCoverage` +
 * the declared sector counts, and nothing on this path writes.
 *
 * Each half comes from the same function its sibling screen already uses, so
 * the two pages cannot disagree about a firm:
 *
 *  - services from `publicServicesFor`, which is `1g-s`'s loader and does not
 *    select `indicativeFee` — B5 holds because the column is never fetched, not
 *    because a template forgot to print it;
 *  - credentials from `publicCredentialsFor`, which never selects the document
 *    path;
 *  - coverage from `businessCoverage`, the one union helper `2d-s` B6 names.
 *
 * `cache`d per request and keyed on the id alone — React's `cache` compares
 * arguments by identity, so an object argument would miss on every call. The
 * two columns it needs off `Business` are read here by primary key rather than
 * threaded in for that reason.
 */

export interface CoveragePlace {
  emirate: Emirate;
  areaId: string | null;
  /** The area's name, or the emirate's where the claim is emirate-wide. */
  label: string;
}

export interface ServicesStorefront {
  services: PublicService[];
  credentials: PublicCredential[];
  sectors: DeclaredSector[];
  coverage: CoveragePlace[];
  deliveryModes: DeliveryMode[];
}

/**
 * A firm's public credentials, once per request.
 *
 * The header names the verified one beside the licence badge on every tab, and
 * the overview lists them all below it. Both ask; one query answers.
 */
export const storefrontCredentials = cache(publicCredentialsFor);

export const servicesStorefrontFor = cache(
  async (businessId: string): Promise<ServicesStorefront> => {
    const [business, services, credentials, engagements] = await Promise.all([
      prisma.business.findUnique({
        where: { id: businessId },
        select: { sectorsServed: true, deliveryModes: true },
      }),
      publicServicesFor(businessId),
      storefrontCredentials(businessId),
      prisma.sectorEngagement.findMany({
        where: { businessId },
        select: { sectorSlug: true, engagements: true },
      }),
    ]);

    return {
      services,
      credentials,
      sectors: declaredSectors(business?.sectorsServed ?? [], engagements),
      coverage: await publicCoverageFor(
        businessId,
        services.map((service) => service.id),
      ),
      deliveryModes: business?.deliveryModes ?? [],
    };
  },
);

/**
 * What a buyer is shown as this firm's coverage — `1d-s` B7, `2d-s` B6.
 *
 * **The union of published services' effective coverage, never the default
 * line.** Each live service resolves to its own rows if `3c-s` narrowed it and
 * to the business default if not; the storefront shows the union of those. So
 * narrowing one service to Dubai never shrinks the listing — the seller is not
 * punished for being precise — and a service that travels further than the
 * default widens it, because the firm does go there.
 *
 * A firm with no live service shows its default, which is what it has said.
 */
export async function publicCoverageFor(
  businessId: string,
  liveServiceIds: readonly string[],
): Promise<CoveragePlace[]> {
  const rows = await coverageRows(businessId, { in: [...liveServiceIds] });
  const scopes = businessCoverage(
    rows.filter((row) => row.serviceId === null),
    liveServiceIds.map((id) => rows.filter((row) => row.serviceId === id)),
  );
  return worded(scopes, rows);
}

/**
 * One service's effective coverage — `1g-s` B8, for the service's own page.
 *
 * Its own rows if it has any, otherwise the default. Never the union: on a page
 * about one engagement that would put a narrowing back into the default it was
 * narrowing away from.
 */
export async function publicServiceCoverage(
  businessId: string,
  serviceId: string,
): Promise<CoveragePlace[]> {
  const rows = await coverageRows(businessId, { equals: serviceId });
  return worded(
    effectiveCoverage(
      rows.filter((row) => row.serviceId === null),
      rows.filter((row) => row.serviceId === serviceId),
    ),
    rows,
  );
}

type CoverageRow = CoverageScope & { serviceId: string | null; areaName: string | null };

/** The default rows and the named services' rows, in one query. */
async function coverageRows(
  businessId: string,
  services: { in: string[] } | { equals: string },
): Promise<CoverageRow[]> {
  const rows = await prisma.serviceCoverage.findMany({
    where: { businessId, OR: [{ serviceId: null }, { serviceId: services }] },
    orderBy: [{ emirate: "asc" }, { createdAt: "asc" }],
    select: { emirate: true, areaId: true, serviceId: true, area: { select: { name: true } } },
  });
  return rows.map((row) => ({
    emirate: row.emirate,
    areaId: row.areaId,
    serviceId: row.serviceId,
    areaName: row.area?.name ?? null,
  }));
}

function worded(scopes: readonly CoverageScope[], rows: readonly CoverageRow[]): CoveragePlace[] {
  const names = new Map(
    rows.flatMap((row) => (row.areaId && row.areaName ? [[row.areaId, row.areaName] as const] : [])),
  );
  return orderByEmirate(scopes).map((scope) => ({
    emirate: scope.emirate,
    areaId: scope.areaId,
    label: scope.areaId
      ? (names.get(scope.areaId) ?? emirateName(scope.emirate))
      : emirateName(scope.emirate),
  }));
}

/** The federal order — the one every other emirate list on the platform uses. */
function orderByEmirate(scopes: readonly CoverageScope[]): CoverageScope[] {
  const rank = new Map<string, number>(EMIRATES.map((row, index) => [row.value, index]));
  return [...scopes].sort(
    (a, b) =>
      (rank.get(a.emirate) ?? 99) - (rank.get(b.emirate) ?? 99) ||
      Number(a.areaId !== null) - Number(b.areaId !== null),
  );
}

function emirateName(emirate: string): string {
  return EMIRATES.find((row) => row.value === emirate)?.label ?? emirate;
}
