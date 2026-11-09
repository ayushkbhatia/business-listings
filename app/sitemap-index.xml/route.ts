import { absoluteUrl } from "@/lib/site";
import { sitemapChunkIds } from "@/lib/seo/sitemap";

/**
 * Task T3.1 — the sitemap index, which Next does not write.
 *
 * `generateSitemaps()` produces the chunks at `/sitemap/<id>.xml` and stops
 * there. Nothing in the framework emits the `<sitemapindex>` that points at
 * them, and `/sitemap.xml` — which it owns and which `robots.txt` has always
 * named — **404s** once the function is in place. Checked against a running
 * build rather than inferred: before this file, `curl /sitemap.xml` returned
 * the not-found page while every chunk answered 200.
 *
 * So the index is written here, and it cannot live at `app/sitemap.xml/route.ts`
 * because Next still registers that path for its own metadata route and the
 * build refuses the pair ("Conflicting route and metadata at /sitemap.xml").
 * `next.config.ts` redirects the conventional address here, and `robots.txt`
 * names this one directly so a crawler takes no hop.
 *
 * Hand-written XML, because there is no convention for an index. Every `<loc>`
 * is a URL this code built from a fixed list of class names and a chunk
 * number — no row, no slug, nothing a seller or a buyer can write — so there
 * is nothing here to escape.
 *
 * `lastmod` is deliberately absent. It would have to be the newest row in each
 * chunk, which is a query per chunk to state something a crawler re-checks
 * anyway, and an invented date is a claim it discounts the next one for — the
 * rule this sitemap already follows for the legal pages.
 */

export const revalidate = 3600;
export const dynamic = "force-static";

export async function GET(): Promise<Response> {
  const ids = await sitemapChunkIds();
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...ids.map((id) => `<sitemap><loc>${absoluteUrl(`/sitemap/${id}.xml`)}</loc></sitemap>`),
    "</sitemapindex>",
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      // An hour, as the chunks have: a new area page is worth a crawl today,
      // not this minute.
      "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
