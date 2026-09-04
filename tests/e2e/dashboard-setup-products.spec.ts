import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Board 8c — the spec sheet and the first ten rows, in a browser, signed in.
 *
 * Named `dashboard-setup-products` so the signed-in `seller` project picks it
 * up; a file called `products.spec.ts` would run signed out and fail on a
 * redirect.
 *
 * The seat is al-marwan-industrial-supplies-llc, which the seed gives a
 * catalogue — so this asserts the filled state. The empty state is covered by
 * the integration suite, where a fixture can be built without a catalogue.
 */

test.describe("board 8c — first products", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/setup/products");
  });

  test("is a task surface with no dashboard sidebar", async ({ page }) => {
    await expect(page.getByRole("navigation", { name: /Seller navigation/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Setup", exact: true })).toBeVisible();
  });

  test("puts the sheet before the rows, in that order", async ({ page }) => {
    // §Intro: two jobs on one route, and they must stay in this order because
    // the sheet decides what the rows can hold.
    const headings = await page.getByRole("heading", { level: 2 }).allInnerTexts();
    const sheetAt = headings.findIndex((text) => /which spec sheet/i.test(text));
    const rowsAt = headings.findIndex((text) => /add your first ten/i.test(text));
    expect(sheetAt).toBeGreaterThanOrEqual(0);
    expect(rowsAt).toBeGreaterThan(sheetAt);
  });

  test("states what a sheet costs before it is chosen", async ({ page }) => {
    // §2: total fields, required fields, filterable fields, adoption. Every one
    // of them a query, not a constant.
    await expect(page.getByText(/\d+ fields · \d+ required · \d+ filterable/).first()).toBeVisible();
    await expect(page.getByText(/Browse all \d+/)).toBeVisible();
  });

  test("counts live rows and qualifying rows as two different numbers", async ({ page }) => {
    /*
       §3, the thing most likely to be built wrong. "3 live · 7 more to finish
       this task" is not one figure counted twice: a row below the 60% bar is
       published, findable and enquirable, and does not help the task.
    */
    await expect(page.getByText(/\d+ live/)).toBeVisible();
    await expect(page.getByText(/\+\d+% SO FAR/)).toBeVisible();
  });

  test("heads the size column with the sheet's own field", async ({ page }) => {
    // There is no field keyed `size` on any sheet — on valves it is nominal
    // diameter, carrying the unit DN. A supplier reading "Size" has to guess.
    const table = page.getByRole("table");
    await expect(table).toBeVisible();
    await expect(table.getByRole("columnheader", { name: /PRODUCT NAME/i })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: /REQ\. SPECS/i })).toBeVisible();
  });

  test("offers the cheap import and not the one that does not exist", async ({ page }) => {
    /*
       §6: paste ships, upload does not. A button that opens nothing is worse
       than no button, and board 8a already routes the hard case to the
       concierge.
    */
    await expect(page.getByRole("button", { name: "Paste from Excel" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Upload a price list/i })).toHaveCount(0);
  });

  test("says no prices are needed, in the words the product allows", async ({ page }) => {
    await expect(page.getByText(/No prices needed/)).toBeVisible();
    // "Price on enquiry" is the only permitted phrase; "price on request" is
    // banned outright by check:vocabulary.
    const body = (await page.textContent("main")) ?? "";
    expect(body).not.toMatch(/price on request/i);
  });

  test("argues for ten rather than one", async ({ page }) => {
    await expect(page.getByText(/Why ten, not one/)).toBeVisible();
  });

  test("exits to the hub rather than promising a next step", async ({ page }) => {
    const save = page.getByRole("link", { name: /Save & back to setup|Done — back to setup/ });
    await expect(save).toHaveAttribute("href", "/dashboard/setup");
    await expect(page.getByText(/Task \d+ of \d+/)).toHaveCount(0);
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});
