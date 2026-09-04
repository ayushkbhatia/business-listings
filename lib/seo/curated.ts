import "server-only";
import { prisma } from "@/lib/db/client";
import { VERIFIED_TIER } from "@/lib/verification";

/**
 * Board 6b — curated lists, and criterion 4.
 *
 *   "A curated list displays its selection criteria and cannot include a
 *    business that fails them; placement cannot be bought into one."
 *
 * The rules are here, in code, and there is no per-list override. That is the
 * whole design: a bar somebody can lower is a bar somebody can be sold, and
 * every other "best of" list in this market is sold. Stating the rules is the
 * only thing that makes ours worth reading — and it is why a seller chases
 * verification instead of chasing us.
 *
 * Three things follow from that, and each is asserted by a test:
 *
 *   1. **Membership is computed, never stored.** A supplier whose median reply
 *      slips past four hours leaves the list on the next render. There is no
 *      row to edit and no job to forget to run.
 *   2. **Nothing a seller buys appears in this file.** Not `planId`, not
 *      `rankingMultiplier`, not `PlacementSlot`. The ordering below is
 *      deliberately not `lib/search/ranking.ts`, because that one weighs plan
 *      tier — correctly, on a results page, and never here.
 *   3. **`CuratedList` has no placement column.** The cheapest way to guarantee
 *      placement cannot be bought is to have nowhere to put it.
 */

/** Median first reply, in milliseconds. Four hours, per board 6b. */
export const MAX_REPLY_MS = 4 * 3_600_000;

/** Reviews from real enquiries. Not testimonials, not imports. */
export const MIN_REVIEWS = 15;

export type CriterionKey = "verified" | "reply" | "reviews" | "placement";

export interface Criterion {
  key: CriterionKey;
  /** Required to appear at all, or weighted in the ordering. */
  kind: "required" | "weighted" | "never";
}

/**
 * Published on every list, in this order.
 *
 * `placement` is in the list precisely because it is a "never" — a rule about
 * what does not count is the one a reader most wants stated, and the one every
 * competitor omits.
 */
export const CRITERIA: readonly Criterion[] = [
  { key: "verified", kind: "required" },
  { key: "reply", kind: "required" },
  { key: "reviews", kind: "required" },
  { key: "placement", kind: "never" },
];

export interface ListMember {
  id: string;
  slug: string;
  displayName: string;
  verificationTier: number;
  responseTimeMedianMs: number;
  reviews: number;
  averageOverall: number;
  /** For the badge. Criterion 8: it says what was checked and when. */
  verifiedAt: Date | null;
  areaName: string | null;
}

export interface CuratedListView {
  id: string;
  slug: string;
  title: string;
  intro: string | null;
  categoryName: string;
  categorySlug: string;
  areaName: string | null;
  areaSlug: string | null;
  emirate: string | null;
  publishedAt: Date | null;
  members: ListMember[];
  /** Considered and rejected. The number is published; the names are not. */
  consideredCount: number;
}

const PUBLIC_BUSINESS = {
  suspendedAt: null,
  publishedAt: { not: null },
  mergedIntoId: null,
} as const;

/**
 * Who qualifies, and in what order.
 *
 * The three required rules are applied in the query where they can be, and the
 * review count in memory because it is a filtered count over a relation. The
 * ordering leads on verification tier, then reply speed, then how much evidence
 * there is.
 *
 * It used to lead on the site visit, which was the only weighted criterion and
 * is now not a thing this directory does. Nothing replaced it: inventing a new
 * weight to fill the slot would change who appears at the top of a published
 * list for a reason no reader was told about. The tier absorbs it — a visit was
 * what tier 3 meant, so the businesses it used to lift are the ones the tier
 * already ranks.
 */
