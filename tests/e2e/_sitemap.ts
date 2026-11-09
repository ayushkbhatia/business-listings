import type { APIRequestContext } from "@playwright/test";

/**
 * Every URL the sitemap submits, across every chunk — T3.1.
 *
 * The file is an index now: `/sitemap-index.xml` lists `/sitemap/<class>.xml`,
 * because one document cannot hold 162,816 URLs and the protocol caps a file
 * at 50,000. A test that read one chunk would be testing one slice of the
 * directory and would pass or fail depending on which slice.
 *
 * So this follows the index and concatenates, which is what a crawler does.
 * `/sitemap.xml` redirects here, and `request.get` follows redirects, so the
 * conventional address works too — but naming the index is the honest thing
 * for a test to do.
 */
export async function sitemapXml(request: APIRequestContext): Promise<string> {
  const index = await request.get("/sitemap-index.xml");
  const body = await index.text();
  const locs = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]!);
  const chunks = await Promise.all(
    locs.map(async (loc) => (await request.get(new URL(loc).pathname)).text()),
  );
  return chunks.join("\n");
}
