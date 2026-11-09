import "server-only";
import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db/client";
import { STOREFRONT_TAB_COUNTS } from "@/lib/db/queries/business";
import { tabRoutes } from "@/lib/storefront/tabs";
import { LEGAL_PAGES } from "@/lib/legal/pages";
import { guideIndex } from "@/lib/guides/queries";
import { absoluteUrl } from "@/lib/site";
import { livePages } from "@/lib/seo/area";
import { liveLists } from "@/lib/seo/curated";
import { emiratePagePath, liveEmiratePages } from "@/lib/seo/emirate";
import { categoryIndex } from "@/lib/seo/taxonomy";
import { publiclyClaimed } from "@/lib/claims/status";
import { indexableListingWhere } from "@/lib/listing/index-rule";

/**
 * Task T3.1 — the sitemap, in chunks, because one file cannot hold it.
 *
 * ## The limit, and the four reads
 *
 * The Sitemaps protocol caps a file at **50,000 URLs** and 50 MB uncompressed.
 * One `sitemap.ts` built the whole thing in one array from four unbounded
 * `findMany` calls, and at 41,000 listings that is not close:
 *
 *   · 38,687 storefronts, plus up to five tabs each on the claimed ones;
 *   · 119,212 live products, one URL each;
 *   · every live service, every area page, every emirate cell, the taxonomy.
 *
 * Something over 180,000 URLs in a single document. A crawler rejects the file
 * whole, so the effect is not "some pages are missed" — it is that **nothing**
 * in it is submitted, which is the worst possible failure for the one file the
 * acquisition engine depends on. And the four reads load every row into one
 * process to build it.
 *
 * ## The shape
 *
 * One chunk per **class**, and a class that can exceed a chunk is split by
 * **id range**: `business-0`, `business-1`, `product-0`, and so on. Each chunk
 * reads only its own rows, with its own `take` and a keyset cursor on the id,
 * so no request in this file is unbounded any more.
 *
 * Classes rather than one flat numbering, for two reasons that both come from
 * operating it: a chunk that fails is a class you can name, and a crawler's
 * report of "landing pages indexed" is a report about one file.
 *
 * `/sitemap.xml` is the **index** that lists them — written by hand in
 * `app/sitemap.xml/route.ts`, because Next generates the chunks and not the
 * index that points at them.
 *
 * ## Why the per-class sizes differ
 *
 * A business row can emit six URLs — the storefront and up to five tabs — so
 * six thousand businesses is up to 36,000 URLs. A product row emits exactly
 * one. Sizing both the same would either waste four fifths of the product
 * chunks or burst the business ones.
 */

/** Well under the protocol's 50,000, with room for the tab URLs per business. */
const BUSINESSES_PER_CHUNK = 6_000;

/** One URL each, so this can run much closer to the limit. */
const ROWS_PER_CHUNK = 20_000;

const PUBLIC_BUSINESS = { suspendedAt: null, publishedAt: { not: null } } as const;

/**
 * The fixed classes, in the order the index lists them.
 *
 * `core` first because it is the pages a crawler should see whatever happens to
 * the rest, and the workhorses — the area pages the whole acquisition engine is
 * for — immediately after.
 */
export const FIXED_CLASSES = ["core", "area", "emirate", "taxonomy", "lists", "guides"] as const;

export type FixedClass = (typeof FIXED_CLASSES)[number];

/** A class that grows with the directory, and therefore splits. */
export const RANGED_CLASSES = ["business", "service", "product"] as const;

export type RangedClass = (typeof RANGED_CLASSES)[number];

const PER_CHUNK: Record<RangedClass, number> = {
  business: BUSINESSES_PER_CHUNK,
  service: ROWS_PER_CHUNK,
  product: ROWS_PER_CHUNK,
};

/**
 * Every chunk's id, which is also its filename: `/sitemap/business-2.xml`.
 *
 * Counted rather than guessed — three `count`s at build time — so a class that
 * grows past a chunk gains a file instead of silently losing its tail.
 */
