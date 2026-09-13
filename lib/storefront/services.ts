import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db/client";
import { Prisma } from "@/lib/db/generated/client";
import type { DeliveryMode, Emirate } from "@/lib/db/generated/enums";
import { publicServicesFor, type PublicService } from "@/lib/services/service";
import { publicCredentialsFor, type PublicCredential } from "@/lib/credentials/service";
import { businessCoverage, effectiveCoverage } from "@/lib/locations/service-coverage";
import type { CoverageScope } from "@/lib/locations/coverage";
import { EMIRATES } from "@/lib/uae";
import { declaredSectors, type DeclaredSector } from "./services-overview";
import { latencies, windowStart } from "@/lib/metrics/response-time";
import { ENQUIRY_VOLUME_DAYS } from "./services-catalogue";

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


/**
 * Enquiries per service over the window — the figure `1e-s` sorts by and awards
 * `MOST ENQUIRED` from.
 *
 * **The seller's own volume, not a platform ranking.** Counted from
 * `EnquiryLine.serviceId`, the line a buyer's enquiry named its subject with,
 * and only on enquiries this business actually received — a service id on a
 * fan-out that never reached the firm is not the firm's volume. Distinct
 * enquiries, so an enquiry that named one service twice counts once.
 *
 * A query every render, never a stored counter — *every number is a query* —
 * and one indexed aggregate over at most a page of service ids. Every service
 * reads zero until buyers start naming services, which `1d-s` made possible;
 * the sort then falls back to the seller's own order and says so.
 */
export async function serviceEnquiryVolume(
  businessId: string,
  serviceIds: readonly string[],
  now: Date = new Date(),
): Promise<Map<string, number>> {
  if (serviceIds.length === 0) return new Map();
  const since = new Date(now.getTime() - ENQUIRY_VOLUME_DAYS * 86_400_000);

  const rows = await prisma.$queryRaw<{ service_id: string; enquiries: bigint }[]>`
    select l."service_id", count(distinct l."enquiry_id") as enquiries
      from "enquiry_line" l
      join "enquiry" e on e."id" = l."enquiry_id"
      join "enquiry_recipient" r on r."enquiry_id" = l."enquiry_id" and r."business_id" = ${businessId}
     where l."service_id" in (${Prisma.join([...serviceIds])})
       and e."created_at" >= ${since}
     group by l."service_id"`;

  return new Map(rows.map((row) => [row.service_id, Number(row.enquiries)]));
}

/* ── Board 1f-s — the coverage page ─────────────────────────────────────── */

export interface CoverageServiceRow {
  service: PublicService;
  /** This service's effective coverage — own rows, else the default (B1). */
  places: CoveragePlace[];
}

export interface CoveragePageData {
  rows: CoverageServiceRow[];
  /** The firm's free-zone registrations — a second axis, never a place (B4). */
  freeZones: { emirate: string; name: string }[];
  /** How many first replies the reply-time figure is measured over (B3). */
  replies: number;
}

/**
 * Everything `/b/:slug/coverage` reads, in four queries.
 *
 * **One row per live service** (B1), each resolved through `effectiveCoverage`
 * — the helper `1g-s` uses, so a service's row here and its own page cannot
 * disagree. The union the overview prints (`2d-s` B6) is not this page's
 * subject: the page tells a buyer to read the rows.
 */
export const coveragePageFor = cache(
  async (businessId: string, now: Date = new Date()): Promise<CoveragePageData> => {
    const services = await publicServicesFor(businessId);
    const [rows, registrations, replies] = await Promise.all([
      coverageRows(businessId, { in: services.map((service) => service.id) }),
      prisma.freeZoneRegistration.findMany({
        where: { businessId },
        orderBy: { area: { name: "asc" } },
        select: { area: { select: { emirate: true, name: true } } },
      }),
      replySampleFor(businessId, now),
    ]);

    const defaults = rows.filter((row) => row.serviceId === null);
    return {
      rows: services.map((service) => ({
        service,
        places: worded(
          effectiveCoverage(
            defaults,
            rows.filter((row) => row.serviceId === service.id),
          ),
          rows,
        ),
      })),
      freeZones: registrations.map((row) => ({ emirate: row.area.emirate, name: row.area.name })),
      replies,
    };
  },
);

/**
 * How many replies the published reply time stands on — `1f-s` B3.
 *
 * The same observations the nightly job measures `responseTimeMedianMs` over —
 * recipient rows delivered inside `WINDOW_DAYS` with a first reply — counted
 * through the same `latencies` function, so the sample the page states is the
 * sample the header's figure came from. A page that published its own median
 * over a different window would print two reply times for one firm on one
 * screen.
 */
export async function replySampleFor(businessId: string, now: Date = new Date()): Promise<number> {
  const observations = await prisma.enquiryRecipient.findMany({
    where: { businessId, createdAt: { gte: windowStart(now) }, firstReplyAt: { not: null } },
    select: { createdAt: true, firstReplyAt: true },
  });
  return latencies(
    observations.map((row) => ({ deliveredAt: row.createdAt, firstReplyAt: row.firstReplyAt })),
  ).length;
}

/**
 * Other firms whose live service in this subcategory reaches each emirate —
 * `1f-s` B6, the count on the fan-out offer.
 *
 * **Live, every render.** Effective coverage is resolved in SQL the same way
 * `effectiveCoverage` resolves it in TypeScript: a service's own rows where it
 * has any, the business default where it has none. Only published, claimed,
 * unsuspended firms count, because the offer is *we will send it to the firms
 * that do* and a firm the fan-out would not deliver to is not one of them. This
 * firm is excluded — it is the firm that does not cover the place.
 */
export async function coveringFirmsByEmirate(
  categoryId: string,
  excludeBusinessId: string,
): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<{ emirate: string; firms: bigint }[]>`
    with svc as (
      select s."id", s."business_id"
        from "service" s
        join "business" b on b."id" = s."business_id"
       where s."status" = 'live'
         and s."category_id" = ${categoryId}
         and b."id" <> ${excludeBusinessId}
         and b."published_at" is not null
         and b."suspended_at" is null
         and b."claim_status" = 'claimed'
    ),
    reach as (
      select svc."business_id", sc."emirate"::text as emirate
        from svc
        join "service_coverage" sc on sc."service_id" = svc."id"
      union
      select svc."business_id", sc."emirate"::text as emirate
        from svc
        join "service_coverage" sc on sc."business_id" = svc."business_id" and sc."service_id" is null
       where not exists (select 1 from "service_coverage" own where own."service_id" = svc."id")
    )
    select emirate, count(distinct "business_id") as firms from reach group by emirate`;

  return new Map(rows.map((row) => [row.emirate, Number(row.firms)]));
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
