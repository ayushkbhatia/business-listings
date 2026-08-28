import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db/client";
import { isPublishable } from "@/lib/publish-threshold";
import { absoluteUrl } from "@/lib/site";

/**
 * Published pages only.
 *
 * A sitemap is a claim that everything in it is worth indexing, so a suspended
 * business, an unpublished listing or a draft product must never appear —
 * submitting a URL that returns 404 or a thin page costs standing across the
 * whole domain, not just that page.
 *
 * The board 6f guard applies to subcategory pages and not to top-level
 * categories. routes.md scopes the thresholds to "area landing pages and
 * subcategory pages" — a top-level category is core navigation that the home
 * page links to directly, and holding it out of the sitemap while linking to
 * it from the front page would be the worst of both.
 */
export const revalidate = 3600;

const PUBLIC_BUSINESS = { suspendedAt: null, publishedAt: { not: null } } as const;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [businesses, products, categories, guides] = await Promise.all([
    prisma.business.findMany({
      where: PUBLIC_BUSINESS,
      select: { slug: true, updatedAt: true, claimStatus: true },
    }),
    prisma.product.findMany({
      where: { status: { not: "draft" }, business: PUBLIC_BUSINESS },
      select: { slug: true, updatedAt: true, business: { select: { slug: true } } },
    }),
    prisma.category.findMany({
      select: {
        slug: true,
        parentId: true,
        parent: { select: { slug: true } },
        _count: { select: { primaryFor: { where: PUBLIC_BUSINESS } } },
      },
    }),
    /*
       Guides — boards 10b and 6d.

       Published only, and no supply gate: the board 6f floors count listings
       and verified share, and a guide about payment terms has neither. What a
       guide answers to is the word floor, and `publishGuide` is the only path
       that sets `publishedAt` — so a row with one has already cleared it.
    */
    prisma.guide.findMany({
      where: { publishedAt: { not: null } },
      select: { slug: true, updatedAt: true },
    }),
  ]);

  // One query for the verified share per category, rather than one per row.
  const verifiedByCategory = await prisma.business.groupBy({
    by: ["primaryCategoryId"],
    where: { ...PUBLIC_BUSINESS, verificationTier: { gte: 2 } },
    _count: { _all: true },
  });
  const verifiedCounts = new Map(
    verifiedByCategory.map((row) => [row.primaryCategoryId, row._count._all]),
  );
  const categoryIds = await prisma.category.findMany({ select: { id: true, slug: true } });
  const idBySlug = new Map(categoryIds.map((c) => [c.slug, c.id]));

  const entries: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), changeFrequency: "daily", priority: 1 },
  ];

  if (guides.length > 0) {
    entries.push({ url: absoluteUrl("/guides"), changeFrequency: "weekly", priority: 0.6 });
  }
  for (const guide of guides) {
    entries.push({
      url: absoluteUrl(`/guides/${guide.slug}`),
      // `updatedAt`, not `publishedAt`. lastmod is a claim about when the
      // content changed, and a crawler that finds it moved with nothing to show
      // for it discounts the next one.
      lastModified: guide.updatedAt,
      changeFrequency: "monthly",
      priority: 0.6,
    });
  }

  for (const category of categories) {
    if (category.parentId) {
      const listings = category._count.primaryFor;
      const verified = verifiedCounts.get(idBySlug.get(category.slug) ?? "") ?? 0;
      // Intro copy is a handoff 5 field; until it exists the word count cannot
      // gate a page that is otherwise healthy, so only the supply floors apply.
      if (!isPublishable({ listings, verified, introWords: 250 })) continue;
      entries.push({
        url: absoluteUrl(`/c/${category.parent?.slug}/${category.slug}`),
        changeFrequency: "daily",
        priority: 0.6,
      });
      continue;
    }

    entries.push({
      url: absoluteUrl(`/c/${category.slug}`),
      changeFrequency: "daily",
      priority: 0.8,
    });
  }

  for (const business of businesses) {
    entries.push({
      url: absoluteUrl(`/b/${business.slug}`),
      lastModified: business.updatedAt,
      changeFrequency: "weekly",
      // An unclaimed listing is honest and thin by nature. It stays in the
      // sitemap — 30,000 of them are how a supplier first finds us — at a
      // lower priority than a claimed one.
      priority: business.claimStatus === "unclaimed" ? 0.4 : 0.7,
    });

    if (business.claimStatus !== "unclaimed") {
      for (const suffix of ["products", "branches", "reviews"]) {
        entries.push({
          url: absoluteUrl(`/b/${business.slug}/${suffix}`),
          lastModified: business.updatedAt,
          changeFrequency: "weekly",
          priority: 0.5,
        });
      }
    }
  }

  for (const product of products) {
    entries.push({
      url: absoluteUrl(`/b/${product.business.slug}/p/${product.slug}`),
      lastModified: product.updatedAt,
      changeFrequency: "weekly",
      priority: 0.6,
    });
  }

  return entries;
}
