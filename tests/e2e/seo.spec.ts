import { expect, test } from "@playwright/test";

/**
 * Handoff 1, step 6. Robots, sitemap and the per-page metadata.
 *
 * A sitemap is a claim that everything in it is worth indexing, so most of
 * these assert what is *absent*.
 */

const CLAIMED = "al-marwan-industrial-supplies-llc";
const UNCLAIMED = "al-wadi-technical-services-llc";

test.describe("robots.txt", () => {
  test("disallows the four surfaces that must not be indexed", async ({ request }) => {
    const body = await (await request.get("/robots.txt")).text();
    for (const path of ["/search", "/compare", "/dev", "/admin"]) {
      expect(body, path).toContain(`Disallow: ${path}`);
    }
    expect(body).toContain("Allow: /");
    expect(body).toMatch(/Sitemap: https?:\/\/.+\/sitemap\.xml/);
  });
});

test.describe("sitemap.xml", () => {
  async function locs(request: import("@playwright/test").APIRequestContext) {
    const xml = await (await request.get("/sitemap.xml")).text();
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
    const xml = await (await request.get("/sitemap.xml")).text();
    // 30,000 unclaimed pages are how a supplier first finds us.
    expect(xml).toContain(`/b/${UNCLAIMED}`);
    // But it has no catalogue, branches or reviews tab to submit.
    expect(xml).not.toContain(`/b/${UNCLAIMED}/products`);
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
