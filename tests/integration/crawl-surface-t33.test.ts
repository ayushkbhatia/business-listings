import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  FIXED_CLASSES,
  RANGED_CLASSES,
  isSitemapChunk,
  sitemapChunk,
  sitemapChunkIds,
} from "@/lib/seo/sitemap";
import { DISALLOWED_PATHS, isDisallowedPath } from "@/lib/seo/crawl-policy";

/**
 * Task T3.3 — the crawl surface, as properties rather than as a document.
 *
 * The audit itself is `scripts/audit-crawl-surface.mts`, which prints numbers
 * that move with the content. What belongs in a test is the part that must not
 * move: that every page class we ask to be indexed is submitted somewhere, and
 * that nothing submitted is also disallowed.
 *
 * It found three live gaps on 9 November 2026 — `/for-buyers`,
 * `/list-your-business` and `/lp/:campaign` were indexable, self-canonical and
 * in no sitemap class at all. Two of the three have their only internal links
 * inside the sign-up funnel and the third has none anywhere, so for those the
 * sitemap is not a hint, it is the path.
 */

/** Every path the `core` chunk is responsible for. */
const CORE_PATHS = [
  "/",
  "/categories",
  "/pricing",
  "/for-buyers",
  "/list-your-business",
] as const;

describe("T3.3 — every indexable class is submitted", () => {
  it("submits the fixed pages a crawler has no other route to", async () => {
    const core = await sitemapChunk("core");
    const urls = core.map((entry) => new URL(entry.url).pathname);

    for (const path of CORE_PATHS) {
      /*
         `/list-your-business` is the page a supplier searching "list my
         company UAE" is meant to land on, and it was reachable only from
         inside the sign-up funnel. A page with no inbound internal link and no
         sitemap entry is a page that does not exist as far as acquisition goes.
      */
      expect(urls, `${path} must be in the core chunk`).toContain(path);
    }
  });

  it("submits a published campaign page, which nothing on the site links to", async () => {
    const campaign = await prisma.campaign.findFirst({
      where: { publishedAt: { not: null } },
      select: { slug: true },
    });
    const chunk = await sitemapChunk("campaign");
    const urls = chunk.map((entry) => new URL(entry.url).pathname);

    if (campaign) {
      expect(urls).toContain(`/lp/${campaign.slug}`);
    } else {
      // An empty `urlset` is the correct statement when nothing is published.
      expect(urls).toEqual([]);
    }

    // And an unpublished one is not in it, for the reason every other class
    // re-checks rather than trusting intent.
    const draft = await prisma.campaign.findFirst({
      where: { publishedAt: null },
      select: { slug: true },
    });
    if (draft) expect(urls).not.toContain(`/lp/${draft.slug}`);
  });

  it("names every chunk it lists, and lists every chunk it names", async () => {
    const ids = await sitemapChunkIds();
    for (const id of ids) expect(isSitemapChunk(id), id).toBe(true);
    for (const name of FIXED_CLASSES) expect(ids).toContain(name);
    for (const name of RANGED_CLASSES) {
      // At least one file per ranged class, even at zero rows.
      expect(ids.some((id) => id.startsWith(`${name}-`)), name).toBe(true);
    }
  });

  it("submits nothing it also disallows", async () => {
    /*
       The contradiction guard, against the rendered document rather than
       against a list of prefixes. A sitemap entry for a disallowed path is the
       site telling a crawler to index a page it has asked it not to fetch.

       The fixed classes only: the ranged ones are tens of thousands of URLs of
       two shapes, and `/b/` is covered by the `/b/*?` facet rule rather than by
       a prefix in this list.
    */
    for (const name of FIXED_CLASSES) {
      const chunk = await sitemapChunk(name);
      for (const entry of chunk) {
        const path = new URL(entry.url).pathname;
        expect(isDisallowedPath(path, DISALLOWED_PATHS), `${name}: ${path}`).toBe(false);
      }
    }
  });

  it("answers an unknown chunk id with nothing, rather than an empty class", async () => {
    // The route turns this into a 404. An unknown file answering with an empty
    // `urlset` reads as "this class is empty", which is a different claim.
    expect(isSitemapChunk("business-x")).toBe(false);
    expect(await sitemapChunk("business-x")).toEqual([]);
    expect(await sitemapChunk("storefronts")).toEqual([]);
  });
});
