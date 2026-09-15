import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Board `1d` amendment — every phone lead, from the ops lead's session.
 *
 * The moderator's refusal is in `admin-moderator.spec.ts`, from a moderator's
 * own session, because a negative checked from the wrong seat proves nothing.
 */

test.describe("phone leads, across the platform", () => {
  test("names the supplier on every row, and narrows by supplier", async ({ page }) => {
    await page.goto("/admin/leads");
    await expect(page.getByRole("heading", { level: 1, name: "Phone leads" })).toBeVisible();
    const table = page.getByRole("table", { name: "Phone leads across every storefront, newest first" });
    await expect(table.getByRole("row", { name: /Rashid Al Mansoori/ })).toContainText("Al Marwan Industrial Supplies");
    // Staff see which storefront a buyer came from; the seller does not.
    await expect(table.getByRole("row", { name: /Farah Qasim/ })).toContainText("/b/elsewhere-fixture");

    await page.getByLabel("Supplier name or slug").fill("al-marwan-industrial-supplies-llc");
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page).toHaveURL(/supplier=al-marwan-industrial-supplies-llc/);
    const suppliers = await page
      .getByRole("table")
      .locator("tbody tr td:first-child")
      .allInnerTexts();
    expect(suppliers.length).toBeGreaterThan(0);
    expect(new Set(suppliers)).toEqual(new Set(["Al Marwan Industrial Supplies"]));
  });

  test("says so when a filter matches nothing", async ({ page }) => {
    await page.goto("/admin/leads?supplier=no-such-supplier-anywhere");
    await expect(page.getByText("No phone leads for “no-such-supplier-anywhere”.")).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
  });

  test("is axe clean", async ({ page }) => {
    await page.goto("/admin/leads");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .disableRules(["color-contrast"])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
