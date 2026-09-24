import "server-only";
import { cache } from "react";
import type { Prisma } from "@/lib/db/generated/client";
import type { CredentialKind, Emirate } from "@/lib/db/generated/enums";
import { prisma } from "@/lib/db/client";
import { isCheckable, currentCheckedCredential } from "@/lib/credentials/kinds";
import { dubaiDayStart } from "@/lib/format/date";
import { median } from "@/lib/metrics/response-time";
import { VERIFIED_TIER } from "@/lib/verification";
import {
  membershipOf,
  type CoverageFirm,
  type LandingPlace,
  type Membership,
} from "./services-coverage";

/**
 * Board `6a-s` — the firms a services landing page lists, read from the
 * database and decided by `membershipOf`.
 *
 * Two halves, the shape `1h-s`'s matcher takes for the same reason: the
 * database narrows to a superset it can express — public, in the trade, with a
 * coverage row or a branch somewhere in the emirate — and the rule itself runs
 * in TypeScript, where a service's effective coverage can be resolved. Every
 * member has a row in the place's emirate (its own or its default's) or a
 * branch there, so the superset loses nobody.
 *
 * Called by the gate, the stats, the route's page count, the freshness digest
 * and the ranking, and memoised per request on its primitive arguments: the
 * route's metadata, the route and the template ask for the same scope and must
 * get the same answer from one read.
 */

/** Published, not suspended, not merged away — the landing class's definition. */
const PUBLIC_FIRM = {
  suspendedAt: null,
  publishedAt: { not: null },
  mergedIntoId: null,
} as const;

/** What membership and the counts read, and nothing else. */
export const COVERAGE_FIRM_SELECT = {
  id: true,
  primaryCategoryId: true,
  verificationTier: true,
  licenceExpiry: true,
  claimStatus: true,
  responseTimeMedianMs: true,
  categories: { select: { categoryId: true } },
  // `id` last on the order so a firm's services arrive in a stable order —
  // the row names the first of them.
  services: {
    where: { status: "live" as const },
    orderBy: [{ position: "asc" as const }, { id: "asc" as const }],
    select: {
      id: true,
      categoryId: true,
      coverage: { select: { emirate: true, areaId: true } },
    },
  },
  serviceCoverage: { where: { serviceId: null }, select: { emirate: true, areaId: true } },
  locations: { where: { published: true }, select: { emirate: true, areaId: true } },
} satisfies Prisma.BusinessSelect;

export type CoverageFirmRow = Prisma.BusinessGetPayload<{ select: typeof COVERAGE_FIRM_SELECT }>;

export function toCoverageFirm(row: CoverageFirmRow): CoverageFirm {
  return {
    primaryCategoryId: row.primaryCategoryId,
    categoryIds: row.categories.map((link) => link.categoryId),
    services: row.services,
    coverageDefault: row.serviceCoverage,
    branches: row.locations,
  };
}

/**
 * The database's half: every firm that could be a member, and no fewer.
 *
 * Exported for the bulk readers — the matrix, the category index, the CRM
 * derivation — which pass several trades and an emirate-or-all.
 */
export function coverageCandidateWhere(input: {
  categoryIds: readonly string[];
  emirate?: Emirate | null;
}): Prisma.BusinessWhereInput {
  const trade = [...input.categoryIds];
  return {
    ...PUBLIC_FIRM,
    AND: [
      {
        OR: [
          { primaryCategoryId: { in: trade } },
          { categories: { some: { categoryId: { in: trade } } } },
          { services: { some: { status: "live", categoryId: { in: trade } } } },
        ],
      },
      input.emirate
        ? {
            OR: [
              { serviceCoverage: { some: { emirate: input.emirate } } },
              { locations: { some: { published: true, emirate: input.emirate } } },
            ],
          }
        : {
            OR: [{ serviceCoverage: { some: {} } }, { locations: { some: { published: true } } }],
          },
    ],
  };
}

