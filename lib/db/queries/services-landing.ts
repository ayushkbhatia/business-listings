import "server-only";
import { prisma } from "@/lib/db/client";
import { currentCheckedCredential } from "@/lib/credentials/kinds";
import { dubaiDayStart } from "@/lib/format/date";
import { t } from "@/lib/i18n";
import { parseSearchQuery } from "@/lib/search/query";
import { splitSectors } from "@/lib/search/blended";
import {
  COVERAGE_SERVICES_NAMED,
  type CheckedCredentialView,
  type CoverageFirmView,
} from "@/lib/search/blended-views";
import { familyResolver } from "@/lib/services/service";
import { sellsWork } from "@/lib/storefront/tabs";
import { EXPIRED_LICENCE_TIER } from "@/lib/verification";
import type { LandingScope } from "@/lib/seo/landing/scope";
import type { ServicesMember } from "@/lib/seo/landing/services-supply";
import { searchBusinesses } from "./search";

/**
 * Board `6a-s` — the ranked firms on a services landing page, as rows.
 *
 * The set is decided before this runs (`servicesMembers`), and this ranks it:
 * `searchBusinesses` handed the ids, so the page gets the ranking every other
 * surface gets — the services vector where one is published (`12c-s`), the
 * browse mode staff chose on `12c`, live boosts, unclaimed last — and never a
 * second ranker. What it adds is what a landing row prints that a search row
 * does not: the lead service's chips, the services in this trade, and how the
 * firm reaches the place.
 *
 * No amount anywhere, and none can arrive: the service select below has no fee
 * column in it, and `indicativeFee` is not read by any query in this file.
 */

export interface ServicesLandingRowsInput {
  scope: LandingScope;
  members: readonly ServicesMember[];
  page: number;
  pageSize: number;
  now?: Date;
}

export interface ServicesLandingRows {
  rows: CoverageFirmView[];
  total: number;
  /** Ranked ids on this page, for the position counter. */
  rankedIds: string[];
}

