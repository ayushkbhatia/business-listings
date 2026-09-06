import { cache } from "react";
import { prisma } from "@/lib/db/client";
import { VERIFIED_TIER } from "@/lib/verification";
import {
  guideHeadings,
  readGuideBlocks,
  readingMinutes,
  type GuideBlock,
  type GuideHeading,
} from "./blocks";
import { freshness, type Freshness } from "./freshness";

/**
 * The public reads — boards 10b and 6d.
 *
 * Published only, in both. An unpublished guide is a draft, and a draft that a
 * crawler can reach is the thin page the whole handoff exists to prevent.
 *
 * Not `server-only`: the sitemap and the two routes are the callers today, and
 * the shapes here carry nothing a reader on the page could not already see.
 */

const PUBLISHED = { publishedAt: { not: null } } as const;

/** What the public sees on the directory side. One definition, shared. */
const PUBLISHED_BUSINESS = {
  suspendedAt: null,
  publishedAt: { not: null },
  mergedIntoId: null,
} as const;

export interface GuideCard {
  slug: string;
  title: string;
  summary: string;
  publishedAt: Date;
}

/**
 * One row on board 10b's index.
 *
 * Everything the index prints, computed once. `readMinutes` and `freshness`
 * both need the body and the two dates, so a card that carried only a title
 * would mean a second read per row on the page that lists every guide there is.
 */
export interface GuideIndexCard extends GuideCard {
  /** The sentence that states the problem. Falls back to the summary. */
  standfirst: string;
  /** Where the index files it. Null renders under "Not yet filed". */
  subject: { slug: string; name: string } | null;
  readMinutes: number;
  /** Board 10b §Dates: when a person last checked, and whether that is due. */
  freshness: Freshness;
  /** The `START HERE` slot. At most one across the programme. */
  featured: boolean;
  /** Why this one is first, written with the slot. Null renders no line. */
  featuredNote: string | null;
}

/** A shelf on the index, with its guides in the editor's order. */
export interface GuideShelf {
  slug: string | null;
  name: string;
  blurb: string | null;
  guides: GuideIndexCard[];
}

export interface GuideIndex {
  /** Every published guide, once, in reading order. The count comes from here. */
  all: GuideIndexCard[];
  /** The same guides grouped by subject. Subjects with none are absent. */
  shelves: GuideShelf[];
  /** The editorial slot, or null. The page renders no empty hero. */
  featured: GuideIndexCard | null;
  /**
   * The most recent check across the programme, and how many fell this quarter.
   *
   * Board 10b §2 puts both in the author strip. Both are queries: the render
   * hardcoded "LAST REVIEW PASS 28 AUG 2026 · 22 GUIDES · 7 REVIEWED THIS
   * QUARTER", and §States is explicit that the quarter count is not suppressed
   * when it reads nought — "that is the number that makes the queue on 6f get
   * worked".
   */
  lastReviewPass: Date | null;
  reviewedThisQuarter: number;
}

export interface GuideRelatedCard {
  slug: string;
  title: string;
  readMinutes: number;
}

export interface GuideArticle extends GuideCard {
  /** The sentence that states the problem. Falls back to the index summary. */
  standfirst: string;
  /** The kicker's middle term. Not a trade — a guide may belong to none. */
  topic: string | null;
  bylineRole: string | null;
  /** Derived from the `h2` blocks, never authored. §3, acceptance 4. */
  headings: GuideHeading[];
  readMinutes: number;
  regulatoryCheckedAt: Date | null;
  related: GuideRelatedCard[];
  byline: string | null;
  blocks: GuideBlock[];
  updatedAt: Date;
  /** Where the article sends the reader, resolved. Null means the directory. */
  cta: { slug: string; name: string } | null;
}

/**
 * Board 10b — every published guide, grouped, with everything the index prints.
 *
 * Wrapped in React's `cache`, because one render asks for it more than once:
 * the subject route's `generateMetadata` needs it to decide whether the shelf
 * exists at all, and then the page body needs it again. Without the memo that
 * is two full reads of every published guide's body per request.
 *
 * One read. The board's page carries four chip counts, an "All 22", a heading,
 * a standfirst that spells the number in words, and a per-subject count in the
 * `Every guide` block — nine numbers that have to be the same number, and the
 * only way they stay that way is that there is one query behind them.
 *
 * Ordered by the editor's sequence within each subject rather than by date.
 * Board 10b Q1: *"Newest review first turns the index into a changelog, and a
 * guide re-checked yesterday is not more useful than the one that explains the
 * badge."* The review date is shown; it does not sort.
 */
