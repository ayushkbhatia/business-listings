import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Handoff 5, step 1 — boards 10b and 6d.
 *
 * The checkpoint is "one guide with Article structured data and a working
 * directory CTA", so those are the two things asserted hardest: the JSON-LD is
 * parsed rather than pattern-matched, and the call to action is followed to a
 * page that returns results rather than merely being present in the markup.
 */

const SLUG = "what-supplier-verification-actually-proves";

async function jsonLd(page: import("@playwright/test").Page) {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  return blocks.map((block) => JSON.parse(block) as Record<string, unknown>);
}

test.describe("the guide index", () => {
  test("lists the published guide and links to it", async ({ page }) => {
    await page.goto("/guides");
    await expect(page.getByRole("heading", { level: 1, name: "Guides" })).toBeVisible();

    const link = page.getByRole("link", { name: /what supplier verification/i });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/guides/${SLUG}$`));
  });

  test("is reachable from the directory nav rather than greyed out", async ({ page }) => {
    /*
       The nav carried `later: true` on this link from handoff 1 — named so the
       shape was right, not linked because the page did not exist. This is the
       assertion that it stopped being a placeholder.

       The nav's own links sit in a `hidden lg:flex` list, so below 1024 there
       is nothing to click. That is the design, and `home-compare.spec.ts` says
       so at the same width.
    */
    test.skip((page.viewportSize()?.width ?? 0) < 1024, "the nav list is desktop-only");

    await page.goto("/");
    await page.getByRole("navigation").first().getByRole("link", { name: "Guides" }).click();
    await expect(page).toHaveURL(/\/guides$/);
  });
});

test.describe("a guide article", () => {
  test("carries Article structured data with real dates", async ({ page }) => {
    await page.goto(`/guides/${SLUG}`);
    const article = (await jsonLd(page)).find((block) => block["@type"] === "Article");

    expect(article, "no Article block on the page").toBeDefined();
    expect(article?.headline).toBe("What supplier verification actually proves");
    expect(String(article?.datePublished)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(String(article?.dateModified)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(String(article?.mainEntityOfPage)).toContain(`/guides/${SLUG}`);
    // Never a blank author: schema.org wants a person or an organisation.
    expect(article?.author).toMatchObject({ name: expect.any(String) });
  });

  test("carries a breadcrumb trail back to the index", async ({ page }) => {
    await page.goto(`/guides/${SLUG}`);
    const crumbs = (await jsonLd(page)).find((block) => block["@type"] === "BreadcrumbList");
    const items = (crumbs?.itemListElement ?? []) as { name: string; item?: string }[];
    expect(items.map((item) => item.item)).toContain("/guides");
  });

  test("has exactly one h1, and the body headings sit under it", async ({ page }) => {
    await page.goto(`/guides/${SLUG}`);
    await expect(page.locator("h1")).toHaveCount(1);
    expect(await page.locator("h2").count()).toBeGreaterThan(1);
  });

  test("the directory call to action reaches a page with results on it", async ({ page }) => {
    await page.goto(`/guides/${SLUG}`);

    const cta = page.getByRole("link", { name: /^browse |^find a supplier$/i }).first();
    await expect(cta).toBeVisible();
    await cta.click();

    // A CTA that lands on an empty category is not a working CTA.
    await expect(page).toHaveURL(/\/c\/|\/search/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await page.getByRole("article").count()).toBeGreaterThan(0);
  });

  test("an unpublished address is a 404, not a draft on the open web", async ({ page }) => {
    const response = await page.goto("/guides/not-a-guide-that-exists");
    expect(response?.status()).toBe(404);
  });
});

test.describe("the sitemap", () => {
  test("carries the index and the published article", async ({ request }) => {
    const xml = await (await request.get("/sitemap.xml")).text();
    const urls = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]!);

    expect(urls.some((url) => url.endsWith("/guides"))).toBe(true);
    expect(urls.some((url) => url.endsWith(`/guides/${SLUG}`))).toBe(true);
  });
});

test.describe("accessibility", () => {
  for (const route of ["/guides", `/guides/${SLUG}`]) {
    test(`axe is clean on ${route}`, async ({ page }) => {
      await page.goto(route);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
        // Contrast is excluded for the reason set out in docs/contrast.md — the
        // failing pairs are token-level and enumerated there, and pinned.
        .disableRules(["color-contrast"])
        .analyze();

      const summary = results.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.length,
        first: v.nodes[0]?.html?.slice(0, 120),
      }));
      expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
    });
  }
});