/** One member of a page: the firm's facts the counts read, and how it is there. */
export interface ServicesMember {
  id: string;
  verificationTier: number;
  /** Licence-verified at the tier the badge calls verified, and not lapsed today. */
  verified: boolean;
  claimed: boolean;
  responseTimeMedianMs: number | null;
  membership: Membership;
}

/**
 * Whether a firm counts as licence-verified on this page right now.
 *
 * The tier, and a licence that has not lapsed. The nightly sweep drops a lapsed
 * tier; this closes the hours between the lapse and the job, the same gap
 * `findBriefCandidates` closes and the storefront closes by hiding the badge. A
 * page whose header counts "29 licence-verified" is not allowed to count one
 * that expired this morning.
 */
export function licenceVerified(
  row: { verificationTier: number; licenceExpiry: Date },
  now: Date,
): boolean {
  return row.verificationTier >= VERIFIED_TIER && row.licenceExpiry.getTime() >= now.getTime();
}

async function readMembers(
  categoryIdsKey: string,
  emirate: Emirate,
  areaId: string | null,
  nowMs: number,
): Promise<ServicesMember[]> {
  const categoryIds = categoryIdsKey.split(",");
  const now = new Date(nowMs);
  const place: LandingPlace = { emirate, areaId };
  const trade = new Set(categoryIds);

  const rows = await prisma.business.findMany({
    where: coverageCandidateWhere({ categoryIds, emirate }),
    select: COVERAGE_FIRM_SELECT,
    orderBy: { id: "asc" },
  });

  const out: ServicesMember[] = [];
  for (const row of rows) {
    const membership = membershipOf(toCoverageFirm(row), trade, place);
    if (!membership) continue;
    out.push({
      id: row.id,
      verificationTier: row.verificationTier,
      verified: licenceVerified(row, now),
      claimed: row.claimStatus === "claimed",
      responseTimeMedianMs: row.responseTimeMedianMs,
      membership,
    });
  }
  return out;
}

/*
   Per request. React's `cache` keys on argument identity, so the arguments are
   primitives: the trade as one sorted string, the place, and the minute —
   two renders a second apart in one request share a read, a job that walks
   four hundred pages at one `now` shares nothing it should not.
*/
const membersCached = cache(readMembers);

export interface MemberScope {
  categoryIds: readonly string[];
  emirate: Emirate;
  areaId: string | null;
}

/** The members of one page, in id order. */
export function servicesMembers(scope: MemberScope, now = new Date()): Promise<ServicesMember[]> {
  const minute = Math.floor(now.getTime() / 60_000) * 60_000;
  return membersCached([...scope.categoryIds].sort().join(","), scope.emirate, scope.areaId, minute);
}

/** The two numbers the publish gate reads. */
export async function servicesSupply(
  scope: MemberScope,
  now = new Date(),
): Promise<{ listings: number; verified: number }> {
  const members = await servicesMembers(scope, now);
  return { listings: members.length, verified: members.filter((member) => member.verified).length };
}

/* ── The stat line ────────────────────────────────────────────────────────── */

/**
 * Below this many measured firms, the page states no median.
 *
 * `lib/seo/faq.ts`'s floor for the same sentence on a subcategory page, and for
 * its reason: "3h 20m" drawn from two firms and from ninety are different
 * facts, and the stat line has no room to say which.
 */
export const MIN_MEASURED_FIRMS = 5;

export interface ServicesStats {
  firms: number;
  verified: number;
  unclaimed: number;
  /**
   * Firms holding the trade's credential, checked against its register and not
   * lapsed. Null where the trade names no credential a register can answer
   * for — never a nought stated about a check nobody can run.
   */
  credential: { kind: CredentialKind; holders: number } | null;
  /** The median of the members' own medians. Null under the floor. */
  replyMedianMs: number | null;
  replyMeasurable: number;
}