export async function sitemapChunkIds(): Promise<string[]> {
  const now = new Date();
  const [businesses, services, products] = await Promise.all([
    prisma.business.count({ where: { ...PUBLIC_BUSINESS, ...indexableListingWhere(now) } }),
    prisma.service.count({ where: { status: "live", business: PUBLIC_BUSINESS } }),
    prisma.product.count({ where: { status: { not: "draft" }, business: PUBLIC_BUSINESS } }),
  ]);

  const counts: Record<RangedClass, number> = { business: businesses, service: services, product: products };
  const ranged = RANGED_CLASSES.flatMap((name) => {
    // At least one chunk per class, always. A class with nothing in it yet
    // still gets a file, and that file is an empty `urlset` — which is a
    // correct statement rather than a 404 a crawler records as an error.
    const chunks = Math.max(1, Math.ceil(counts[name] / PER_CHUNK[name]));
    return Array.from({ length: chunks }, (_, index) => `${name}-${String(index)}`);
  });

  return [...FIXED_CLASSES, ...ranged];
}

/** Whether an id is one this file will answer for. */
export function isSitemapChunk(id: string): boolean {
  return (FIXED_CLASSES as readonly string[]).includes(id) || /^(business|service|product)-\d+$/.test(id);
}

/* ── The chunks ───────────────────────────────────────────────────────────── */

/**
 * One chunk's URLs.
 *
 * Returns an empty array for an id nobody asked for, which the route turns
 * into a 404 — an unknown sitemap file must not answer with an empty document
 * that reads as "this class is empty".
 */
export async function sitemapChunk(id: string): Promise<MetadataRoute.Sitemap> {
  if ((FIXED_CLASSES as readonly string[]).includes(id)) return fixedChunk(id as FixedClass);

  const match = /^(business|service|product)-(\d+)$/.exec(id);
  if (!match) return [];
  const name = match[1] as RangedClass;
  const index = Number(match[2]);
  const skip = index * PER_CHUNK[name];
  const take = PER_CHUNK[name];

  if (name === "business") return businessChunk(skip, take);
  if (name === "service") return serviceChunk(skip, take);
  return productChunk(skip, take);
}

async function fixedChunk(name: FixedClass): Promise<MetadataRoute.Sitemap> {
  if (name === "core") return coreChunk();
  if (name === "area") return areaChunk();
  if (name === "emirate") return emirateChunk();
  if (name === "taxonomy") return taxonomyChunk();
  if (name === "lists") return listsChunk();
  return guidesChunk();
}

/**
 * The home page, the navigation and the five legal pages.
 *
 * `lastModified` is deliberately absent on the legal pages — 13f §1. Three of
 * the five are content modules with no timestamp of their own, and an invented
 * date is a claim a crawler discounts the next one for.
 */
async function coreChunk(): Promise<MetadataRoute.Sitemap> {
  const guides = await prisma.guide.count({ where: { publishedAt: { not: null } } });

  const entries: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), changeFrequency: "daily", priority: 1 },
    // Core navigation, linked from every page.
    { url: absoluteUrl("/categories"), changeFrequency: "weekly", priority: 0.7 },
    /*
       Board 1l. Indexable on purpose — "business listing UAE price" is a real
       query and this is the page that answers it. Weekly rather than daily:
       the figures come from the `Plan` table and a plan price moves about once
       a year.
    */
    { url: absoluteUrl("/pricing"), changeFrequency: "weekly", priority: 0.7 },
  ];

  if (guides > 0) {
    entries.push({ url: absoluteUrl("/guides"), changeFrequency: "weekly", priority: 0.6 });
    /*
       The page the index's author strip links to. It exists only once there is
       a programme to explain, and its whole content is the record of the
       checks — so it belongs here for the same reason the index does, and is
       absent for the same reason when nothing is published.
    */
    entries.push({ url: absoluteUrl("/guides/how-we-check"), changeFrequency: "monthly", priority: 0.3 });
  }

  for (const page of LEGAL_PAGES) {
    entries.push({ url: absoluteUrl(page.href), changeFrequency: "yearly", priority: 0.3 });
  }

  return entries;
}

