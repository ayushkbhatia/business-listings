import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Board `1d` amendment — the seller's phone leads, from the Pro seat's session.
 *
 * Seeded by `prisma/seed-contact-leads.mts` on Al Marwan, the seat's listing:
 * one lead per source the table words, one buyer who came back twice more. The
 * acceptance suite's own reveals add rows beside them, so nothing here counts
 * the table.
 */

test.describe("phone leads", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/leads/phone");
  });

  test("is in the seller's navigation, beside the inbox", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1, name: "Phone leads" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Phone leads" }).first()).toBeVisible();
  });

  test("lists who asked, how to reach them, and where they came from", async ({ page }) => {
    const table = page.getByRole("table", { name: "Phone leads, newest first" });
    const rashid = table.getByRole("row", { name: /Rashid Al Mansoori/ });
    await expect(rashid).toContainText("rashid@gulf-mep.test");
    await expect(rashid.getByRole("link", { name: "+971 50 641 0001" })).toHaveAttribute("href", "tel:+971506410001");
    await expect(rashid).toContainText("Search · “butterfly valves dn100”");
    await expect(rashid.getByRole("cell").last()).toContainText("3");

    await expect(table.getByRole("row", { name: /Anita Fernandes/ })).toContainText("Category page");
    await expect(table.getByRole("row", { name: /Omar Haddad/ })).toContainText("Direct or another site");
    await expect(table.getByRole("row", { name: /Sanjay Pillai/ })).toContainText("Your storefront");
    // Which competitor a buyer read first is not this seller's to see.
    const farah = table.getByRole("row", { name: /Farah Qasim/ });
    await expect(farah).toContainText("Another supplier's storefront");
    await expect(farah).not.toContainText("/b/");
  });

  test("states the two counts it has", async ({ page }) => {
    await expect(page.getByText(/\d+ leads? · \d+ in the last 30 days/)).toBeVisible();
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .disableRules(["color-contrast"])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
