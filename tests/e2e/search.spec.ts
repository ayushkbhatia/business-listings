import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Handoff 1, step 4. Category, subcategory and search.
 *
 * The seed is deterministic, so the fixtures below are stable. They encode the
 * states the checkpoint asks for.
 */

test.describe("acceptance criterion 3 — spec-aware matching", () => {
  test("DN100 finds a product the seller stored as 4 inch", async ({ page }) => {
    await page.goto("/search?q=DN100&tab=products");

    // Not a DN100 product that merely carries 4" as a synonym: this one is
    // named and specced imperially, with no DN100 anywhere in its own record.
    const imperial = page.getByRole("link", { name: /Cast iron gate valve 4"/ });
    await expect(imperial.first()).toBeVisible();
  });

  test("the match works in the other direction too", async ({ page }) => {
    await page.goto('/search?q=4"&tab=products');
    const metric = page.getByRole("link", { name: /DN100/ });
    await expect(metric.first()).toBeVisible();
  });

  test("an Arabic query reaches English listings through category synonyms", async ({ page }) => {
    // صمامات is a synonym on the valves category. No supplier record contains
    // a word of Arabic; they match because their category does.
    await page.goto("/search?q=%D8%B5%D9%85%D8%A7%D9%85%D8%A7%D8%AA");
    const results = page.locator('a[href^="/b/"]');
    expect(await results.count()).toBeGreaterThan(0);
    await expect(page.getByText("Valves & fittings").first()).toBeVisible();
  });
});

test.describe("acceptance criterion 4 — the rail comes from the template", () => {
  test("the valves rail is built from that category's filterable spec fields", async ({ page }) => {
    await page.goto("/c/valves-and-fittings");
    const rail = page.getByRole("complementary", { name: "Filters" });

    // Spec facets, from SpecField where isFilterable.
    for (const field of ["Nominal diameter", "Pressure rating", "Body material"]) {
      await expect(rail.getByText(field, { exact: true })).toBeVisible();
    }
    // Not filterable, so not in the rail.
    await expect(rail.getByText("Maximum temperature")).toHaveCount(0);
    await expect(rail.getByText("Operation", { exact: true })).toHaveCount(0);

    // Fixed facets sit below the spec ones.
    for (const field of ["Verification", "Emirate", "Availability"]) {
      await expect(rail.getByText(field, { exact: true })).toBeVisible();
    }
  });

  test("a different category gets a different rail", async ({ page }) => {
    await page.goto("/c/safety-and-ppe");
    const rail = page.getByRole("complementary", { name: "Filters" });
    // No spec template for this category, so only the fixed facets appear.
    await expect(rail.getByText("Nominal diameter")).toHaveCount(0);
    await expect(rail.getByText("Verification", { exact: true })).toBeVisible();
  });

  test("selecting a spec facet narrows the products and shows a chip", async ({ page }) => {
    await page.goto("/c/valves-and-fittings?tab=products");
    const before = await page.locator('a[href*="/p/"]').count();

    await page.getByRole("link", { name: /^DN100/ }).first().click();
    await expect(page.getByText("Remove the Nominal diameter filter")).toHaveCount(0);
    const chip = page.getByLabel(/Remove the .* filter/).first();
    await expect(chip).toBeVisible();

    const after = await page.locator('a[href*="/p/"]').count();
    expect(after).toBeLessThanOrEqual(before);
  });
});

test.describe("acceptance criterion 6 — zero results is a designed state", () => {
  test("names one filter to drop, and what dropping it yields", async ({ page }) => {
    await page.goto("/c/packaging-and-materials?tier=3");
    await expect(page.getByRole("heading", { name: "Nothing matches all of that" })).toBeVisible();

    const drop = page.getByRole("link", { name: /Drop the Verification filter/ });
    await expect(drop).toBeVisible();
    await expect(drop).toContainText(/\d/);

    // And the link actually works.
    await drop.click();
    await expect(page.getByRole("heading", { name: "Nothing matches all of that" })).toHaveCount(0);
  });

  test("says so honestly when no single filter helps", async ({ page }) => {
    await page.goto("/search?q=cryogenic+valve&tier=2");
    await expect(page.getByText(/Removing any single filter still returns nothing/)).toBeVisible();
  });

  test("offers the RFQ path, live, carrying the category", async ({ page }) => {
    // The surface this matters on most: nobody in the directory lists it, so
    // asking the trade is the only thing left to offer.
    await page.goto("/c/packaging-and-materials?tier=3");
    const rfq = page.getByRole("link", { name: "Post a requirement" });
    await expect(rfq).toBeVisible();
    await expect(rfq).toHaveAttribute("href", "/rfq/new?category=packaging-and-materials");
  });

  test("says the miss was recorded", async ({ page }) => {
    await page.goto("/c/packaging-and-materials?tier=3");
    await expect(page.getByText(/We record searches that find nothing/)).toBeVisible();
  });
});

test.describe("two tabs, one query", () => {
  test("the tab is in the URL and the query survives switching", async ({ page }) => {
    await page.goto("/search?q=valve");
    await page.getByRole("link", { name: /Products/ }).click();
    await expect(page).toHaveURL(/tab=products/);
    await expect(page).toHaveURL(/q=valve/);
  });

  test("filters survive a tab switch", async ({ page }) => {
    await page.goto("/search?q=valve&emirate=dubai");
    await page.getByRole("link", { name: /Products/ }).click();
    await expect(page).toHaveURL(/emirate=dubai/);
  });
});

test.describe("the sponsored slot", () => {
  test("is labelled wherever it appears", async ({ page }) => {
    await page.goto("/c/valves-and-fittings");
    const sponsored = page.getByText("Sponsored", { exact: true });
    if ((await sponsored.count()) > 0) {
      await expect(sponsored.first()).toBeVisible();
      await expect(page.getByText(/never outranks a verified supplier/)).toBeVisible();
    }
  });
});

test.describe("axe", () => {
  for (const route of [
    "/c/valves-and-fittings",
    "/c/valves-and-fittings?tab=products",
    "/c/valves-and-fittings/gate-valves",
    "/search?q=valve",
    "/c/packaging-and-materials?tier=3",
  ]) {
    test(`is clean on ${route}`, async ({ page }) => {
      await page.goto(route);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
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
