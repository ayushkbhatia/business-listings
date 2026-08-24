import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Boards 3b, 3c, 3d and 3e, signed in as a seller.
 *
 * Criterion 8 is the one that matters here, and it fails in two directions.
 * A change that should queue and does not is a listing saying something nobody
 * checked. A change that should publish and queues instead is a dashboard where
 * nothing a seller does appears — which, at 41,000 listings, is the one that
 * kills the product. Both are asserted.
 */

test.describe("board 3b — the two moderation states, on one screen", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/listing");
  });

  test("says which half publishes and which half waits", async ({ page }) => {
    // A seller who has only ever seen the moderated half assumes everything
    // waits and stops editing.
    await expect(page.getByText("Publishes as soon as you save")).toBeVisible();
    await expect(page.getByText("A person checks these first")).toBeVisible();
  });

  test("puts exactly three fields on the waiting side", async ({ page }) => {
    const moderated = page.getByRole("region", { name: "A person checks these first" });
    await expect(moderated.getByText("Trade name")).toBeVisible();
    await expect(moderated.getByText("Primary category")).toBeVisible();
    await expect(moderated.getByText("Licence number")).toBeVisible();

    // And nothing else. Description, hours and photographs are not in it.
    await expect(moderated.getByText("Description")).toHaveCount(0);
    await expect(moderated.getByRole("button", { name: "Submit for review" })).toHaveCount(3);
  });

  test("offers no review step on the instant half", async ({ page }) => {
    const instant = page.getByRole("region", { name: "Publishes as soon as you save" });
    await expect(instant.getByRole("button", { name: "Save" })).toBeVisible();
    await expect(instant.getByRole("button", { name: "Submit for review" })).toHaveCount(0);
  });

  test("cannot submit a change to what it already says", async ({ page }) => {
    const moderated = page.getByRole("region", { name: "A person checks these first" });
    // Untouched, so there is nothing to ask for.
    await expect(moderated.getByRole("button", { name: "Submit for review" }).first()).toBeDisabled();
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 3c — locations", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/locations");
  });

  test("says the free zone is inside its emirate, not instead of it", async ({ page }) => {
    // The README's own sentence: a JAFZA company is in Dubai *and* in a free
    // zone. Two independent facts, so two independent controls.
    const edit = page.getByRole("button", { name: "Edit" });
    if (await edit.first().isVisible().catch(() => false)) await edit.first().click();

    await expect(page.getByText(/is a free zone inside Dubai/)).toBeVisible();
    await expect(page.getByText(/Buyers looking in Dubai find you/)).toBeVisible();
  });

  test("offers the free-zone toggle as a filter, beside the area", async ({ page }) => {
    await expect(page.getByText("Only show free zones").first()).toBeVisible();
    // Not an eighth emirate.
    await expect(page.getByRole("option", { name: "Free zones" })).toHaveCount(0);
  });

  test("tells a driver where to put the pin", async ({ page }) => {
    await expect(page.getByText(/Drag the pin to your gate, not the street/).first()).toBeVisible();
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 3d — hours", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/hours");
  });

  test("starts the week on Sunday", async ({ page }) => {
    // A Monday-first editor puts the Gulf weekend in the middle of the list.
    const rows = page.locator("fieldset >> text=Sunday").first();
    await expect(rows).toBeVisible();
    const text = (await page.locator("fieldset").first().textContent()) ?? "";
    expect(text.indexOf("Sunday")).toBeLessThan(text.indexOf("Monday"));
    expect(text.indexOf("Friday")).toBeLessThan(text.indexOf("Saturday"));
  });

  test("holds a split shift, which is the normal case", async ({ page }) => {
    // Open at eight, shut for the afternoon, open again at four.
    await expect(page.getByLabel("Sunday Opens", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Sunday Opens 2", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Sunday Closes 2", { exact: true })).toBeVisible();
  });

  test("says Ramadan applies automatically and that the dates are approximate", async ({ page }) => {
    await expect(page.getByText(/Applied automatically for the month/)).toBeVisible();
    await expect(page.getByText(/the exact dates follow the moon sighting/)).toBeVisible();
  });

  test("asks what happens on a public holiday", async ({ page }) => {
    await expect(page.getByLabel("On public holidays")).toBeVisible();
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 3e — verification", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/verification");
  });

  test("has no control that sets the seller's own tier", async ({ page }) => {
    // CLAUDE.md non-negotiable 2, and criterion 11's other half. The absence is
    // the feature, so the page says so out loud as well.
    await expect(page.getByText("Your tier is set by our team after checking")).toBeVisible();

    const ladder = page.getByRole("region", { name: "The verification ladder" });
    await expect(ladder.getByRole("textbox")).toHaveCount(0);
    await expect(ladder.getByRole("combobox")).toHaveCount(0);
    await expect(ladder.getByRole("spinbutton")).toHaveCount(0);
    await expect(ladder.getByRole("button")).toHaveCount(0);
  });

  test("says documents are never on the public listing", async ({ page }) => {
    await expect(page.getByText(/never on your public listing and never linked from it/)).toBeVisible();
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});
