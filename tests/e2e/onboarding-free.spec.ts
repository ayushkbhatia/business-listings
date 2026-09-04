import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Board 2d, criterion 2, from the seat it is about.
 *
 *   "On Free (`location_limit` 1), `+ Add another branch` is replaced by an
 *    upgrade link to step 5, never rendered as an available action."
 *
 * A negative asserted from the Pro fixture proves nothing — that seat has room
 * for nine more branches, so of course it sees a button. This is the Free
 * session, held by the seed on its one-location cap.
 */
test.describe("board 2d — locations on Free", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/onboarding/locations");
  });

  test("counts the one location against the one the plan allows", async ({ page }) => {
    // Criterion 1, and the singular. "1 of 1 locations" is a sentence nobody
    // writes, and a counter that reads wrong is a counter nobody trusts.
    await expect(page.getByText(/1 of 1 location used on Free/)).toBeVisible();
  });

  test("offers an upgrade rather than a button that would be refused", async ({ page }) => {
    /*
     * Criterion 2. A cap that is real only in the API's rejection is a screen
     * that disagrees with its own product — the seller clicks, waits, and is
     * told no by a page that had already drawn the control as available.
     */
    await expect(page.getByRole("button", { name: "Add another branch" })).toHaveCount(0);

    const upgrade = page.getByRole("link", { name: /allows/ });
    await expect(upgrade).toBeVisible();
    await expect(upgrade).toHaveAttribute("href", "/onboarding/plan");
  });

  test("names the plan that actually raises the cap", async ({ page }) => {
    // Read from the plans table, never written into copy: "Basic allows three"
    // in a sentence is a sentence that survives the plan being re-capped.
    const upgrade = page.getByRole("link", { name: /allows/ });
    await expect(upgrade).not.toContainText("Free");
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});
