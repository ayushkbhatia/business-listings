import { prisma } from "@/lib/db/client";
import { readGuideBlocks, type GuideBlock } from "./blocks";

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

export interface GuideCard {
  slug: string;
  title: string;
  summary: string;
  publishedAt: Date;
}

export interface GuideArticle extends GuideCard {
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
      byline: true,
      body: true,
      publishedAt: true,
      updatedAt: true,
      ctaCategory: { select: { slug: true, name: true } },
    },
  });
  if (!guide) return null;

  return {
    slug: guide.slug,
    title: guide.title,
    summary: guide.summary,
    byline: guide.byline,
    blocks: readGuideBlocks(guide.body),
    publishedAt: guide.publishedAt as Date,
    updatedAt: guide.updatedAt,
    cta: guide.ctaCategory,
  };
}
