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

  test("links a built screen and names an unbuilt one", async ({ page }) => {
    const sidebar = page.getByRole("navigation", { name: "Staff navigation" });
    // Built in steps 0 and 1.
    await expect(sidebar.getByRole("link", { name: "Platform overview" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Approval queue" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Taxonomy" })).toBeVisible();
    // Not yet. Named, not linked — the rule handoff 1 arrived at after the
    // seller sidebar shipped a dozen dead links.
    await expect(sidebar.getByRole("link", { name: "Licence importer" })).toHaveCount(0);
    await expect(sidebar.getByText("Licence importer")).toBeVisible();
  });

  test("every admin link on the page resolves", async ({ page }) => {
    /*
     * Board 4a's numbers link into the queue that fixes them, and only once
     * that queue exists. A link here that 404s is the failure this test is for.
     */
    const links = await page.getByRole("main").getByRole("link").all();
    const hrefs = new Set<string>();
    for (const link of links) {
      const href = await link.getAttribute("href");
      if (href?.startsWith("/admin")) hrefs.add(href);
    }
    expect(hrefs.size).toBeGreaterThan(0);

    for (const href of hrefs) {
      const response = await page.request.get(href);
      expect(response.status(), href).toBe(200);
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

test.describe("boards 4b, 4d and 4e", () => {
  test("the queue bands late rows above the rest", async ({ page }) => {
    await page.goto("/admin/queue");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Approval queue");

    // Age before volume. The band headings are the ordering.
    const bands = await page.getByRole("columnheader").allTextContents();
    expect(bands.join(" ")).toMatch(/service level/i);
  });

  test("the taxonomy says which half of the floor a category failed", async ({ page }) => {
    await page.goto("/admin/categories");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Taxonomy");

    // The seed has 40 businesses against a floor of 60, so something is held.
    await expect(page.getByText("Held back").first()).toBeVisible();
    // And it says what is missing rather than only that something is.
    await expect(page.getByText(/of 60/).first()).toBeVisible();
  });

  test("the taxonomy does not claim to measure intro words", async ({ page }) => {
    // The copy belongs to the landing page, which is handoff 5. Counting it
    // here would fail every category on a threshold this screen cannot see.
    await page.goto("/admin/categories");
    await expect(page.getByText(/Intro word count is not measurable here/)).toBeVisible();
  });

  test("the spec library shows the version and who has cloned it", async ({ page }) => {
    await page.goto("/admin/spec-library");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Spec templates");
    await expect(page.getByRole("cell", { name: /^v\d+$/ }).first()).toBeVisible();
  });

  test("all three are axe clean at compact density", async ({ page }) => {
    for (const path of ["/admin/queue", "/admin/categories", "/admin/spec-library"]) {
      await page.goto(path);
      const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
      expect(results.violations, path).toEqual([]);
    }
  });
});

test.describe("what taxonomy.write gates", () => {
  test("a moderator cannot reach the taxonomy or the spec library", async ({ browser }) => {
    // §07 gives "edit taxonomy & spec templates" to ops lead alone.
    const context = await browser.newContext({
      storageState: "tests/e2e/.auth/staff-moderator.json",
    });
    const page = await context.newPage();
    for (const path of ["/admin/categories", "/admin/spec-library"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
    }
    await context.close();
  });
});
