import { expect, test } from "@playwright/test";

/**
 * Board 1l criterion 10 — the pricing page read by a seller who already has a
 * plan.
 *
 * Its own file because it needs a session, and its own project in
 * `playwright.config.ts` for the same reason. The public states are
 * `tests/e2e/pricing.spec.ts`.
 *
 * The signed-in seller these run as is on a paid plan — `auth.setup.ts` puts
 * them there — so the page has one plan above theirs and one below, which is
 * exactly the shape the criterion is about.
 */

test.describe("a signed-in seller on the pricing page", () => {
  test("marks the plan they are on, and gives it nowhere to go", async ({ page }) => {
    await page.goto("/pricing");

    const current = page.locator("section[aria-label]", { hasText: "Your plan" }).first();
    await expect(current).toBeVisible();

    // A disabled button rather than a link to where they already are.
    const action = current.getByRole("button", { name: "Your plan" });
    await expect(action).toBeDisabled();
    await expect(current.locator('a[href*="/onboarding/claim"]')).toHaveCount(0);
  });

  test("points every other plan at billing rather than at onboarding", async ({ page }) => {
    await page.goto("/pricing");
    // Somebody who has already claimed must never be sent back through the
    // claim flow: that is the platform admitting it does not know who is
    // reading.
    await expect(page.locator('main a[href*="/onboarding/claim"]')).toHaveCount(0);
    await expect(page.locator('main a[href*="/dashboard/billing/change"]')).not.toHaveCount(0);
  });

  test("never makes a downgrade a primary button", async ({ page }) => {
    await page.goto("/pricing");
    const downgrade = page.getByRole("link", { name: /^Downgrade to / });
    await expect(downgrade).not.toHaveCount(0);

    for (const link of await downgrade.all()) {
      const classes = (await link.getAttribute("class")) ?? "";
      // The ghost variant: no moss fill, no border. Moss marks action, and
      // giving up something you pay for is not the action being encouraged.
      expect(classes).toContain("bg-transparent");
      expect(classes).not.toContain("bg-moss");
    }
  });

  test("does not recommend the plan they are already on", async ({ page }) => {
    await page.goto("/pricing");
    const promoted = page.locator("section[aria-label].shadow-promoted");
    const count = await promoted.count();
    // At most one, and never the current plan — recommending somebody what
    // they already have is the page not reading its own session.
    expect(count).toBeLessThanOrEqual(1);
    if (count === 1) await expect(promoted).not.toContainText("Your plan");
  });
});
