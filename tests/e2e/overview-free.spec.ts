import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Board 11a — the overview a seller on Free sees, and acceptance criterion 5.
 *
 *   "A Free-plan seller at their cap sees the missed-enquiry list with real
 *    dates and requirements, and every locked panel names what unlocks it."
 *
 * Signed in as the Free fixture, which the seed holds exactly on its
 * three-enquiry cap. The board is not a degraded Pro board — it is an argument,
 * and these tests are about whether the argument is made with real numbers.
 */
test.describe("board 11a — the Free overview", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard");
  });

  test("still opens on what needs a reply", async ({ page }) => {
    // Free is a product, not a nag screen. The upgrade argument comes second.
    /*
     * Two assertions, not one. `.first()` is the claim — a panel inserted above
     * the reply queue should fail this — but on its own it reports "the page
     * did not render" and "the queue is not first" identically, which cost a
     * confusing twenty minutes on a red main once.
     */
    await expect(page.getByRole("region", { name: "Needs a reply" })).toBeVisible();
    await expect(page.getByRole("region").first()).toContainText("Needs a reply");
  });

  test("lists the enquiries the cap cost them, with dates and requirements", async ({ page }) => {
    const panel = page.getByRole("region", { name: "Enquiries you did not receive" });
    await expect(panel).toBeVisible();

    const rows = panel.locator("tbody tr");
    await expect(rows).not.toHaveCount(0);

    const first = rows.first();
    // A requirement, not a placeholder.
    await expect(first).toContainText(/valve|gauge|strainer/i);
    // Line items, so "what did I miss" is answerable.
    await expect(first).toContainText(/\d+\s*pcs/);
    // And why.
    await expect(first).toContainText("You had used all 3 enquiries for the month");
  });

  test("says which enquiries are still open", async ({ page }) => {
    const panel = page.getByRole("region", { name: "Enquiries you did not receive" });
    await expect(panel.getByText("Still open").first()).toBeVisible();
  });

  test("never shows the buyer behind an enquiry it did not receive", async ({ page }) => {
    // Rule 1, structurally: MissedEnquiry has no buyer relation to select from.
    const panel = page.getByRole("region", { name: "Enquiries you did not receive" });
    const text = (await panel.textContent()) ?? "";
    expect(text).not.toMatch(/\+971|@[a-z]+\.[a-z]{2,}/i);
  });

  test("names the plan and the price that would have let them reply", async ({ page }) => {
    await expect(page.getByRole("link", { name: /Move to Basic, AED 349 a month/ })).toBeVisible();
  });

  test("shows the cap it is arguing about, and agrees with itself", async ({ page }) => {
    // The counter and the panel read from one query on purpose. "3 of 3" under
    // a panel claiming a three-enquiry limit was reached is the whole point;
    // "8 of 3" would be the board arguing against its own numbers.
    await expect(page.getByText("3 of 3")).toBeVisible();
  });

  test("says Free is a plan rather than a trial", async ({ page }) => {
    await expect(page.getByText("Free is a plan, not a trial. Nothing here expires.")).toBeVisible();
  });

  test("dims each locked feature and names what unlocks it", async ({ page }) => {
    // Never hidden: a seller cannot want what they cannot see.
    for (const feature of ["Your own web address"]) {
      const panel = page.getByRole("region", { name: feature });
      await expect(panel).toBeVisible();
      await expect(panel).toContainText(`${feature} is on Pro, AED 899 a month`);
      await expect(panel.getByRole("link", { name: "See plans" })).toBeVisible();
    }
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});