export const guideIndex = cache(async (now = new Date()): Promise<GuideIndex> => {
  const rows = await prisma.guide.findMany({
    where: PUBLISHED,
    orderBy: [
      { subject: { sortOrder: "asc" } },
      { subject: { name: "asc" } },
      { sortOrder: "asc" },
      { publishedAt: "desc" },
    ],
    select: {
      slug: true,
      title: true,
      summary: true,
      standfirst: true,
      body: true,
      publishedAt: true,
      regulatoryCheckedAt: true,
      reviewCadenceMonths: true,
      featuredAt: true,
      featuredNote: true,
      subject: { select: { slug: true, name: true, blurb: true, sortOrder: true } },
    },
  });

  const all: GuideIndexCard[] = rows.map((row) => ({
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    // The standfirst states the problem; the summary describes the article.
    // Falling back keeps a guide written before the column existed readable
    // rather than blank — the same fallback the article template makes.
    standfirst: row.standfirst?.trim() || row.summary,
    subject: row.subject ? { slug: row.subject.slug, name: row.subject.name } : null,
    readMinutes: readingMinutes(row.body),
    freshness: freshness(row, now),
    featured: row.featuredAt !== null,
    featuredNote: row.featuredNote,
    publishedAt: row.publishedAt as Date,
  }));

  const shelves: GuideShelf[] = [];
  const byName = new Map<string, GuideShelf>();
  for (const [index, card] of all.entries()) {
    const source = rows[index]?.subject ?? null;
    /*
       A guide with no subject still gets a shelf and a link.

       It is the case the whole board exists to prevent: an article reachable
       only if somebody thought to file it. Filing is editorial work that has
       not happened yet, and the honest answer is a shelf that says so rather
       than a guide missing from its own index.
    */
    const key = source?.slug ?? "";
    let shelf = byName.get(key);
    if (!shelf) {
      shelf = {
        slug: source?.slug ?? null,
        name: source?.name ?? "",
        blurb: source?.blurb ?? null,
        guides: [],
      };
      byName.set(key, shelf);
      shelves.push(shelf);
    }
    shelf.guides.push(card);
  }

  const checks = all
    .map((card) => card.freshness.checkedAt)
    .filter((date): date is Date => date !== null)
    .sort((a, b) => b.getTime() - a.getTime());

  const quarterStart = new Date(
    Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1),
  );

  return {
    all,
    shelves,
    featured: all.find((card) => card.featured) ?? null,
    lastReviewPass: checks[0] ?? null,
    reviewedThisQuarter: checks.filter((date) => date >= quarterStart).length,
  };
});

export async function publishedGuides(): Promise<GuideCard[]> {
  const rows = await prisma.guide.findMany({
    where: PUBLISHED,
    orderBy: { publishedAt: "desc" },
    select: { slug: true, title: true, summary: true, publishedAt: true },
  });
  // `publishedAt` is non-null by the filter; Prisma's type does not know that.
  return rows.map((row) => ({ ...row, publishedAt: row.publishedAt as Date }));
}

export async function guideBySlug(slug: string): Promise<GuideArticle | null> {
  const guide = await prisma.guide.findFirst({
    where: { slug, ...PUBLISHED },
    select: {
      slug: true,
      title: true,
      summary: true,
      standfirst: true,
      topic: true,
      byline: true,
      bylineRole: true,
      body: true,
      publishedAt: true,
      updatedAt: true,
      regulatoryCheckedAt: true,
      ctaCategory: { select: { slug: true, name: true } },
      /*
         Board 6d §6: three, chosen by an editor, not by tag similarity — and
         the rail's job is partly to point at the article covering what this one
         deliberately does not. Unpublished ones are filtered out here rather
         than in the component: a rail entry promising a draft is a 404 on the
         page class we most want crawled.
      */
      related: {
        orderBy: { position: "asc" },
        where: { to: PUBLISHED },
        select: {
          to: { select: { slug: true, title: true, body: true } },
        },
      },
    },
  });
  if (!guide) return null;

  const blocks = readGuideBlocks(guide.body);

  return {
    slug: guide.slug,
    title: guide.title,
    summary: guide.summary,
    standfirst: guide.standfirst ?? guide.summary,
    topic: guide.topic,
    byline: guide.byline,
    bylineRole: guide.bylineRole,
    blocks,
    /* §3 and §4: both derived, never authored. */
    headings: guideHeadings(blocks),
    readMinutes: readingMinutes(guide.body),
    publishedAt: guide.publishedAt as Date,
    updatedAt: guide.updatedAt,
    /*
       §Evergreen: `Article.dateModified` renders this, not `updatedAt`. A typo
       fix moves `updatedAt`; only an editor re-checking the external facts
       moves this one, and a crawler told the content changed with nothing to
       show for it discounts the next signal.
    */
    regulatoryCheckedAt: guide.regulatoryCheckedAt,
    cta: guide.ctaCategory,
    related: guide.related.map((row) => ({
      slug: row.to.slug,
      title: row.to.title,
      readMinutes: readingMinutes(row.to.body),
    })),
  };
}

/**
 * What the closing call to action counts — board 6d §Data, acceptance 9.
 *
 * *"The CTA count and the nav count use different denominators and both were
 * constants on the board."* This one counts **sellers with an active
 * licence-verified tier**; the nav counts listings plus catalogue products.
 * They are not comparable and nothing on the page should invite the comparison,
 * which is why the copy says what it counts rather than printing a bare number.
 *
 * "Active" is doing work: `sweepExpiredLicences` drops a lapsed listing below
 * the badge threshold nightly, so this is a count of suppliers whose licence is
 * currently checked and current, not of suppliers who were once checked.
 */
export async function verifiedSellerCount(): Promise<number> {
  return prisma.business.count({
    where: { ...PUBLISHED_BUSINESS, verificationTier: { gte: VERIFIED_TIER } },
  });
}
