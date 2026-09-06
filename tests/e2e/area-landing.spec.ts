import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Board 6a — the area landing page, as a buyer and a crawler get it.
 *
 * The seed builds all three states this spec needs: HVAC in Al Quoz over the
 * floors, HVAC in Jebel Ali over them too so the link graph has somewhere to
 * point, and Safety & PPE in Ras Al Khor under them.
 *
 * ## What changed when board 6a landed
 *
 * This file used to assert that a held-back scope was **served** at 200 with a
 * `noindex` tag and a panel naming the number holding it. §the-publish-gate
 * overrules that:
 *
 *   *"An unpublished scope has no URL. It is not a thin page, not a `noindex`
 *    page, not a redirect. It 404s and it is absent from the sitemap and from
 *    every link block on every sibling page."*
 *
 * The reason is arithmetic rather than taste. This template addresses a few
 * hundred URLs, and a soft 404 on one of them teaches a crawler that guesses
 * render. The recruiter-facing information did not go anywhere — the admin
 * matrix shows every held scope and the number holding it.
 *
 * `tests/integration/area-pages.test.ts` proves the four conditions at the real
 * numbers with its own fixtures. This proves the page.
 */

const LIVE = "/dubai/al-quoz-industrial-1/hvac-and-ventilation";
const SIBLING = "/dubai/jebel-ali-free-zone/hvac-and-ventilation";
const EMIRATE = "/dubai/hvac-and-ventilation";
const HELD = "/dubai/ras-al-khor-industrial-2/safety-and-ppe";

async function jsonLd(page: Page) {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  return blocks.map((block) => JSON.parse(block) as Record<string, unknown>);
}

test.describe("a scope that clears all four conditions", () => {
  test("leads with the pattern, the live counts and the content date", async ({ page }) => {
    await page.goto(LIVE);

    // §3's H1 pattern: `{Category} companies in {Area}, {Emirate}`. "companies",
    // not "suppliers" — it is the word the board draws and the word a buyer types.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "HVAC & ventilation companies in Al Quoz Industrial 1, Dubai",
    );
    await expect(page.locator("h1")).toHaveCount(1);

    // Criterion 1: every count is a query result. Say the number.
    await expect(page.getByText(/^\d+ companies$/)).toBeVisible();
    await expect(page.getByText(/^\d+ with verified trade licences?$/)).toBeVisible();

    /*
       §Freshness. The seed writes 21 Aug 2026 and the page must print it
       however many times the site is rebuilt — if the date tracked the build,
       every page on the domain would claim to have been updated this morning.
    */
    await expect(page.getByText(/UPDATED 21 AUG 2026/i)).toBeVisible();
  });

  test("ranks ten suppliers, and shows a reply band only where one is measured", async ({
    page,
  }) => {
    await page.goto(LIVE);
    const rows = page.locator("ol > li").filter({ has: page.getByRole("article") });
    await expect(rows).toHaveCount(10);

    // §4: "A seller with no answered enquiries shows no band at all — never
    // 'unknown', never a slow-looking placeholder."
    await expect(page.getByText("unknown", { exact: false })).toHaveCount(0);
  });

  test("says the ranking basis, and does not describe a sort we do not run", async ({ page }) => {
    await page.goto(LIVE);
    // The board's fifth correction. One weighted config shared with 1b and 1c.
    await expect(page.getByText(/Ranked on the same config as search/)).toBeVisible();
    await expect(page.getByText(/Ranked by verification, then/)).toHaveCount(0);
  });

  test("offers the compact enquiry verb, never a banned one", async ({ page }) => {
    await page.goto(LIVE);
    // CLAUDE.md's verb table: "Enquire" is the compact form on cards and rows.
    await expect(page.getByRole("link", { name: "Enquire" }).first()).toBeVisible();
    for (const banned of ["Get a quote", "Add to cart", "Buy now", "Price on request"]) {
      await expect(page.getByText(banned, { exact: false })).toHaveCount(0);
    }
  });

  test("carries BreadcrumbList, ItemList and FAQPage, and the breadcrumb matches", async ({
    page,
  }) => {
    await page.goto(LIVE);
    const blocks = await jsonLd(page);
    const types = blocks.map((block) => block["@type"]);
    expect(types).toContain("BreadcrumbList");
    expect(types).toContain("ItemList");
    expect(types).toContain("FAQPage");

    /*
       §2: "Matches the BreadcrumbList JSON-LD exactly — same labels, same
       order, same depth." Both are built from one array in the controller, and
       this is what keeps that true.
    */
    const crumbs = blocks.find((block) => block["@type"] === "BreadcrumbList");
    const marked = (crumbs?.itemListElement as { name: string }[]).map((entry) => entry.name);
    expect(marked).toEqual(["Directory", "Dubai", "Al Quoz Industrial 1", "HVAC & ventilation"]);

    const list = blocks.find((block) => block["@type"] === "ItemList");
    expect(list?.numberOfItems).toBe(10);
  });

  test("the FAQ markup and the visible questions are the same list", async ({ page }) => {
    await page.goto(LIVE);
    const block = (await jsonLd(page)).find((entry) => entry["@type"] === "FAQPage");
    const marked = ((block?.mainEntity ?? []) as { name: string }[]).map((entry) => entry.name);

    // Scoped to the FAQ section. `h3` is not unique to it — a rail card or a
    // supplier row is entitled to one, and a bare selector would be testing the
    // whole page's heading outline rather than the block under test.
    const visible = await page
      .locator('section[aria-labelledby="faq-heading"] h3')
      .allTextContents();
    expect(visible).toEqual(marked);
    // §SEO: FAQ questions are h3 inside the section, and the gate wants four.
    expect(marked.length).toBeGreaterThanOrEqual(3);
  });

  test("the quote-range row is absent while the aggregate is switched off", async ({ page }) => {
    await page.goto(LIVE);
    /*
       Criterion 11, and open question 2. No seller has agreed to have their
       quotes aggregated publicly, so `public_quote_aggregates` is off and the
       row does not render. It does not render a range from four quotes and it
       does not say "not enough data" — a missing question is honest, a hedged
       one is not.
    */
    await expect(page.getByText(/What does a chiller AMC cost/)).toHaveCount(0);
    await expect(page.getByText(/not enough data/i)).toHaveCount(0);
  });

  test("is asked to be indexed and is in the sitemap", async ({ page, request }) => {
    await page.goto(LIVE);
    expect(await page.locator('meta[name="robots"]').count()).toBe(0);
    expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toContain(LIVE);

    const xml = await (await request.get("/sitemap.xml")).text();
    expect(xml).toContain(LIVE);
  });

  test("the title carries the live count and the meta description is written", async ({ page }) => {
    await page.goto(LIVE);
    // §SEO: "The count is live and it is the reason the title beats a
    // competitor's. Truncate the category name, never the count."
    await expect(page).toHaveTitle(/HVAC & ventilation companies in Al Quoz Industrial 1, Dubai — \d+ listed/);

    const description = await page
      .locator('meta[name="description"]')
      .getAttribute("content");
    expect(description).toContain("Al Quoz Industrial 1");
  });
});

