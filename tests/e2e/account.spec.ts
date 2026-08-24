import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Boards 3l, 3m, 7d, 11e and 11f, signed in as a seller.
 *
 * Criteria 9 and 10 are proved in tests/integration — they are claims about
 * what services refuse and what they write, and a browser is the wrong
 * instrument for either. What is asserted here is what the seller is *told*,
 * because on this screen the wording is the product: the fear about cancelling
 * is that the catalogue is deleted, and the answer has to be visible.
 */

test.describe("board 11f — plan change", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/billing/change");
  });

  test("shows three plans, with one recommended and one current", async ({ page }) => {
    await expect(page.getByRole("region", { name: "Free" })).toBeVisible();
    await expect(page.getByText("Recommended")).toBeVisible();
    await expect(page.getByText("Your plan")).toBeVisible();
  });

  test("lists a feature the plan lacks rather than hiding it", async ({ page }) => {
    // The absence is what the next tier up is selling.
    const free = page.getByRole("region", { name: "Free" });
    await expect(free.getByText("Your own web address")).toBeVisible();
  });

  test("breaks the proration into a credit and a charge before anything is charged", async ({ page }) => {
    // One net figure is a number the seller has to take on trust.
    await page.getByRole("button", { name: /Move to Basic/ }).click();

    const quote = page.getByRole("region", { name: "What changes today" });
    await expect(quote).toBeVisible();
    await expect(quote).toContainText(/unused days/);
    await expect(quote).toContainText(/AED \d/);
    await expect(quote).toContainText(/Your renewal date does not move/);
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 11f — cancel", () => {
  test("answers the three things a seller is afraid of", async ({ page }) => {
    await page.goto("/dashboard/billing/cancel");

    const kept = page.getByRole("region", { name: "What you keep" });
    await expect(kept).toContainText(/hidden, not deleted/);
    await expect(kept).toContainText(/Every review stays/);
    await expect(kept).toContainText(/verification badge stays/);
  });

  test("makes no retention offer", async ({ page }) => {
    await page.goto("/dashboard/billing/cancel");
    // Board 11f is explicit. A discount at the moment somebody leaves buys a
    // month and costs the only honest signal we get.
    const text = (await page.locator("main").textContent()) ?? "";
    expect(text).not.toMatch(/discount|special offer|wait!|are you sure/i);
  });

  test("is axe clean", async ({ page }) => {
    await page.goto("/dashboard/billing/cancel");
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 7d — team and routing", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/team");
  });

  test("says what a sales seat cannot do", async ({ page }) => {
    await expect(page.getByText(/cannot see invoices, change the plan or touch licence details/)).toBeVisible();
  });

  test("measures each person, including the owner", async ({ page }) => {
    // A dashboard that measures everybody except the person reading it is a
    // dashboard nobody trusts about anything else either.
    const table = page.getByRole("table");
    await expect(table.getByRole("columnheader", { name: "Median reply time" })).toBeVisible();
    await expect(table.getByRole("rowheader", { name: /Owner/ })).toBeVisible();
  });

  test("offers the three routing modes with what each does", async ({ page }) => {
    await expect(page.getByRole("radio", { name: /Everyone sees everything/ })).toBeVisible();
    await expect(page.getByRole("radio", { name: /Round-robin/ })).toBeVisible();
    await expect(page.getByRole("radio", { name: /By branch/ })).toBeVisible();
    await expect(page.getByText(/what protects your reply time/)).toBeVisible();
  });

  test("cannot invite somebody as an owner", async ({ page }) => {
    const roles = page.getByLabel("What they can do");
    await expect(roles.getByRole("option", { name: "Owner" })).toHaveCount(0);
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 11e — sponsored placement", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/promote");
  });

  test("states the three rules before anything can be bought", async ({ page }) => {
    const rules = page.getByRole("region", { name: "What a sponsored slot does, and does not" });
    await expect(rules).toContainText(/Always labelled/);
    await expect(rules).toContainText(/Never above a verified supplier/);
    await expect(rules).toContainText(/Nobody can buy the whole category/);
  });

  test("puts the free things first, above the buy control", async ({ page }) => {
    // An honest upsell that appears below the thing it warns about is
    // decoration.
    const main = (await page.locator("main").textContent()) ?? "";
    expect(main.indexOf("Fix the free things first")).toBeLessThan(main.indexOf("What a sponsored slot"));
  });

  test("says it is not an auction", async ({ page }) => {
    await expect(page.getByText(/Not auctioned/)).toBeVisible();
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 3l — analytics", () => {
  test("says every figure is counted, not estimated", async ({ page }) => {
    await page.goto("/dashboard/analytics");
    await expect(page.getByText(/counted, not estimated/)).toBeVisible();
  });

  test("is axe clean", async ({ page }) => {
    await page.goto("/dashboard/analytics");
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});
