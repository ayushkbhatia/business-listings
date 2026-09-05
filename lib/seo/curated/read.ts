import "server-only";
import { prisma } from "@/lib/db/client";
import { VERIFIED_TIER } from "@/lib/verification";
/*
   One floor, imported rather than restated: the sitemap and the publish service
   must not be able to disagree about how short a list may be.
*/
import { MIN_MEMBERS, readCriteria, type Criterion } from "./criteria";

/**
 * Board 6b — the page a reader gets.
 *
 * ## Nothing here is live
 *
 * Acceptance 5: *"Every figure rendered to the reader comes from the snapshot on
 * the selection record. A live metric change does not alter the page."* The
 * metric strips, the reply bands and the criteria verdicts all read `snap*`
 * columns. The only live read on this path is the one below, and it is the one
 * §3 makes an exception of.
 *
 * ## The one live read, and why it is the only one
 *
 * A member whose **licence verification has lapsed** is dropped in the build.
 * That is the single criterion whose failure makes the page's central claim
 * false rather than stale: a page headed "licence verified — required" listing
 * a supplier whose licence is not verified is not out of date, it is untrue.
 *
 * Everything else — reply time drifting past four hours, a review being removed
 * — is staleness, and staleness goes to `compliance.ts`'s queue for a person to
 * act on. Dropping or reordering a member automatically would make the
 * surrounding prose wrong, because the prose cross-references its neighbours.
 *
 * When a drop happens the numerals close up and the hero gains a removal date
 * beside the audit date. Deliberately ugly: it should push editorial to
 * re-audit rather than sit.
 */

export interface ListMember {
  id: string;
  businessId: string;
  slug: string;
  displayName: string;
  /** As drawn, after any lapsed member has been removed and the gap closed. */
  rank: number;
  bestFor: string;
  prose: string;
  areaName: string | null;
  verificationTier: number;
  verifiedAt: Date | null;
  /* ── The snapshot. Never a live read. ─────────────────────────────────── */
  ratingOverall: number | null;
  reviewCount: number;
  responseTimeMedianMs: number;
  establishedYear: number | null;
  extraLabel: string | null;
  extraValue: string | null;
}

export interface CuratedListView {
  id: string;
  slug: string;
  title: string;
  standfirst: string | null;
  intro: string | null;
  categoryName: string;
  categorySlug: string;
  areaName: string | null;
  areaSlug: string | null;
  emirate: string | null;
  publishedAt: Date | null;
  /** What the hero and the method panel both print. Never a build date. */
  auditedAt: Date | null;
  /** Set when the build dropped a member for a lapsed licence. */
  entryRemovedAt: Date | null;
  criteria: Criterion[];
  members: ListMember[];
  /** Considered and rejected. The number is published; the names are not. */
  consideredCount: number;
}

/** One list as the reader gets it. Published only unless `includeDraft`. */
export async function curatedList(
  slug: string,
  options: { includeDraft?: boolean } = {},
): Promise<CuratedListView | null> {
  const list = await prisma.curatedList.findFirst({
    where: { slug, ...(options.includeDraft ? {} : { publishedAt: { not: null } }) },
    select: {
      id: true,
      slug: true,
      title: true,
      standfirst: true,
      intro: true,
      publishedAt: true,
      auditedAt: true,
      entryRemovedAt: true,
      consideredCount: true,
      criteria: true,
      category: { select: { name: true, slug: true } },
      area: { select: { name: true, slug: true, emirate: true } },
      members: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          businessId: true,
          bestFor: true,
          prose: true,
          snapRatingOverall: true,
          snapReviewCount: true,
          snapResponseMs: true,
          snapEstablishedYear: true,
          extraLabel: true,
          extraValue: true,
          business: {
            select: {
              slug: true,
              displayName: true,
              verificationTier: true,
              verifiedAt: true,
              suspendedAt: true,
              publishedAt: true,
              mergedIntoId: true,
              locations: {
                where: { published: true },
                take: 1,
                select: { area: { select: { name: true } } },
              },
            },
          },
        },
      },
    },
  });
  if (!list) return null;

  const members: ListMember[] = [];
  for (const row of list.members) {
    const business = row.business;
    /*
       The hard suppression, and the only live read on this path.

       A lapsed licence, a suspension, an unpublished listing or a merge-away
       each mean the entry describes something a reader cannot reach or that we
       can no longer stand behind. §States treats a deleted listing exactly as a
       lapse, and for the same reason: removal never reorders the survivors'
       relationships, it only closes a gap, so the prose stays correct.
    */
    if (business.verificationTier < VERIFIED_TIER) continue;
    if (business.suspendedAt !== null) continue;
    if (business.publishedAt === null) continue;
    if (business.mergedIntoId !== null) continue;

    members.push({
      id: row.id,
      businessId: row.businessId,
      slug: business.slug,
      displayName: business.displayName,
      // Closed up, not the stored position: a list that has lost entry 04 reads
      // 01…11, not 01, 02, 03, 05.
      rank: members.length + 1,
      bestFor: row.bestFor,
      prose: row.prose,
      areaName: business.locations[0]?.area?.name ?? null,
      verificationTier: business.verificationTier,
      verifiedAt: business.verifiedAt,
      ratingOverall: row.snapRatingOverall,
      reviewCount: row.snapReviewCount,
      responseTimeMedianMs: row.snapResponseMs,
      establishedYear: row.snapEstablishedYear,
      extraLabel: row.extraLabel,
      extraValue: row.extraValue,
    });
  }

  return {
    id: list.id,
    slug: list.slug,
    title: list.title,
    standfirst: list.standfirst,
    intro: list.intro,
    categoryName: list.category.name,
    categorySlug: list.category.slug,
    areaName: list.area?.name ?? null,
    areaSlug: list.area?.slug ?? null,
    emirate: (list.area?.emirate as string | undefined) ?? null,
    publishedAt: list.publishedAt,
    auditedAt: list.auditedAt,
    entryRemovedAt: list.entryRemovedAt,
    criteria: readCriteria(list.criteria),
    members,
    consideredCount: list.consideredCount,
  };
}

/**
 * Published lists that still have enough people on them, for the sitemap.
 *
 * A "best of" page below the floor is worse than no page: it says the trade has
 * almost nobody worth naming, which is never what we mean. Re-checked here
 * rather than trusted to `publishedAt`, the same discipline `livePages` uses —
 * a member whose licence lapsed this morning is already out of the count.
 */
export async function liveLists(): Promise<
  { slug: string; title: string; members: number; updatedAt: Date }[]
> {
  const rows = await prisma.curatedList.findMany({
    where: { publishedAt: { not: null } },
    orderBy: { publishedAt: "desc" },
    select: { slug: true, auditedAt: true, updatedAt: true },
  });

  const live = [];
  for (const row of rows) {
    const view = await curatedList(row.slug);
    if (!view || view.members.length < MIN_MEMBERS) continue;
    live.push({
      slug: view.slug,
      title: view.title,
      members: view.members.length,
      /*
         The audit date, not `updatedAt`. `lastmod` is a claim about when the
         content changed, and a re-audit is the only thing that changes it —
         the same rule `AreaPage.contentUpdatedAt` follows.
      */
      updatedAt: view.auditedAt ?? row.updatedAt,
    });
  }
  return live;
}