/**
 * Board 6a. Live means staff intent *and* the floors holding right now —
 * `livePages` re-checks rather than trusting `publishedAt`, so a page whose
 * supply dropped this morning is out on the next build without waiting for the
 * sweep. Criterion 1's second half.
 */
async function areaChunk(): Promise<MetadataRoute.Sitemap> {
  const pages = await livePages();
  return pages.map((page) => ({
    url: absoluteUrl(`/${page.emirate}/${page.areaSlug}/${page.categorySlug}`),
    lastModified: page.updatedAt,
    changeFrequency: "daily" as const,
    // The workhorse. These are the pages the whole acquisition engine is for.
    priority: 0.9,
  }));
}

/**
 * Board 6c's matrix, filtered to the cells that clear their floors.
 *
 * The category index renders its links from the same call, which is what makes
 * criterion 4 hold by construction: the links on `/categories` and the URLs
 * here cannot drift, because there is one function and both read it.
 */
async function emirateChunk(): Promise<MetadataRoute.Sitemap> {
  const pages = await liveEmiratePages();
  return pages.map((page) => ({
    url: absoluteUrl(emiratePagePath(page.emirate, page.categorySlug)),
    changeFrequency: "daily" as const,
    priority: 0.8,
  }));
}

/**
 * The taxonomy, gated exactly as board 6f gates it — `categoryIndex` applies
 * the floors, and criterion 12 asks the sitemap and the admin matrix to agree
 * exactly, which one shared function is the only way to get.
 *
 * A top-level trade is core navigation the home page links to directly, so the
 * subcategory floors do not apply to it: holding it out of the sitemap while
 * linking to it from the front page would be the worst of both.
 */
async function taxonomyChunk(): Promise<MetadataRoute.Sitemap> {
  const sectors = await categoryIndex();
  const entries: MetadataRoute.Sitemap = [];
  for (const sector of sectors) {
    entries.push({ url: absoluteUrl(`/c/${sector.slug}`), changeFrequency: "daily", priority: 0.8 });
    for (const trade of sector.children) {
      if (!trade.publishable) continue;
      entries.push({ url: absoluteUrl(`/c/${sector.slug}/${trade.slug}`), changeFrequency: "daily", priority: 0.6 });
    }
  }
  return entries;
}

/**
 * Board 6b. A list with nobody on it is not here — `liveLists` drops those,
 * and a "best of" page showing none is thin whatever the reason.
 */
