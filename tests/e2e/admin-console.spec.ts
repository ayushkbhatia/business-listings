import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Board 4a, from an ops lead's session.
 *
 * The console's one job each morning is answering which of the six jobs is
 * behind. So the assertions are about that: six panels, age before volume, and
 * every number either a link into the queue that fixes it or visibly marked as
 * a screen that does not exist yet.
 */

test.describe("board 4a — the console overview", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin");
  });

  test("opens on the six jobs", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Platform overview");

    for (const job of [
      "Get listings in",
      "Keep the data comparable",
      "Build what sellers fill",
      "Grow and keep accounts",
      "Take the money",
      "Protect the trust",
    ]) {
      await expect(page.getByRole("heading", { level: 2, name: job })).toBeVisible();
    }
  });

  test("says how much is past its service level, in the page meta", async ({ page }) => {
    const header = page.getByRole("banner").or(page.locator("header")).first();
    await expect(header).toContainText(/past their service level|Nothing is past its service level/);
  });

  test("names the service levels rather than leaving them implicit", async ({ page }) => {
    // A queue with no stated deadline is a queue nobody can be behind on, so
    // the numbers are on the screen that uses them.
    await expect(page.getByText(/Service level, in days/)).toBeVisible();
  });

  test("links a number into the queue that fixes it once that queue exists", async ({ page }) => {
    // /admin is built, so its own nav row is not `later` and the sidebar links
    // it. Every other row is named and not linked.
    const sidebar = page.getByRole("navigation", { name: "Staff navigation" });
    await expect(sidebar.getByRole("link", { name: "Platform overview" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Approval queue" })).toHaveCount(0);
    await expect(sidebar.getByText("Approval queue")).toBeVisible();
  });

  test("marks an unbuilt screen rather than linking to a 404", async ({ page }) => {
    const links = await page.getByRole("main").getByRole("link").all();
    for (const link of links) {
      const href = await link.getAttribute("href");
      if (!href?.startsWith("/admin")) continue;
      // The only admin link this page may carry today is its own.
      expect(href).toBe("/admin");
    }
  });

  test("says 'not measurable yet' where the table does not exist, never zero", async ({ page }) => {
    // Licence records staged, storefront templates and the call list all have
    // no table until later steps. Zero would mean the work is done.
    const row = page.getByRole("listitem").filter({ hasText: "Licence records staged" });
    await expect(row).toContainText("Not measurable yet");
    await expect(row).not.toContainText("0");
  });

  test("carries no fabricated badge counts in the sidebar", async ({ page }) => {
    /*
     * ADMIN_NAV shipped with `badge: 34` on the queue, `3` on reports and `5`
     * on dunning as placeholders. The seed's real pending count is 3, so a 34
     * on screen is the tell.
     */
    const sidebar = page.getByRole("navigation", { name: "Staff navigation" });
    await expect(sidebar).not.toContainText("34");
  });

  test("is compact density", async ({ page }) => {
    const density = await page
      .locator("[data-density]")
      .first()
      .getAttribute("data-density");
    expect(density).toBe("compact");
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page })
      .disableRules(["color-contrast"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("the console is staff-only", () => {
  test("a signed-out visitor gets a 404, not a sign-in wall", async ({ browser }) => {
    // A guessed URL should not confirm that the URL exists.
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    const response = await page.goto("/admin");
    expect(response?.status()).toBe(404);
    await context.close();
  });
});
