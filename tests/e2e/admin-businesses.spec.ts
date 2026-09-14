import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Board 4f — `/admin/businesses` and one account's page, from an ops lead.
 *
 * Reads the three health fixtures `prisma/seed-account-health.mts` writes, and
 * mutates only two of them: Sharjah Steel's tier and Dana Printing's suspension.
 * Nothing else asserts on either, and both tests put things back or tolerate a
 * retry that finds its work half done.
 */

async function openAccount(page: Page, name: string) {
  await page.goto(`/admin/businesses?q=${encodeURIComponent(name)}`);
  await page.getByRole("link", { name: `Open ${name}` }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
}

test.describe("board 4f — the list", () => {
  test("states its counts as queries: total, claimed and paying", async ({ page }) => {
    await page.goto("/admin/businesses");
    await expect(page.getByText(/^[\d,]+ total · [\d,]+ claimed · [\d,]+ paying$/)).toBeVisible();
  });

  test("gives the chip, the panel and the filtered list one number (B4)", async ({ page }) => {
    await page.goto("/admin/businesses");
    const chip = await page.getByRole("link", { name: /^Health: at risk \d+$/ }).textContent();
    const count = Number(chip?.match(/(\d+)$/)?.[1]);
    expect(count).toBeGreaterThan(0);
    await expect(
      page.getByRole("heading", { name: new RegExp(`^${count} paying accounts? at risk$`, "i") }),
    ).toBeVisible();

    await page.getByRole("link", { name: /^Health: at risk/ }).click();
    await expect(page).toHaveURL(/health=churn_risk/);
    await expect(page.getByText(new RegExp(`^Showing 1–${count} of ${count}$`))).toBeVisible();
    await expect(page.getByRole("row", { name: /Technopump Trading LLC/ })).toContainText("Churn risk");
  });

  test("reads the render's three warning states from measured data", async ({ page }) => {
    await page.goto("/admin/businesses?q=Technopump");
    await expect(page.getByRole("row", { name: /Technopump Trading LLC/ })).toContainText("33% ·");

    await page.goto("/admin/businesses?q=Dana%20Printing");
    await expect(page.getByRole("row", { name: /Dana Printing & Signage/ })).toContainText(/Slow replies|Suspended/);

    await page.goto("/admin/businesses?q=Sharjah%20Steel");
    const steel = page.getByRole("row", { name: /Sharjah Steel Fabricators/ });
    await expect(steel).toContainText("Upgrade candidate");
    // B6: the candidacy names the dated event behind it.
    await expect(steel).toContainText(/Hit product cap · \d/);
  });

  test("shows no plan and no tier for an unclaimed listing (B2)", async ({ page }) => {
    await page.goto("/admin/businesses?health=unclaimed");
    const row = page.getByRole("row").filter({ hasText: "Unclaimed" }).nth(1);
    await expect(row.getByRole("cell").nth(1)).toHaveText("—");
    await expect(row.getByRole("cell").nth(2)).toHaveText("—");
    await expect(row).toContainText("n/a");
  });

  test("searches by licence number the way a caller reads it (B7)", async ({ page }) => {
    await page.goto("/admin/businesses?q=ded%20330218");
    await expect(page.getByRole("row", { name: /Technopump Trading LLC/ })).toBeVisible();
    await expect(page.getByText(/^Showing 1–1 of 1$/)).toBeVisible();
  });

  test("exports the active filter and records it in the file (B9)", async ({ page }) => {
    await page.goto("/admin/businesses?health=churn_risk");
    await expect(page.getByRole("link", { name: "Export these" })).toHaveAttribute(
      "href",
      "/admin/businesses/export?health=churn_risk",
    );
    const response = await page.request.get("/admin/businesses/export?health=churn_risk");
    expect(response.status()).toBe(200);
    const lines = (await response.text()).replace(/^﻿/, "").split("\r\n");
    expect(lines[0]).toBe("# filter,health=churn_risk");
    expect(lines[3]).toContain("business_id,display_name,licence_number");
    expect(lines.slice(4).filter(Boolean).every((line) => line.includes(",churn_risk,"))).toBe(true);
  });

  test("saves a segment that re-runs its query (B8)", async ({ page }) => {
    const name = `Upgrade calls ${Date.now()}`;
    await page.goto("/admin/businesses?health=upgrade_candidate");
    await page.locator("summary", { hasText: "Saved segments" }).click();
    await page.getByLabel("Save this view as").fill(name);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Segment saved.")).toBeVisible();

    await page.goto("/admin/businesses");
    await page.locator("summary", { hasText: "Saved segments" }).click();
    const link = page.getByRole("link", { name: new RegExp(name) });
    await expect(link).toHaveAttribute("href", "/admin/businesses?health=upgrade_candidate");
    await expect(link).toContainText(/\d+ business(es)? now/);
    await page.getByRole("button", { name: `Delete the segment ${name}` }).click();
    await expect(page.getByText("Segment deleted.")).toBeVisible();
  });

  test("is read-only on the row, and opens the account (B10)", async ({ page }) => {
    await page.goto("/admin/businesses?q=Technopump");
    const row = page.getByRole("row", { name: /Technopump Trading LLC/ });
    await expect(row.getByRole("button")).toHaveCount(0);
    await row.getByRole("link", { name: "Open Technopump Trading LLC" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Technopump Trading LLC");
    await expect(page.getByText(/4 answered of 12, last 90 days/)).toBeVisible();
  });

  test("has no axe violations at the acceptance viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/admin/businesses");
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 4f — one account, and the decisions on it", () => {
  test("sets a verification tier, and the audit log says who and why", async ({ page }) => {
    const reason = `Trade licence and TRN both checked. ${Date.now()}`;
    await openAccount(page, "Sharjah Steel Fabricators");

    // Move it somewhere it is not already: `setVerificationTier` refuses an
    // unchanged tier, and a retry would otherwise fail for the wrong reason.
    const current = (await page.getByRole("radio", { name: "Tier 2" }).isChecked()) ? 2 : 1;
    const target = current === 2 ? 1 : 2;

    await page.getByRole("radio", { name: `Tier ${target}` }).check();
    await page.getByRole("textbox", { name: "Reason" }).fill(reason);
    await page.getByRole("button", { name: "Set tier", exact: true }).click();
    await expect(page.getByText(new RegExp(`Tier set to ${target}`))).toBeVisible();

    await page.goto("/admin/audit");
    await expect(page.getByText(reason)).toBeVisible();
  });

  test("will not act without a reason", async ({ page }) => {
    await openAccount(page, "Sharjah Steel Fabricators");
    // Disabled until the reason is written, and the fence would refuse it anyway.
    await expect(page.getByRole("button", { name: "Set tier", exact: true })).toBeDisabled();
    await page.getByRole("textbox", { name: "Reason" }).fill("ok");
    await expect(page.getByRole("button", { name: "Set tier", exact: true })).toBeDisabled();
    await page.getByRole("textbox", { name: "Reason" }).fill("Checked the licence.");
    await expect(page.getByRole("button", { name: "Set tier", exact: true })).toBeEnabled();
  });

  test("suspends an account and lifts it again, each with its own reason", async ({ page }) => {
    const stamp = Date.now();
    await openAccount(page, "Dana Printing & Signage");

    // A retry after a suspension that succeeded starts from the lift.
    if (await page.getByRole("button", { name: "Lift suspension" }).isVisible()) {
      await page.getByRole("textbox", { name: "Reason" }).fill(`Retry cleanup. ${stamp}`);
      await page.getByRole("button", { name: "Lift suspension" }).click();
      await expect(page.getByText(/back/)).toBeVisible();
      await page.reload();
    }

    await page.getByRole("textbox", { name: "Reason" }).fill(`Licence lapsed. ${stamp}`);
    await page.getByRole("button", { name: "Suspend", exact: true }).click();
    await expect(page.getByText(/off the directory/)).toBeVisible();

    await page.reload();
    // The reason is on the audit row, not inline (states table, "Suspended").
    await expect(page.getByRole("link", { name: "Read the suspension in the audit log" })).toBeVisible();
    await page.getByRole("textbox", { name: "Reason" }).fill(`Licence renewed. ${stamp}`);
    await page.getByRole("button", { name: "Lift suspension" }).click();
    await expect(page.getByText(/back/)).toBeVisible();
  });

  test("has no axe violations at the acceptance viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openAccount(page, "Technopump Trading LLC");
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});
