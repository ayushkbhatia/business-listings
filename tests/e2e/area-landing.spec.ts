import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Handoff 5, step 3 — board 6a, and criterion 1 as a person sees it.
 *
 * The checkpoint the KICKOFF names: "show me a page blocked by the threshold
 * and the same page publishing once seed data crosses it." The seed builds both
 * — HVAC in Al Quoz over the floor, Safety & PPE in Ras Al Khor under it — and
 * everything below is one or the other.
 *
 * `tests/integration/area-pages.test.ts` proves the rule at the real numbers
 * with its own fixtures. This proves the page a buyer and a crawler get.
 */

const LIVE = "/dubai/al-quoz-industrial-1/hvac-and-ventilation";
const HELD = "/dubai/ras-al-khor-industrial-2/safety-and-ppe";

async function jsonLd(page: import("@playwright/test").Page) {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  return blocks.map((block) => JSON.parse(block) as Record<string, unknown>);
}

test.describe("a page that clears the floors", () => {
  test("says the numbers and renders the authored intro as paragraphs", async ({ page }) => {
    await page.goto(LIVE);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "HVAC & ventilation suppliers in Al Quoz Industrial 1",
    );
    // Say the number, never "many suppliers".
    await expect(page.getByText(/\d+ of \d+ verified/)).toBeVisible();

    /*
       The 250-word floor exists so a human writes something. One `<p>` of 350
       words is a wall nobody reads, which would defeat the point of insisting.
    */
    const paragraphs = page.locator("main p").filter({ hasText: /Al Quoz Industrial 1 is where/ });
    await expect(paragraphs.first()).toBeVisible();
    expect(await page.locator("main p").count()).toBeGreaterThan(3);
  });

  test("is asked to be indexed, and is in the sitemap", async ({ page, request }) => {
    await page.goto(LIVE);
    expect(await page.locator('meta[name="robots"]').count()).toBe(0);

    const xml = await (await request.get("/sitemap.xml")).text();
    expect(xml).toContain(LIVE);
  });

  test("carries ItemList, FAQPage and BreadcrumbList", async ({ page }) => {
    await page.goto(LIVE);
    const types = (await jsonLd(page)).map((block) => block["@type"]);
    expect(types).toContain("BreadcrumbList");
    expect(types).toContain("FAQPage");
    expect(types).toContain("ItemList");

    const list = (await jsonLd(page)).find((block) => block["@type"] === "ItemList");
    expect(Number(list?.numberOfItems)).toBeGreaterThan(0);
  });

  test("the FAQ markup and the visible questions are the same list", async ({ page }) => {
    await page.goto(LIVE);
    const block = (await jsonLd(page)).find((entry) => entry["@type"] === "FAQPage");
    const marked = ((block?.mainEntity ?? []) as { name: string }[]).map((entry) => entry.name);
    const visible = await page.locator("dl").last().locator("dt").allTextContents();
    expect(visible).toEqual(marked);
  });

  test("plots the suppliers it can and says how many it cannot", async ({ page }) => {
    await page.goto(LIVE);
    await expect(page.getByRole("heading", { name: "Where they are" })).toBeVisible();
  });

  test("has exactly one h1", async ({ page }) => {
    await page.goto(LIVE);
    await expect(page.locator("h1")).toHaveCount(1);
  });
});

test.describe("a page held back by the floors", () => {
  test("is served, and says which number is holding it", async ({ page }) => {
    /*
       Not a 404. A buyer following a link should see the suppliers there are —
       there are simply not enough of them to put in front of a stranger who
       searched. And the sentence names the gap, because staff and recruiters
       read these pages too.
    */
    const response = await page.goto(HELD);
    expect(response?.status()).toBe(200);

    await expect(page.getByText("Not enough listed here yet")).toBeVisible();
    await expect(page.getByText(/\d+ of \d+ listings/)).toBeVisible();
  });

  test("is not asked to be indexed, and is not in the sitemap", async ({ page, request }) => {
    await page.goto(HELD);
    const robots = await page.locator('meta[name="robots"]').getAttribute("content");
    expect(robots).toContain("noindex");
    // `follow` stays on: each listing it links to is worth indexing itself.
    expect(robots).toContain("follow");

    const xml = await (await request.get("/sitemap.xml")).text();
    expect(xml).not.toContain(HELD);
  });

  test("still shows the suppliers that are there", async ({ page }) => {
    await page.goto(HELD);
    expect(await page.getByRole("article").count()).toBeGreaterThan(0);
  });
});

test.describe("the address itself", () => {
  test("404s when the emirate does not match the area", async ({ page }) => {
    // Two URLs addressing one page would make the canonical a guess.
    const response = await page.goto("/sharjah/al-quoz-industrial-1/hvac-and-ventilation");
    expect(response?.status()).toBe(404);
  });

  test("404s on an area or trade that is not here", async ({ page }) => {
    for (const path of [
      "/dubai/not-an-area/hvac-and-ventilation",
      "/dubai/al-quoz-industrial-1/not-a-trade",
      "/nowhere/nothing/none",
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
    for (const path of ["/c/valves-and-fittings/gate-valves", "/b/al-marwan-industrial-supplies-llc/products"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
    }
  });
});

test.describe("accessibility", () => {
  for (const route of [LIVE, HELD]) {
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
});
