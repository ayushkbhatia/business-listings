import { prisma } from "@/lib/db/client";
import { VERIFIED_TIER } from "@/lib/verification";
import {
  guideHeadings,
  readGuideBlocks,
  readingMinutes,
  type GuideBlock,
  type GuideHeading,
} from "./blocks";

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