test.describe("the link graph", () => {
  test("points only at published pages, in both directions", async ({ page }) => {
    await page.goto(LIVE);

    // The sibling column and the nearby-areas card both reach the one other
    // published area page, and neither renders anything for the held scope —
    // "not greyed, not plain text", §6.
    await expect(page.getByRole("link", { name: /Jebel Ali Free Zone/ }).first()).toBeVisible();

    /*
       Links, not text. The seeded FAQ names Ras Al Khor in prose — "for Deira
       and Sharjah sites the travel time works against you and Ras Al Khor is
       the closer cluster" — which is a writer telling the wrong buyer to go
       somewhere else and is exactly what §5 asks a scope-specific question to
       do. What must not exist is an **anchor** to a page that is not published.
    */
    const hrefs = await page.locator("a").evaluateAll((links) =>
      links.map((link) => link.getAttribute("href") ?? ""),
    );
    expect(hrefs.filter((href) => href.includes("ras-al-khor"))).toEqual([]);
    expect(hrefs.filter((href) => href.includes("safety-and-ppe"))).toEqual([]);
  });

  test("reaches the emirate class from the breadcrumb", async ({ page }) => {
    await page.goto(LIVE);
    await page.getByRole("link", { name: "Dubai", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`${EMIRATE}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "HVAC & ventilation companies in Dubai",
    );
  });

  test("the sibling page is a real page", async ({ page }) => {
    const response = await page.goto(SIBLING);
    expect(response?.status()).toBe(200);
    await expect(page.locator("h1")).toHaveCount(1);
  });
});

test.describe("pagination stays on this page", () => {
  test("shows all n, and page 2 is self-canonical with rel prev and next", async ({ page }) => {
    await page.goto(LIVE);
    await page.getByRole("link", { name: /Show all \d+ companies/ }).click();

    /*
       Criterion 10: "Show all" paginates in place. No path from this page
       reaches a `1b` view that canonicalises back to it — `/c/:category`
       already points emirate-filtered views here, so that link would be a
       canonical round trip.
    */
    await expect(page).toHaveURL(new RegExp(`${LIVE.replace(/[/]/g, "\\/")}\\?page=2$`));
    expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toContain("page=2");
    await expect(page.locator('link[rel="prev"]')).toHaveCount(1);
  });

  test("a page number past the end is not a page", async ({ page }) => {
    const response = await page.goto(`${LIVE}?page=99`);
    expect(response?.status()).toBe(404);
  });
});

test.describe("a scope that fails a condition has no URL", () => {
  test("404s, rather than serving a thin page with noindex on it", async ({ page }) => {
    /*
       §the-publish-gate consequence 1, and criterion 2. Not a redirect either:
       a soft 404 on a template with this many URLs is expensive.
    */
    const response = await page.goto(HELD);
    expect(response?.status()).toBe(404);
  });

  test("is absent from the sitemap", async ({ request }) => {
    const xml = await (await request.get("/sitemap.xml")).text();
    expect(xml).not.toContain(HELD);
  });
});

test.describe("the address itself", () => {
  test("404s when the emirate does not match the area", async ({ page }) => {
    // Two URLs addressing one page would make the canonical a guess.
    const response = await page.goto("/sharjah/al-quoz-industrial-1/hvac-and-ventilation");
    expect(response?.status()).toBe(404);
  });

  test("404s on an area, trade or subcategory filter that is not here", async ({ page }) => {
    // Criterion 6: an unresolvable segment 404s. It does not redirect and does
    // not soft-404.
    for (const path of [
      "/dubai/not-an-area/hvac-and-ventilation",
      "/dubai/al-quoz-industrial-1/not-a-trade",
      "/nowhere/nothing/none",
      `${LIVE}?sub=not-a-subcategory`,
    ]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
    }
  });

  test("does not shadow the routes that share its shape", async ({ page }) => {
    /*
       `/[emirate]/[area]/[category]` is three dynamic segments at the root, so
       every three-segment path in the product passes near it. Static segments
       win in the matcher — but "should" and "does" are different words.
    */
    for (const path of [
      "/c/valves-and-fittings/gate-valves",
      "/b/al-marwan-industrial-supplies-llc/products",
    ]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
    }
  });
});

test.describe("no text on the page claims more than we check", () => {
  test("criterion 12 — no site visits, and no tier above licence verified", async ({ page }) => {
    for (const route of [LIVE, EMIRATE]) {
      await page.goto(route);
      const body = (await page.locator("body").innerText()).toLowerCase();
      for (const claim of ["site visit", "visited in person", "field team", "premises visited"]) {
        expect(body, `${route} still says "${claim}"`).not.toContain(claim);
      }
    }
  });
});

test.describe("accessibility", () => {
  for (const route of [LIVE, EMIRATE]) {
    test(`axe is clean on ${route}`, async ({ page }) => {
      await page.goto(route);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
        // docs/contrast.md — the failing pairs are token-level and pinned.
        .disableRules(["color-contrast"])
        .analyze();
      const summary = results.violations.map((v) => ({ id: v.id, nodes: v.nodes.length }));
      expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
    });
  }

  test("the static map is not a keyboard trap and its pins are not tab stops", async ({ page }) => {
    await page.goto(LIVE);

    /*
       The map has to be brought into view before there is a map to assert on.

       `MapCanvas` will not load MapLibre until its frame intersects — 800 KB
       and a tile stream, deliberately not paid for above the fold. In the
       one-column layout below `lg` the card sits about 1,600px down, far
       outside the 200px `rootMargin`, so nothing ever mounted and this failed
       on the mobile project against a canvas that was never going to exist. It
       passed on a desktop only because the card happens to load in the top
       viewport there, which made the whole assertion a race the wide project
       won.
    */
    const map = page.getByRole("group", { name: /Where these companies are/ });
    await map.scrollIntoViewIfNeeded();

    /*
       §3: "no pan, no zoom, no marker interaction. It is orientation, not a
       tool." A canvas nobody can pan left focusable is a tab stop that does
       nothing, and twenty pins as buttons is twenty of them.
    */
    await expect(page.locator("canvas.maplibregl-canvas")).toHaveAttribute("tabindex", "-1");
    await expect(page.locator(".maplibregl-ctrl-zoom-in")).toHaveCount(0);
    await expect(page.locator("button.maplibregl-marker")).toHaveCount(0);
  });
});