async function listsChunk(): Promise<MetadataRoute.Sitemap> {
  const lists = await liveLists();
  return lists.map((list) => ({
    url: absoluteUrl(`/best/${list.slug}`),
    lastModified: list.updatedAt,
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));
}

/**
 * Guides — boards 10b and 6d — and the subject shelves that have one.
 *
 * Published only, and no supply gate: 6f's floors count listings and verified
 * share, and a guide about payment terms has neither.
 */
async function guidesChunk(): Promise<MetadataRoute.Sitemap> {
  const [guides, index] = await Promise.all([
    prisma.guide.findMany({
      where: { publishedAt: { not: null } },
      orderBy: [{ slug: "asc" }],
      select: { slug: true, updatedAt: true },
    }),
    guideIndex(),
  ]);

  const entries: MetadataRoute.Sitemap = [];
  /*
     Board 10b §SEO: the subject views are real URLs, canonical to themselves.
     Only the shelves that HAVE guides, because an empty one 404s.
  */
  for (const shelf of index.shelves) {
    if (shelf.slug === null) continue;
    entries.push({ url: absoluteUrl(`/guides/${shelf.slug}`), changeFrequency: "weekly", priority: 0.5 });
  }
  for (const guide of guides) {
    entries.push({
      url: absoluteUrl(`/guides/${guide.slug}`),
      // `updatedAt`, not `publishedAt`. lastmod is a claim about when the
      // content changed, and a crawler that finds it moved with nothing to
      // show for it discounts the next one.
      lastModified: guide.updatedAt,
      changeFrequency: "monthly",
      priority: 0.6,
    });
  }
  return entries;
}

/**
 * One slice of storefronts, and the tabs each one actually has.
 *
 * Board 10g Q4: the **indexable** set, not the published one. An unclaimed
 * listing whose licence has lapsed, or that somebody has reported closed while
 * 4h decides, is `noindex` on its own page, and an entry for it here would be
 * the file asking for what the page refuses.
 */
async function businessChunk(skip: number, take: number): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const businesses = await prisma.business.findMany({
    where: { ...PUBLIC_BUSINESS, ...indexableListingWhere(now) },
    // The slice has to be stable between the index being written and a chunk
    // being fetched, so it is ordered on the primary key — T2.3's rule, and
    // here it is also what makes `skip` mean the same thing twice.
    orderBy: [{ id: "asc" }],
    skip,
    take,
    select: {
      slug: true,
      updatedAt: true,
      claimStatus: true,
      sellsKind: true,
      /*
         The counts each storefront tab 404s on when it is zero. Imported
         rather than restated: writing the predicate out got the reviews case
         wrong on the first attempt, because a bare count includes the removed
         and held reviews the tab refuses to render.
      */
      _count: { select: STOREFRONT_TAB_COUNTS },
    },
  });

  const entries: MetadataRoute.Sitemap = [];
  for (const business of businesses) {
    const claimed = publiclyClaimed(business.claimStatus);
    entries.push({
      url: absoluteUrl(`/b/${business.slug}`),
      lastModified: business.updatedAt,
      changeFrequency: "weekly",
      // An unclaimed listing is honest and thin by nature. It stays in the
      // sitemap — thirty thousand of them are how a supplier first finds us —
      // at a lower priority than a claimed one.
      priority: claimed ? 0.7 : 0.4,
    });
    if (!claimed) continue;

    /*
       Each tab only where it has something to render, and the list of tabs is
       `tabRoutes` — the same rule the header draws and every tab route 404s
       by. Asked a second way, it submitted the catalogue of a firm that sells
       only work, and never submitted the services tab at all.
    */
    for (const suffix of tabRoutes(business.sellsKind, {
      products: business._count.products,
      services: business._count.services,
      credentials: business._count.credentials,
      locations: business._count.locations,
      reviews: business._count.reviews,
    })) {
      entries.push({
        url: absoluteUrl(`/b/${business.slug}/${suffix}`),
        lastModified: business.updatedAt,
        changeFrequency: "weekly",
        priority: 0.5,
      });
    }
  }
  return entries;
}

/**
 * Board `1g-s`'s service pages — live, on published storefronts, which is the
 * same predicate `publicServiceFor` renders by, so nothing submitted here
 * redirects.
 */
async function serviceChunk(skip: number, take: number): Promise<MetadataRoute.Sitemap> {
  const services = await prisma.service.findMany({
    where: { status: "live", business: PUBLIC_BUSINESS },
    orderBy: [{ id: "asc" }],
    skip,
    take,
    select: { slug: true, updatedAt: true, business: { select: { slug: true } } },
  });
  return services.map((service) => ({
    url: absoluteUrl(`/b/${service.business.slug}/s/${service.slug}`),
    lastModified: service.updatedAt,
    changeFrequency: "weekly" as const,
    priority: 0.6,
  }));
}

async function productChunk(skip: number, take: number): Promise<MetadataRoute.Sitemap> {
  const products = await prisma.product.findMany({
    where: { status: { not: "draft" }, business: PUBLIC_BUSINESS },
    orderBy: [{ id: "asc" }],
    skip,
    take,
    select: { slug: true, updatedAt: true, business: { select: { slug: true } } },
  });
  return products.map((product) => ({
    url: absoluteUrl(`/b/${product.business.slug}/p/${product.slug}`),
    lastModified: product.updatedAt,
    changeFrequency: "weekly" as const,
    priority: 0.6,
  }));
}
