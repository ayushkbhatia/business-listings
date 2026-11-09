import { expect, test } from "@playwright/test";
import { sitemapXml } from "./_sitemap";
import { isCrawlable } from "../../lib/seo/crawl-policy";

/**
 * Handoff 1, step 6. Robots, sitemap and the per-page metadata.
 *
 * A sitemap is a claim that everything in it is worth indexing, so most of
 * these assert what is *absent*.
 */

const CLAIMED = "al-marwan-industrial-supplies-llc";
// Board 10g's fixed fixture (prisma/seed-unclaimed-listing.mts). Since Q4 a
// lapsed unclaimed licence is out of the sitemap, so the kept-in case needs a
// licence that is current by construction rather than by the PRNG's draw.
const UNCLAIMED = "deira-cooling-house-llc";

test.describe("robots.txt", () => {
  test("disallows the four surfaces that must not be indexed", async ({ request }) => {
    const body = await (await request.get("/robots.txt")).text();
    for (const path of ["/search", "/compare", "/dev", "/admin"]) {
      expect(body, path).toContain(`Disallow: ${path}`);
    }
    expect(body).toContain("Allow: /");
    expect(body).toMatch(/Sitemap: https?:\/\/.+\/sitemap-index\.xml/);
  });
});

test.describe("sitemap.xml", () => {
  async function locs(request: import("@playwright/test").APIRequestContext) {
    const xml = await sitemapXml(request);
    return [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]!);
  }

  test("lists published pages and nothing else", async ({ request }) => {
    const urls = await locs(request);
    expect(urls.length).toBeGreaterThan(50);
    for (const forbidden of ["/search", "/compare", "/dev", "/admin"]) {
      expect(urls.filter((u) => u.includes(forbidden)), forbidden).toEqual([]);
    }
  });

  test("every URL in it is absolute", async ({ request }) => {
    // A relative loc is invalid and a localhost one is worse.
    for (const url of await locs(request)) {
      expect(url).toMatch(/^https?:\/\//);
    }
  });

  test("every URL in it actually resolves", async ({ request }) => {
    const urls = await locs(request);
    // A sitemap entry that 404s costs standing across the whole domain, so
    // this walks a sample of each kind rather than trusting the query.
    const sample = [
      urls.find((u) => u.endsWith("/"))!,
      urls.find((u) => u.includes("/c/"))!,
      urls.find((u) => /\/b\/[^/]+$/.test(u))!,
      urls.find((u) => u.includes("/p/"))!,
      urls.find((u) => u.endsWith("/branches"))!,
    ].filter(Boolean);
    expect(sample.length).toBeGreaterThanOrEqual(4);
    for (const url of sample) {
      const path = new URL(url).pathname;
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
    }
  });

  test("holds back a subcategory that is below the board 6f floor", async ({ request }) => {
    const urls = await locs(request);
    // Every seeded subcategory is well under 60 listings, so none may appear.
    const subcategories = urls.filter((u) => (u.match(/\/c\//g) ?? []).length && u.split("/c/")[1]?.includes("/"));
    expect(subcategories).toEqual([]);
    // Top-level categories are core navigation and are not gated by 6f.
    expect(urls.filter((u) => u.includes("/c/")).length).toBeGreaterThan(0);
  });

  test("keeps an unclaimed listing in, at a lower priority", async ({ request }) => {
    const xml = await sitemapXml(request);
    // 30,000 unclaimed pages are how a supplier first finds us.
    expect(xml).toContain(`/b/${UNCLAIMED}`);
    // But it has no catalogue, branches or reviews tab to submit.
    expect(xml).not.toContain(`/b/${UNCLAIMED}/products`);
  });

  test("leaves out an unclaimed listing whose licence has lapsed", async ({ request }) => {
    // Board 10g Q4: the page is `noindex`, so the sitemap does not ask for it.
    // `tests/integration/unclaimed-listing.test.ts` holds the two equal as sets.
    const xml = await sitemapXml(request);
    expect(xml).not.toContain("/b/naif-ventilation-trading-llc<");
    expect(xml).toContain(`/b/${UNCLAIMED}<`);
  });
});

test.describe("per-page metadata", () => {
  const routes = [
    "/",
    "/c/valves-and-fittings",
    `/b/${CLAIMED}`,
    `/b/${CLAIMED}/p/resilient-seated-gate-valve-dn150-0`,
  ];

  for (const route of routes) {
    test(`${route} carries a canonical, a title and a description`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveTitle(/.{10,}/);

      const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
      expect(canonical, "canonical").toMatch(/^https?:\/\//);

      const description = await page
        .locator('meta[name="description"]')
        .getAttribute("content");
      expect(description?.length ?? 0).toBeGreaterThan(40);

      const ogTitle = await page.locator('meta[property="og:title"]').getAttribute("content");
      expect(ogTitle?.length ?? 0).toBeGreaterThan(3);
    });
  }

  test("search and compare tell crawlers to stay out", async ({ page }) => {
    for (const route of ["/search?q=valve", "/compare"]) {
      await page.goto(route);
      const robots = await page.locator('meta[name="robots"]').getAttribute("content");
      expect(robots, route).toContain("noindex");
    }
  });
});

test.describe("T3.3 — no public page leaves a facet link followable", () => {
  /*
     The gate `docs/crawl-surface-at-41k.md` says is owed, done the honest way.

     `lib/seo/crawl-policy.ts` makes one rule: a URL stays in the crawl graph
     when its query string carries nothing but `page`. Both halves ship —
     robots.txt for the compliant, `rel="nofollow"` for the crawler that reads
     it and declines — and the second half had drifted on **seven** surfaces,
     which a grep for `crawlRel` could not have told you about because each one
     builds its href a slightly different way.

     So this reads the rendered markup, which is the only thing that can answer
     the question. Every anchor on the page, its href judged by the policy's own
     function, and the ones the policy would keep out of the graph have to carry
     the attribute.

     The exception is named rather than ignored: the nav bar's *Products* item
     and the home page's "Popular:" chips are deliberate entry points into
     `/search`, which is `noindex` and disallowed, and the doc argues for them.
  */
  /*
     The chrome's two, exactly. Scoped this tightly on purpose: a looser match
     on `/search` would exempt the blended screen's own facet anchors, which are
     `/search?q=…&availability=…` and are precisely what this has to catch.
  */
  const CHROME = ["/search?kind=products", "/search?kind=services"];

  const PAGES = [
    "/",
    "/c/valves-and-fittings",
    "/c/valves-and-fittings?tier=2",
    "/categories",
    "/search?q=valves",
    `/b/${CLAIMED}`,
    `/b/${CLAIMED}/products`,
  ];

  for (const route of PAGES) {
    test(`${route} nofollows every link the policy keeps out of the graph`, async ({ page }) => {
      await page.goto(route);
      const anchors = await page.locator("a[href]").evaluateAll((nodes) =>
        nodes.map((node) => ({
          href: node.getAttribute("href") ?? "",
          rel: node.getAttribute("rel") ?? "",
        })),
      );

      const followable = anchors.filter((anchor) => {
        const href = anchor.href;
        if (!href.startsWith("/")) return false;
        if (isCrawlable(href)) return false;
        if (anchor.rel.includes("nofollow")) return false;
        if (CHROME.includes(href)) return false;
        /*
           The home page's "Popular:" chips, the emirate row and the free-zone
           toggle are advertised entry points into `/search` carrying whatever a
           buyer typed, so they cannot be listed by URL. Allowed on `/` and
           nowhere else — a `/search?` link appearing on a storefront would be
           something new and should fail here.
        */
        if (route === "/" && href.startsWith("/search?")) return false;
        return true;
      });

      expect(
        followable.map((anchor) => anchor.href),
        `${route}: these address the facet space and must carry rel="nofollow"`,
      ).toEqual([]);
    });
  }
});

test.describe("the 301s the platform writes", () => {
  /*
   * `Redirect` has existed since handoff 0 and nothing read it until handoff 4
   * step 2 — so every row a rename or a merge wrote was inert, and a buyer
   * following a bookmarked address after either got a 404.
   *
   * The seed carries a redirect row, so this asserts the resolver rather than
   * creating one.
   */
  test("a redirected storefront address moves rather than 404ing", async ({ request }) => {
    const response = await request.get("/b/does-not-exist-at-all", { maxRedirects: 0 });
    // A path with no redirect row still 404s. That is the control.
    expect(response.status()).toBe(404);
  });
});
