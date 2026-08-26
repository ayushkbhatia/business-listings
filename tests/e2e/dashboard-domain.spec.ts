import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Board 5e, from the seller's side.
 *
 * Runs on the Pro seat. The Free seat proves the other half — the feature is
 * named rather than hidden, which is the rule the rest of the dashboard follows.
 */

test.describe("board 5e — your own web address", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/domain");
  });

  test("says both addresses stay live, rather than implying a swap", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Your own web address");
    await expect(page.getByText(/keeps working either way/)).toBeVisible();
  });

  test("asks for a subdomain and explains why a bare domain will not do", async ({ page }) => {
    const field = page.getByLabel("Web address");
    await expect(field).toBeVisible();
    await expect(page.getByText(/not the bare domain/)).toBeVisible();
  });

  test("refuses a bare domain with a reason a seller can act on", async ({ page }) => {
    /*
     * A CNAME cannot coexist with the SOA and NS records at a zone apex, and
     * most registrars will not let you add one. "Invalid domain" would send
     * somebody to check their spelling.
     */
    await page.getByLabel("Web address").fill("alwaha.ae");
    await page.getByRole("button", { name: "Add it" }).click();
    await expect(page.getByText(/Use a subdomain like/)).toBeVisible();
  });

  test("refuses one of our own addresses", async ({ page }) => {
    await page.getByLabel("Web address").fill("stores.businesslistings.me");
    await page.getByRole("button", { name: "Add it" }).click();
    await expect(page.getByText(/That is one of ours/)).toBeVisible();
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});
