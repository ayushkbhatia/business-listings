import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db/client";
import { absoluteUrl } from "@/lib/site";
import { livePages } from "@/lib/seo/area";
import { categoryIndex } from "@/lib/seo/taxonomy";

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
  const [businesses, products, categories, areaPages, guides] = await Promise.all([
    prisma.business.findMany({
      where: PUBLIC_BUSINESS,
      select: { slug: true, updatedAt: true, claimStatus: true },
    }),
    prisma.product.findMany({
      where: { status: { not: "draft" }, business: PUBLIC_BUSINESS },
      select: { slug: true, updatedAt: true, business: { select: { slug: true } } },
    }),
    /*
       The taxonomy, gated exactly as board 6f gates it.

       This used to be a local count with `introWords: 250` hardcoded and a
       comment saying intro copy was a handoff 5 field. It is not — handoff 4
       added `Category.intro` and the page matrix has been counting its words
       since — so the third gate was passing vacuously here while the admin
       screen applied it. Criterion 12 asks these two to agree exactly, and one
       shared function is the only way they can.
    */
    categoryIndex(),
    /*
       Board 6a. Live means staff intent *and* the floors holding right now —
       `livePages` re-checks rather than trusting `publishedAt`, so a page whose
       supply dropped this morning is out of the sitemap on the next build
       without waiting for the sweep. Criterion 1's second half.
    */
    livePages(),
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

  for (const page of areaPages) {
    entries.push({
      url: absoluteUrl(`/${page.emirate}/${page.areaSlug}/${page.categorySlug}`),
      lastModified: page.updatedAt,
      changeFrequency: "daily",
      // The workhorse. These are the pages the whole acquisition engine is for.
      priority: 0.9,
    });
  }

  // The category index itself. Core navigation, linked from every page.
  entries.push({ url: absoluteUrl("/categories"), changeFrequency: "weekly", priority: 0.7 });

  for (const sector of categories) {
    /*
       Board 6f scopes the thresholds to "area landing pages and subcategory
       pages". A top-level trade is core navigation that the home page links to
       directly, and holding it out of the sitemap while linking to it from the
       front page would be the worst of both.
    */
    entries.push({
      url: absoluteUrl(`/c/${sector.slug}`),
      changeFrequency: "daily",
      priority: 0.8,
    });

    for (const trade of sector.children) {
      if (!trade.publishable) continue;
      entries.push({
        url: absoluteUrl(`/c/${sector.slug}/${trade.slug}`),
        changeFrequency: "daily",
        priority: 0.6,
      });
    }
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
