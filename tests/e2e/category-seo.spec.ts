import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Handoff 5, step 2 — boards 6c and 10a.
 *
 * The checkpoint is "add a subcategory in the database and show the page
 * appearing", which `tests/integration/landing.test.ts` proves against the data
 * layer. What is asserted here is the half a browser can see: that the derived
 * blocks render, that the FAQ markup and the visible FAQ are the same
 * questions, and that a thin page says `noindex` rather than quietly competing
 * with the pages we do want ranking.
 */

const SUB = "/c/hvac-and-ventilation/ducting";
const SECTOR = "/c/hvac-and-ventilation";

async function jsonLd(page: import("@playwright/test").Page) {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  return blocks.map((block) => JSON.parse(block) as Record<string, unknown>);
}

test.describe("board 6c — the category index", () => {
  test("lists every trade with its size, and links into each one", async ({ page }) => {
    await page.goto("/categories");
    await expect(page.getByRole("heading", { level: 1, name: "Every trade" })).toBeVisible();

    // Say the number: the lede carries three of them.
    // Board 6c's sub-line, and all four of its numbers are live.
    await expect(
      page.getByText(/\d+ sectors, [\d,]+ subcategories, \d+ emirates\. [\d,]+ licensed businesses/),
    ).toBeVisible();

    const sector = page.getByRole("heading", { level: 2, name: "HVAC & ventilation" });
    await expect(sector).toBeVisible();
    await sector.getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`${SECTOR}$`));
  });

  test("links a subcategory from its sector's card", async ({ page }) => {
    await page.goto("/categories");
    await page.getByRole("link", { name: /^Ducting \(\d+\)$/ }).click();
    await expect(page).toHaveURL(new RegExp(`${SUB}$`));
  });

  test("is reachable from the directory nav rather than greyed out", async ({ page }) => {
    // The nav's own links sit in a `hidden lg:flex` list, as home-compare says.
    test.skip((page.viewportSize()?.width ?? 0) < 1024, "the nav list is desktop-only");

    await page.goto("/");
    await page.getByRole("navigation").first().getByRole("link", { name: "Categories" }).click();
    await expect(page).toHaveURL(/\/categories$/);
  });

  test("is axe clean", async ({ page }) => {
    await page.goto("/categories");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
      // docs/contrast.md — the failing pairs are token-level and pinned.
      .disableRules(["color-contrast"])
      .analyze();
    const summary = results.violations.map((v) => ({ id: v.id, nodes: v.nodes.length }));
    expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
  });
});

test.describe("board 10a — the subcategory landing page", () => {
  test("breaks the suppliers down by emirate, as links into the filter", async ({ page }) => {
    await page.goto(SUB);
    await expect(page.getByRole("heading", { name: "By emirate" })).toBeVisible();

    const chip = page.getByRole("link", { name: /^(Dubai|Sharjah|Abu Dhabi) \(\d+\)$/ }).first();
    await expect(chip).toBeVisible();
    await chip.click();
    // The chip has to speak the URL the results page already understands.
    await expect(page).toHaveURL(/emirate=/);
  });

  test("asks questions whose answers carry numbers", async ({ page }) => {
    await page.goto(SUB);
    await expect(page.getByRole("heading", { name: "Questions buyers ask" })).toBeVisible();

    const faq = page.locator("dl").last();
    await expect(faq.getByText(/How many .* suppliers are listed\?/)).toBeVisible();
    // Say the number, never "many suppliers".
    await expect(faq.getByText(/\d+ on Business Listings/)).toBeVisible();
  });

  test("the FAQ markup and the visible FAQ are the same questions", async ({ page }) => {
    /*
       The one thing Google penalises here is structured data that does not
       match the page. Asserted by comparing the two lists rather than by
       checking the block exists.
    */
    await page.goto(SUB);

    const block = (await jsonLd(page)).find((entry) => entry["@type"] === "FAQPage");
    expect(block, "no FAQPage block on the page").toBeDefined();
    const marked = ((block?.mainEntity ?? []) as { name: string }[]).map((entry) => entry.name);
    expect(marked.length).toBeGreaterThan(0);

    const visible = await page.locator("dl").last().locator("dt").allTextContents();
    expect(visible).toEqual(marked);
  });

  test("offers filter chips from the trade's specification template", async ({ page }) => {
    /*
       The template is on "Valves & fittings", not on "Gate valves" — which is
       how a real taxonomy is shaped, and why the subcategory page found none
       and rendered no chips at all until it started asking its parent.
    */
    await page.goto("/c/valves-and-fittings/gate-valves");
    await expect(page.getByRole("heading", { name: "Filter by specification" })).toBeVisible();

    const chip = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Filter by specification" }) })
      .getByRole("link")
      .first();
    await expect(chip).toBeVisible();
    await chip.click();
    // A spec facet is a bare query key named for the field id.
    await expect(page).toHaveURL(/\?[^=]+=/);
  });

  test("says the verified share in the header", async ({ page }) => {
    await page.goto(SUB);
    await expect(page.getByText(/\d+ of \d+ verified/)).toBeVisible();
  });

  test("cross-links the other trades under the same parent", async ({ page }) => {
    await page.goto("/c/valves-and-fittings/gate-valves");
    await expect(page.getByRole("heading", { name: /Other trades in/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Butterfly valves \(\d+\)$/ })).toBeVisible();
  });

  test("stays out of the index while it is thin, and out of the sitemap too", async ({
    page,
    request,
  }) => {
    /*
       Not a 404. Somebody following a link should see the suppliers there are;
       there are simply not enough of them to put the page in front of a
       stranger who searched. `follow` stays on, because each listing it links
       to is worth indexing on its own.
    */
    const response = await page.goto(SUB);
    expect(response?.status()).toBe(200);

    const robots = await page.locator('meta[name="robots"]').getAttribute("content");
    expect(robots).toContain("noindex");
    expect(robots).toContain("follow");

    const xml = await (await request.get("/sitemap.xml")).text();
    expect(xml).not.toContain(SUB);
  });

  test("has exactly one h1", async ({ page }) => {
    await page.goto(SUB);
    await expect(page.locator("h1")).toHaveCount(1);
  });

  test("is axe clean", async ({ page }) => {
    await page.goto(SUB);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
      .disableRules(["color-contrast"])
      .analyze();
    const summary = results.violations.map((v) => ({ id: v.id, nodes: v.nodes.length }));
    expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
  });
});

test.describe("the sitemap", () => {
  test("carries the category index", async ({ request }) => {
    const xml = await (await request.get("/sitemap.xml")).text();
    expect(xml).toContain("/categories</loc>");
  });
});