export async function membersOf(scope: {
  categoryId: string;
  areaId?: string | null;
}): Promise<{ members: ListMember[]; considered: number }> {
  const candidates = await prisma.business.findMany({
    where: {
      ...PUBLIC_BUSINESS,
      primaryCategoryId: scope.categoryId,
      ...(scope.areaId ? { locations: { some: { areaId: scope.areaId, published: true } } } : {}),
    },
    select: {
      id: true,
      slug: true,
      displayName: true,
      verificationTier: true,
      responseTimeMedianMs: true,
      verifiedAt: true,
      locations: {
        where: { published: true },
        take: 1,
        select: { area: { select: { name: true } } },
      },
      reviews: {
        where: { removedAt: null, heldAt: null },
        select: { overall: true },
      },
    },
  });

  const members: ListMember[] = [];

  for (const business of candidates) {
    // Required: the trade licence has been checked against the authority.
    if (business.verificationTier < VERIFIED_TIER) continue;

    // Required: a measured median under four hours. Unmeasured is not "fast" —
    // non-negotiable 6, and the reason `responseTimeMedianMs` is nullable.
    const reply = business.responseTimeMedianMs;
    if (reply === null || reply > MAX_REPLY_MS) continue;

    // Required: enough reviews, and every `Review` row is gated to one enquiry
    // by a unique constraint — so "reviews from enquiries" is every review
    // there is, and a removed one does not count.
    if (business.reviews.length < MIN_REVIEWS) continue;

    members.push({
      id: business.id,
      slug: business.slug,
      displayName: business.displayName,
      verificationTier: business.verificationTier,
      responseTimeMedianMs: reply,
      reviews: business.reviews.length,
      averageOverall:
        business.reviews.reduce((total, review) => total + review.overall, 0) /
        business.reviews.length,
      verifiedAt: business.verifiedAt,
      areaName: business.locations[0]?.area?.name ?? null,
    });
  }

  /*
     Ordering, and what is deliberately absent from it.

     No plan, no ranking multiplier, no boost, no sponsored slot. A seller can
     buy a position on a results page — that is what a subscription is for and
     it is labelled where it happens — and cannot buy one here. This comparator
     is the whole of criterion 4's second half, so it reads only from columns
     staff or buyers write and the seller cannot.
  */
  members.sort(
    (a, b) =>
      b.verificationTier - a.verificationTier ||
      a.responseTimeMedianMs - b.responseTimeMedianMs ||
      b.reviews - a.reviews ||
      a.slug.localeCompare(b.slug),
  );

  return { members, considered: candidates.length };
}

/** One list, with its members resolved. Published only unless `draft` is set. */
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
      intro: true,
      publishedAt: true,
      categoryId: true,
      areaId: true,
      category: { select: { name: true, slug: true } },
      area: { select: { name: true, slug: true, emirate: true } },
    },
  });
  if (!list) return null;

  const { members, considered } = await membersOf({
    categoryId: list.categoryId,
    areaId: list.areaId,
  });

  return {
    id: list.id,
    slug: list.slug,
    title: list.title,
    intro: list.intro,
    categoryName: list.category.name,
    categorySlug: list.category.slug,
    areaName: list.area?.name ?? null,
    areaSlug: list.area?.slug ?? null,
    emirate: (list.area?.emirate as string | undefined) ?? null,
    publishedAt: list.publishedAt,
    members,
    consideredCount: considered,
  };
}

/**
 * Published lists that currently have somebody on them.
 *
 * A "best of" page with nobody on it is worse than no page: it says the trade
 * has no suppliers worth naming, which is never what we mean. Empty lists stay
 * unpublished-in-effect the same way a thin area page does.
 */
export async function liveLists(): Promise<
  { slug: string; title: string; members: number; updatedAt: Date }[]
> {
  const rows = await prisma.curatedList.findMany({
    where: { publishedAt: { not: null } },
    orderBy: { publishedAt: "desc" },
    select: { slug: true, title: true, categoryId: true, areaId: true, updatedAt: true },
  });

  const live = [];
  for (const row of rows) {
    const { members } = await membersOf({ categoryId: row.categoryId, areaId: row.areaId });
    if (members.length === 0) continue;
    live.push({ slug: row.slug, title: row.title, members: members.length, updatedAt: row.updatedAt });
  }
  return live;
}
