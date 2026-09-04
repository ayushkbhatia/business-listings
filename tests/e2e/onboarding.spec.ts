import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Boards 2a to 2e and 8a to 8e, signed in as a seller.
 *
 * Criteria 1 to 4 are proved against services in tests/integration — they are
 * claims about rows, and a browser is the wrong instrument. What is asserted
 * here is the funnel's shape and the sentences that answer the two fears a
 * supplier actually has: that claiming resets them, and that the pricing table
 * is a paywall.
 */

test.describe("board 2a — a seller who already has a listing", () => {
  test("is sent to the dashboard, and told why", async ({ page }) => {
    /*
     * Criterion 11. A supplier cannot claim a second business from this flow,
     * and the redirect states so rather than bouncing them silently — a person
     * who lands somewhere they did not ask for and is told nothing concludes
     * the link was broken.
     *
     * The rest of board 2a is `tests/e2e/claim.spec.ts`, signed out, which is
     * how that screen is normally met.
     */
    await page.goto("/onboarding/claim");
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText(/Claiming a second business is not something this flow can do/)).toBeVisible();
  });
});

test.describe("board 2b — prove it is yours", () => {
  test("calls the number on the record, not one the claimant types", async ({ page }) => {
    // Anybody can answer their own phone. Because it is the recorded number,
    // answering it is the proof.
    await page.goto("/onboarding/verify");
    await expect(page.getByText(/the number on the public record, not one you type/)).toBeVisible();
    // And there is no field to supply one.
    const routes = page.locator("fieldset");
    await expect(routes.getByRole("textbox")).toHaveCount(0);
  });

  test("is axe clean", async ({ page }) => {
    await page.goto("/onboarding/verify");
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("criterion 3 — the plan step is not a gate", () => {
  test("says the listing is already live, and gives its address", async ({ page }) => {
    // A pricing table shown to somebody who thinks they are still blocked
    // reads as a paywall however it is worded.
    await page.goto("/onboarding/plan");
    await expect(page.getByText(/Your listing is already live at/)).toBeVisible();
    await expect(page.getByText(/Free is a real plan — you can stay on it/)).toBeVisible();
  });

  test("makes staying on Free a button, not small print", async ({ page }) => {
    await page.goto("/onboarding/plan");
    await expect(page.getByRole("button", { name: "Stay on Free" })).toBeVisible();
  });

  test("is axe clean", async ({ page }) => {
    await page.goto("/onboarding/plan");
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 8a — the setup hub", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/setup");
  });

  test("states what each task is worth and how long it takes", async ({ page }) => {
    // "Complete your profile" tells nobody anything.
    await expect(page.getByText(/WORTH 20 POINTS/i).first()).toBeVisible();
    await expect(page.getByText(/ABOUT \d+ MINUTES/i).first()).toBeVisible();
  });

  test("shows the 80% threshold the boards draw", async ({ page }) => {
    await expect(page.getByText(/80% is where a listing stops looking thin/)).toBeVisible();
  });

  test("shows progress per task, so a half-done one says so", async ({ page }) => {
    await expect(page.getByText(/\d+ OF \d+/i).first()).toBeVisible();
  });

  test("says the visit does not move the strength meter", async ({ page }) => {
    // It moves trust, not strength. Implying otherwise would be selling a
    // number the task does not touch.
    await expect(page.getByText(/DOES NOT CHANGE YOUR PROFILE STRENGTH/i)).toBeVisible();
  });

  test("links each task to where the work happens", async ({ page }) => {
    // Independent: a task is not a wizard step, it is a link to the screen
    // that already does that job.
    const links = page.getByRole("link", { name: /Start|Carry on|Done/ });
    await expect(links).not.toHaveCount(0);
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 8e — the visit", () => {
  test("asks what suits rather than offering a slot we cannot keep", async ({ page }) => {
    await page.goto("/dashboard/setup/visit");
    await expect(page.getByLabel("When suits you")).toBeVisible();
    await expect(page.getByText(/We call to arrange the actual time/)).toBeVisible();
  });

  test("has no control that sets the tier", async ({ page }) => {
    await page.goto("/dashboard/setup/visit");
    await expect(page.getByRole("combobox", { name: /tier/i })).toHaveCount(0);
  });

  test("is axe clean", async ({ page }) => {
    await page.goto("/dashboard/setup/visit");
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});
