import { expect, test } from "@playwright/test";

/**
 * Handoff 5, step 6 — the technical layer, as a crawler sees it.
 *
 * Criteria 5, 6 and 12. Criteria 7 and 8 are service rules and live in
 * `tests/integration/technical-seo.test.ts`; what a browser adds here is the
 * markup and the headers, which is where these three actually happen.
 */

const PRODUCT = "/b/al-marwan-industrial-supplies-llc/p/resilient-seated-gate-valve-dn150-0";
const CATEGORY = "/c/hvac-and-ventilation";
const AREA_PAGE = "/dubai/al-quoz-industrial-1/hvac-and-ventilation";

async function jsonLd(page: import("@playwright/test").Page) {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  return blocks.map((block) => JSON.parse(block) as Record<string, unknown>);
}

test.describe("criterion 5 — Product omits price entirely", () => {
  test("has offers with availability and no price key at all", async ({ page }) => {
    /*
       "`Product` structured data omits price entirely rather than emitting an
       empty field." The distinction is the whole criterion: an empty
       `PriceSpecification` tells a crawler we have a price and are hiding it,
       which is a worse claim than the honest one — that this is an enquiry-led
       market and the number does not exist until a supplier quotes.
    */
    await page.goto(PRODUCT);
    const product = (await jsonLd(page)).find((block) => block["@type"] === "Product");
    expect(product, "no Product block on a product page").toBeDefined();

    const offers = product?.offers as Record<string, unknown> | undefined;
    expect(offers, "no offers on the Product block").toBeDefined();
    expect(offers?.availability).toBeTruthy();

    // Not "empty", not "0", not null — absent.
    const serialised = JSON.stringify(product);
    for (const forbidden of ["price", "priceCurrency", "priceSpecification", "lowPrice"]) {
      expect(serialised.toLowerCase(), `Product markup mentions ${forbidden}`).not.toContain(
        forbidden.toLowerCase(),
      );
    }
  });

  test("says on the page where a price would sit, rather than leaving a gap", async ({ page }) => {
    await page.goto(PRODUCT);
    await expect(page.getByText(/no price|quote|enquir/i).first()).toBeVisible();
  });
});

test.describe("criterion 6 — filtered views canonicalise", () => {
  test("an unfiltered category page canonicalises to itself", async ({ page }) => {
    await page.goto(CATEGORY);
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(canonical).toContain(CATEGORY);
  });

  test("a view filtered to one area points at that area's page where it is live", async ({
    page,
  }) => {
    /*
       `/c/hvac-and-ventilation?area=al-quoz-industrial-1` and the Al Quoz page
       answer the same query for the same buyer, and the second has the intro,
       the map, the FAQ and 250 words a person wrote. Left alone they split the
       signal and the thinner one sometimes wins.
    */
    await page.goto(`${CATEGORY}?area=al-quoz-industrial-1`);
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(canonical).toContain(AREA_PAGE);
  });

  test("a view filtered on anything else falls back to the trade page", async ({ page }) => {
    // `?tier=3` is a view of the trade, not a page in its own right, and there
    // is nothing better to point it at.
    await page.goto(`${CATEGORY}?tier=3`);
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(canonical).toContain(CATEGORY);
    expect(canonical).not.toContain("tier");
  });

  test("does not point at an area page that is asked not to be indexed", async ({ page }) => {
    /*
       A canonical aimed at a page carrying `noindex` tells a crawler to prefer
       something we have asked it to ignore — worse than pointing at the
       filtered view. Ras Al Khor is the seeded held-back page.
    */
    await page.goto("/c/safety-and-ppe?area=ras-al-khor-industrial-2");
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(canonical).toContain("/c/safety-and-ppe");
    expect(canonical).not.toContain("ras-al-khor");
  });

  test("/search and /compare stay out of the index", async ({ page }) => {
    for (const path of ["/search?q=valve", "/compare"]) {
      await page.goto(path);
      const robots = await page.locator('meta[name="robots"]').getAttribute("content");
      expect(robots, path).toContain("noindex");
    }
  });
});

test.describe("criterion 12 — the sitemap is only published pages", () => {
  async function locs(request: import("@playwright/test").APIRequestContext) {
    const xml = await (await request.get("/sitemap.xml")).text();
    return [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]!);
  }

  test("carries every page type this handoff built", async ({ request }) => {
    const urls = await locs(request);
    for (const fragment of ["/guides", "/categories", "/best/", AREA_PAGE]) {
      expect(urls.some((url) => url.includes(fragment)), fragment).toBe(true);
    }
  });

  test("holds nothing that is asked not to be indexed", async ({ request }) => {
    const urls = await locs(request);
    for (const forbidden of [
      "/search",
      "/compare",
      "/admin",
      "/dev",
      "/lp/",
      // The seeded area page that does not clear the floors.
      "/dubai/ras-al-khor-industrial-2/safety-and-ppe",
    ]) {
      expect(urls.filter((url) => url.includes(forbidden)), forbidden).toEqual([]);
    }
  });

  test("every URL in it is absolute and resolves", async ({ request }) => {
    const urls = await locs(request);
    const sample = [
      urls.find((url) => url.includes("/guides/"))!,
      urls.find((url) => url.includes("/categories"))!,
      urls.find((url) => url.includes("/best/"))!,
      urls.find((url) => url.includes(AREA_PAGE))!,
    ].filter(Boolean);
    expect(sample.length).toBeGreaterThanOrEqual(3);

    for (const url of sample) {
      expect(url).toMatch(/^https?:\/\//);
      const response = await request.get(new URL(url).pathname);
      expect(response.status(), url).toBe(200);
    }
  });

  test("names itself in robots.txt", async ({ request }) => {
    const body = await (await request.get("/robots.txt")).text();
    expect(body).toMatch(/Sitemap: https?:\/\/.+\/sitemap\.xml/);
  });
});

test.describe("criterion 8 — the alert is offered where a search fails", () => {
  test("appears on a zero-result page with the query it will watch for", async ({ page }) => {
    /*
       The end of the flywheel, and the only mechanism that turns a failed
       search into a future enquiry. A form nobody can reach would make
       criterion 8 a service with no caller.
    */
    await page.goto("/search?q=zzzznothingmatchesthiszzz");
    await expect(page.getByRole("heading", { name: /Tell me when somebody lists it/ })).toBeVisible();
    await expect(page.getByText(/zzzznothingmatchesthiszzz/).first()).toBeVisible();

    // A mobile number and nothing else. Asking a buyer whose search just failed
    // to create an account first would lose almost all of them.
    await expect(page.getByLabel("Mobile number")).toBeVisible();
    await expect(page.getByRole("button", { name: "Tell me when it is listed" })).toBeDisabled();
  });

  test("is not offered when there is no query to watch for", async ({ page }) => {
    // An alert on an empty query would fire on the next product anybody lists.
    await page.goto("/search?tier=4&emirate=fujairah");
    await expect(page.getByRole("heading", { name: /Tell me when somebody lists it/ })).toHaveCount(0);
  });
});