export async function servicesStats(
  scope: MemberScope,
  credentialKind: CredentialKind | null,
  now = new Date(),
): Promise<ServicesStats> {
  const members = await servicesMembers(scope, now);
  const replies = members
    .map((member) => member.responseTimeMedianMs)
    .filter((ms): ms is number => ms !== null);

  let credential: ServicesStats["credential"] = null;
  if (credentialKind && isCheckable(credentialKind)) {
    const holders =
      members.length === 0
        ? []
        : await prisma.credential.findMany({
            where: {
              businessId: { in: members.map((member) => member.id) },
              kind: credentialKind,
              ...currentCheckedCredential(dubaiDayStart(now)),
            },
            select: { businessId: true },
            distinct: ["businessId"],
          });
    credential = { kind: credentialKind, holders: holders.length };
  }

  return {
    firms: members.length,
    verified: members.filter((member) => member.verified).length,
    unclaimed: members.filter((member) => !member.claimed).length,
    credential,
    replyMedianMs: replies.length >= MIN_MEASURED_FIRMS ? median(replies) : null,
    replyMeasurable: replies.length,
  };
}

/* ── The bulk readers ─────────────────────────────────────────────────────── */

/**
 * Every firm that could be on any services page in these trades, in one read —
 * for the readers that answer for many pages at once: the 6f matrix, the
 * category index, the CRM's recruiting list.
 *
 * The same select and the same superset as a single page reads, so a bulk
 * count and the page it describes are the same function applied to the same
 * rows. `emirate` narrows the read where the caller asks about one.
 */
export async function loadCoverageFirms(
  categoryIds: readonly string[],
  emirate?: Emirate | null,
): Promise<CoverageFirmRow[]> {
  if (categoryIds.length === 0) return [];
  return prisma.business.findMany({
    where: coverageCandidateWhere({ categoryIds, emirate: emirate ?? null }),
    select: COVERAGE_FIRM_SELECT,
    orderBy: { id: "asc" },
  });
}

/** One trade a bulk reader asks about: the category and everything filed beneath it. */
export interface CoverageTrade {
  categoryId: string;
  categoryIds: readonly string[];
}

/** The key a place is filed under in `coverageGrid` — the area id, or the emirate. */
export function placeKey(place: LandingPlace): string {
  return place.areaId ?? `emirate:${place.emirate}`;
}

export interface GridCell {
  listings: number;
  verified: number;
  /** The members, in id order — for a digest or a candidate list. */
  memberIds: string[];
  /** The members that are not licence-verified, for the recruiting list. */
  unverifiedIds: string[];
}

/**
 * Supply for every (trade, place) pair asked about, from one load of firms.
 *
 * `membershipOf` per firm per pair — the exact function a single page runs —
 * with each trade's firms narrowed once, so the work is the trade's own firms
 * times the places rather than the directory times the places. Keyed
 * `${categoryId}:${placeKey(place)}`; a pair with nobody in it is absent,
 * which reads as nought.
 */
export function coverageGrid(
  firms: readonly CoverageFirmRow[],
  trades: readonly CoverageTrade[],
  places: readonly LandingPlace[],
  now: Date,
): Map<string, GridCell> {
  const shaped = firms.map((row) => ({ row, firm: toCoverageFirm(row) }));
  const out = new Map<string, GridCell>();

  for (const trade of trades) {
    const tree = new Set(trade.categoryIds);
    const inTrade = shaped.filter(
      ({ firm }) =>
        tree.has(firm.primaryCategoryId) ||
        firm.categoryIds.some((id) => tree.has(id)) ||
        firm.services.some((service) => tree.has(service.categoryId)),
    );
    if (inTrade.length === 0) continue;

    for (const place of places) {
      const cell: GridCell = { listings: 0, verified: 0, memberIds: [], unverifiedIds: [] };
      for (const { row, firm } of inTrade) {
        if (!membershipOf(firm, tree, place)) continue;
        cell.listings += 1;
        cell.memberIds.push(row.id);
        if (licenceVerified(row, now)) cell.verified += 1;
        else cell.unverifiedIds.push(row.id);
      }
      if (cell.listings > 0) out.set(`${trade.categoryId}:${placeKey(place)}`, cell);
    }
  }
  return out;
}