export async function servicesLandingRows(input: ServicesLandingRowsInput): Promise<ServicesLandingRows> {
  const { scope, members, page, pageSize } = input;
  const now = input.now ?? new Date();
  if (members.length === 0) return { rows: [], total: 0, rankedIds: [] };

  const byId = new Map(members.map((member) => [member.id, member]));
  const trade = new Set(scope.categoryIds);

  /*
     Category-match depth, the goods page's reading of it for a trade sold by
     the job: full for a firm with a live service filed in exactly this trade
     or listed there first, half for one here through a trade beneath it.
     Only read under the `category_depth` browse mode.
  */
  const exact = new Set<string>();
  const exactServices = await prisma.service.findMany({
    where: {
      businessId: { in: members.map((member) => member.id) },
      status: "live",
      categoryId: scope.category.id,
    },
    select: { businessId: true },
    distinct: ["businessId"],
  });
  for (const row of exactServices) exact.add(row.businessId);

  const results = await searchBusinesses(
    {
      ...parseSearchQuery({}),
      page,
      ...(scope.area ? { area: scope.area.slug } : { emirate: scope.emirate }),
    },
    {
      ids: members.map((member) => member.id),
      categoryIds: scope.categoryIds,
      browse: true,
      pageSize,
      categoryDepth: (businessId, primaryCategoryId) =>
        exact.has(businessId) || primaryCategoryId === scope.category.id ? 1 : 0.5,
    },
  );

  const ids = results.rows.map((row) => row.id);
  if (ids.length === 0) return { rows: [], total: results.total, rankedIds: [] };

  const [services, credentials, zones, resolveFamily] = await Promise.all([
    prisma.service.findMany({
      where: { businessId: { in: ids }, status: "live", categoryId: { in: [...trade] } },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: {
        id: true,
        businessId: true,
        name: true,
        slug: true,
        categoryId: true,
        feeBasis: true,
        deliveredWhere: true,
        values: { where: { fieldKey: "sectors" }, select: { value: true } },
      },
    }),
    prisma.credential.findMany({
      where: { businessId: { in: ids }, ...currentCheckedCredential(dubaiDayStart(now)) },
      orderBy: [{ kind: "asc" }, { id: "asc" }],
      select: { businessId: true, kind: true, identifier: true },
    }),
    prisma.freeZoneRegistration.findMany({
      where: { businessId: { in: ids }, area: { isFreeZone: true } },
      orderBy: { area: { name: "asc" } },
      select: { businessId: true, area: { select: { name: true } } },
    }),
    familyResolver(),
  ]);

  const servicesOf = new Map<string, typeof services>();
  for (const service of services) {
    servicesOf.set(service.businessId, [...(servicesOf.get(service.businessId) ?? []), service]);
  }
  const badgesOf = new Map<string, CheckedCredentialView[]>();
  for (const row of credentials) {
    const held = badgesOf.get(row.businessId) ?? [];
    if (held.some((badge) => badge.kind === row.kind)) continue;
    badgesOf.set(row.businessId, [...held, { kind: row.kind, identifier: row.identifier }]);
  }
  const zonesOf = new Map<string, string[]>();
  for (const row of zones) {
    zonesOf.set(row.businessId, [...(zonesOf.get(row.businessId) ?? []), row.area.name]);
  }

  const rows: CoverageFirmView[] = [];
  for (const firm of results.rows) {
    const member = byId.get(firm.id);
    if (!member) continue;
    const own = servicesOf.get(firm.id) ?? [];

    /*
       The services that reach the place first — they are why the firm is on
       the page — then the rest of its work in the trade, in the seller's own
       order. The lead one sets the chips.
    */
    const answering = new Set(member.membership.answeringServiceIds);
    const ordered = [...own.filter((service) => answering.has(service.id)), ...own.filter((service) => !answering.has(service.id))];
    const lead = ordered[0] ?? null;

    const chips: string[] = [];
    if (lead) {
      const family = resolveFamily(lead.categoryId, firm.scopeSheetFamilyId);
      const fee = family.feeBases.find((basis) => basis.key === lead.feeBasis);
      if (fee) chips.push(fee.label);
      if (lead.deliveredWhere) {
        chips.push(t(`search_blended.delivered.${lead.deliveredWhere}` as "search_blended.delivered.remote"));
      }
    }
    /*
       The third chip is scope: the sectors the lead service names, or — where
       it names none — the free zones the firm is registered to work in
       (`2d-s` B4). *DMCC · JAFZA* is a real filter for audit and formation
       work, and it is the firm's registration, not an address.
    */
    const sectors = splitSectors(lead?.values[0]?.value).map((sector) => sector.label);
    const scopeChip =
      sectors.length > 0 ? sectors.slice(0, 3).join(" · ") : (zonesOf.get(firm.id) ?? []).slice(0, 3).join(" · ");
    if (scopeChip) chips.push(scopeChip);

    const first = firm.locations[0];
    const claimed = firm.claimStatus === "claimed";
    const work = sellsWork(firm.sellsKind);

    rows.push({
      id: firm.id,
      businessSlug: firm.slug,
      businessName: firm.displayName,
      // The office line carries the place, once — see `CoverageFirmView`.
      place: null,
      rating:
        firm.ratingOverall !== null && firm.reviewCount > 0
          ? { value: firm.ratingOverall, count: firm.reviewCount }
          : null,
      replyMs: firm.responseTimeMedianMs,
      /*
         The tier the page counted. A licence that lapsed this morning is shown
         at the rung tonight's sweep will write (`EXPIRED_LICENCE_TIER`), not at
         the one it still stores — the header counted it out, and a row must
         agree with the header it sits under.
      */
      verificationTier: member.verified
        ? firm.verificationTier
        : Math.min(firm.verificationTier, EXPIRED_LICENCE_TIER),
      verifiedAt: firm.verifiedAt ? firm.verifiedAt.toISOString() : null,
      checkedCredentials: badgesOf.get(firm.id) ?? [],
      categoryCode: firm.primaryCategory.code,
      summary: firm.description?.trim() || firm.headline?.trim() || null,
      chips,
      services: ordered.slice(0, COVERAGE_SERVICES_NAMED).map((service) => ({
        name: service.name,
        href: `/b/${firm.slug}/s/${service.slug}`,
      })),
      moreServices: Math.max(0, ordered.length - COVERAGE_SERVICES_NAMED),
      office: first
        ? first.area
          ? t("area.in_emirate", { area: first.area.name, emirate: t(`emirate.${first.emirate}` as never) })
          : t(`emirate.${first.emirate}` as never)
        : null,
      covers: member.membership.reach !== "branch",
      coverageHref: `/b/${firm.slug}/coverage`,
      claimed,
      sellsWork: work,
      /*
         A firm that sells work opens the brief composer addressed to it, in
         this trade, with the site already this place — the `1h-s` composer
         reads all three. A firm that does not sell work (filed here, selling
         things) is sent without the trade, so the composer resolves its own and
         the buyer is not handed a brief for a firm that quotes by the item.
      */
      enquireHref: claimed ? enquireHref(scope, firm.slug, work) : null,
    });
  }

  return { rows, total: results.total, rankedIds: ids };
}

function enquireHref(scope: LandingScope, slug: string, work: boolean): string {
  const params = new URLSearchParams({ to: slug });
  if (work) {
    params.set("category", scope.category.slug);
    if (scope.area) params.set("area", scope.area.slug);
    else params.set("emirate", scope.emirate);
  }
  return `/rfq/new?${params}`;
}
