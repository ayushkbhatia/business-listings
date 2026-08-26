import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Board 6f — the SEO page matrix.
 *
 * The gate this screen adds is the intro word count, which sat in
 * `thresholdsFor` from handoff 0 and passed vacuously the whole time because
 * there was nowhere for a category's copy to live.
 */

test.describe("board 6f — the page matrix", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/content/matrix");
  });

  test("says how many pages publish and how many wait only on a paragraph", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Page matrix");
    const header = page.getByRole("banner").or(page.locator("header")).first();
    await expect(header).toContainText(/\d+ of \d+ pages publish/);
    await expect(header).toContainText(/waiting only on copy/);
  });

  test("lists every landing page with the address a visitor would type", async ({ page }) => {
    const table = page.getByRole("table", { name: /Every landing page/ });
    await expect(table).toBeVisible();
    await expect(table.getByText("/c/valves-and-fittings", { exact: true })).toBeVisible();
  });

  test("names which gate is holding a page back", async ({ page }) => {
    const table = page.getByRole("table", { name: /Every landing page/ });
    await expect(table.getByText("needs copy").first()).toBeVisible();
  });

  test("counts words against the floor as staff type", async ({ page }) => {
    /*
     * Criterion-adjacent: the floor is 250 and the count is live, because a
     * count that only appears after saving is a count nobody uses.
     */
    await page.getByRole("button", { name: /Write the intro for/ }).first().click();
    // By role: the panel's own name also contains "Intro".
    const field = page.getByRole("textbox", { name: "Intro" });
    await expect(field).toBeVisible();

    await field.fill("Three words only");
    await expect(page.getByText("3 words")).toBeVisible();
  });

  test("will not save a paragraph without a reason", async ({ page }) => {
    await page.getByRole("button", { name: /Write the intro for/ }).first().click();
    const save = page.getByRole("button", { name: "Save the intro" });
    await expect(save).toBeDisabled();
    await page.getByLabel("Why").fill("Writing the intro for this trade.");
    await expect(save).toBeEnabled();
  });

  test("says the floor is a floor, not a target", async ({ page }) => {
    await page.getByRole("button", { name: /Write the intro for/ }).first().click();
    await expect(page.getByText(/repeats the category name eight times/)).toBeVisible();
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("the copy reaches the public page", () => {
  test("a written category shows its intro, an unwritten one shows none", async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();

    await page.goto("/c/valves-and-fittings");
    await expect(page.getByText(/bought on specification rather than on brand/)).toBeVisible();

    // A trade nobody has written yet renders the heading and the results, and
    // no empty paragraph where the copy would be.
    await page.goto("/c/safety-and-ppe");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(/bought on specification/)).toHaveCount(0);

    await context.close();
  });
});
