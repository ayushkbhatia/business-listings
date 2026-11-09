import type { MetadataRoute } from "next";
import { sitemapChunk, sitemapChunkIds } from "@/lib/seo/sitemap";

/**
 * Task T3.1 — one file per class, because one file cannot hold the directory.
 *
 * The protocol caps a sitemap at 50,000 URLs, and at 41,000 listings this was
 * something over 180,000 in a single document built from four unbounded reads.
 * A crawler rejects an oversized file whole, so the effect was not that some
 * pages would be missed — it was that **nothing** in it would be submitted.
 *
 * `lib/seo/sitemap.ts` owns the classes, their sizes and their queries. This is
 * the route, and it is deliberately thin: the chunking is a product decision
 * about what gets crawled and belongs where it can be tested without a build.
 *
 * Next serves these at `/sitemap/<id>.xml` and writes **no index**, so
 * `/sitemap.xml` is a route handler of its own — see `app/sitemap.xml/route.ts`
 * — and `robots.txt` points at it.
 */

export const revalidate = 3600;

export async function generateSitemaps(): Promise<{ id: string }[]> {
  return (await sitemapChunkIds()).map((id) => ({ id }));
}

export default async function sitemap({ id }: { id: Promise<string> }): Promise<MetadataRoute.Sitemap> {
  return sitemapChunk(await id);
}
