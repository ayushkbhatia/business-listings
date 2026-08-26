import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Board 3a — the overview a seller on Pro sees.
 *
 * Signed in as the Pro fixture, so what is asserted here is what an unlimited
 * plan renders: no cap counters, no missed-enquiry panel, and no locked panel
 * for a feature that plan already carries.
 */
test.describe("board 3a — the Pro overview", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard");
  });

  test("opens on what needs a reply, not on a chart", async ({ page }) => {
    // The organising claim of the board. An SME owner opens this product to
    // answer someone, so the reply queue is the first panel on the page.
    /*
     * Two assertions, not one. `.first()` is the claim — a panel inserted above
     * the reply queue should fail this — but on its own it reports "the page
     * did not render" and "the queue is not first" identically, which cost a
     * confusing twenty minutes on a red main once.
     */
    await expect(page.getByRole("region", { name: "Needs a reply" })).toBeVisible();
    await expect(page.getByRole("region").first()).toContainText("Needs a reply");
    await expect(page.getByRole("link", { name: "Open the leads inbox" })).toBeVisible();
  });

  test("names the plan", async ({ page }) => {
    await expect(page.getByText("Pro", { exact: true }).first()).toBeVisible();
  });

  test("shows no cap where the plan has none", async ({ page }) => {
    await expect(page.getByText("No limit on Pro").first()).toBeVisible();
  });

  test("does not argue about a cap that cannot be reached", async ({ page }) => {
    // The missed-enquiry panel is not a locked feature on Pro — it is a
    // question that does not apply, so it is absent rather than dimmed.
    await expect(page.getByText("Enquiries you did not receive")).toHaveCount(0);
  });

  test("does not sell a feature the plan already includes", async ({ page }) => {
    // Rendering a lock here would be an advert for something already bought.
    await expect(page.getByText(/Your own web address is on/)).toHaveCount(0);
    await expect(page.getByText(/A verification site visit is on/)).toHaveCount(0);
  });

  test("reports response time as measured, with no field to claim one", async ({ page }) => {
    const standing = page.getByRole("region", { name: "How you are standing" });
    await expect(standing).toBeVisible();
    await expect(standing.getByRole("textbox")).toHaveCount(0);
    await expect(standing.getByRole("spinbutton")).toHaveCount(0);
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});
