import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Board 12d — the ops CRM, from an ops lead's session.
 *
 * Serial, one file: the list is built once, and the call logged below changes
 * one row's state for the rest of the file (memory: Playwright cross-file
 * races). The row it works on — Al Manara Equipment Trading, capped on Free —
 * is the seed's own at-cap fixture and nothing else in the suite logs a call.
 *
 * `color-contrast` is disabled, as on every console spec; see
 * admin-commercials.spec.ts for why.
 */

test.describe.configure({ mode: "serial" });

async function built(page: import("@playwright/test").Page) {
  await page.goto("/admin/crm");
  const never = page.getByText("The list has not been built yet");
  if (await never.isVisible()) {
    await page.getByRole("button", { name: "Refresh signals" }).first().click();
    await expect(page.getByText(/Built from \d+ signals? just now/)).toBeVisible({ timeout: 60_000 });
    await page.reload();
  }
}

test.describe("board 12d — the call list", () => {
  test("builds itself from demand signals, and offers nowhere to add somebody", async ({ page }) => {
    await built(page);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Recruitment & accounts");
    await expect(page.getByText(/^Assigned to me · \d+ open$/)).toBeVisible();
    await expect(page.getByText(/Nobody types a prospect list by hand/)).toBeVisible();
    await expect(page.getByText(/^\d+ due of \d+$/)).toBeVisible();
    // B1: the absence is the feature.
    await expect(page.getByRole("button", { name: /add|new prospect|import/i })).toHaveCount(0);
    const table = page.getByRole("table", { name: /each with the demand signal behind it/ });
    for (const head of ["Business", "Why them", "Listing", "Action"]) {
      await expect(table.getByRole("columnheader", { name: head })).toBeVisible();
    }
    // 4f's churn risk is the same account here (B6).
    await expect(table.getByRole("row", { name: /Technopump Trading LLC/ })).toContainText("reply rate");
  });

  test("states a held page's supply gate so every figure derives, and names what recruiting cannot do", async ({ page }) => {
    await built(page);
    const banner = page.getByText("Held area page");
    if ((await banner.count()) === 0) test.skip(true, "no held page in this seed");
    await expect(page.getByText(/searches a month, \d+ listings?, \d+ verified/)).toBeVisible();
    await expect(page.getByText(/takes it to \d+ (verified )?of \d+.* and clears the supply gate\./)).toBeVisible();
    await expect(page.getByText(/Recruiting clears the supply gate, not the page|Supply is the only condition/)).toBeVisible();
  });

  test("reveals a number on the call action, and logs what happened", async ({ page }) => {
    await built(page);
    const row = page.getByRole("row", { name: /Al Manara Equipment Trading/ });
    await expect(row).toBeVisible();
    // Masked in the list (B9).
    await expect(row).toContainText("•");
    await row.getByRole("button", { name: /Al Manara Equipment Trading/ }).click();
    await expect(row.getByRole("link", { name: /^0\d/ })).toHaveAttribute("href", /^tel:\+971/);

    await expect(page.getByText("Logging a call to Al Manara Equipment Trading")).toBeVisible();
    await page.getByText("Call back later", { exact: true }).click();
    const inThree = new Date(Date.now() + 3 * 86_400_000 + 4 * 3_600_000).toISOString().slice(0, 10);
    await page.getByLabel("Call back on").fill(inThree);
    await page.getByPlaceholder("Note — what they said, in their words").fill("Asked us to ring after the stock count.");
    await page.getByRole("button", { name: "Log call" }).click();
    await expect(page.getByText("Logged for Al Manara Equipment Trading.")).toBeVisible();

    await expect(page.getByRole("row", { name: /Al Manara Equipment Trading/ })).toContainText("asked to call back");
  });

  test("keeps the upgrade and renewal calls on their own tabs, reconciled with 4f", async ({ page }) => {
    await page.goto("/admin/crm?tab=renewal");
    await expect(page.getByRole("link", { name: /Renewal risk/ })).toHaveAttribute("aria-current", "page");
    await expect(page.getByText(/board 4f counts at risk/)).toBeVisible();
    await page.goto("/admin/crm?tab=upgrade");
    await expect(page.getByText(/hit a cap in the last 30 days/)).toBeVisible();
  });

  test("is axe clean on every tab", async ({ page }) => {
    for (const path of ["/admin/crm", "/admin/crm?tab=upgrade", "/admin/crm?tab=renewal"]) {
      await page.goto(path);
      const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
      expect(results.violations, path).toEqual([]);
    }
  });
});
