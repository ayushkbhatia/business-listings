import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Board `7c` `B8`, the trust team's side: a report filed from an accepted record
 * arrives with the thread attached.
 *
 * Opens the seeded report by its fixed id (`RECORD_REPORT_ID` in
 * prisma/seed.mts) rather than through the queue, because other staff specs work
 * down that queue and the first row is not a stable address. Read-only: the
 * outcome is decided in the queue, and nothing here decides one.
 */

const REPORT = "/admin/reports/seedreport7cevidence00001";

test("shows the buyer's report, the accepted quote and the thread", async ({ page }) => {
  await page.goto(REPORT);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Report about");
  await expect(page.getByText("After an accepted quote")).toBeVisible();
  await expect(page.getByText(/Nothing has arrived and the supplier has stopped answering/)).toBeVisible();
  await expect(page.getByRole("table")).toContainText("774.00");
  await expect(page.getByRole("link", { name: "Back to supplier reports" })).toBeVisible();
  // Read-only: there is no outcome control on this screen.
  await expect(page.getByRole("button", { name: /corrected|upheld|no action/i })).toHaveCount(0);
});

test("is linked from the report's row in the queue while it is open", async ({ page }) => {
  await page.goto("/admin/reports");
  const links = page.getByRole("link", { name: "Read the thread" });
  if ((await links.count()) === 0) test.skip(true, "Another staff spec resolved the seeded report first.");
  await expect(links.first()).toHaveAttribute("href", /\/admin\/reports\//);
});

test("is a 404 for a report that has no thread to attach", async ({ page }) => {
  const response = await page.goto("/admin/reports/not-a-report");
  expect(response?.status()).toBe(404);
});

test("has no axe violations", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(REPORT);
  const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
  expect(results.violations).toEqual([]);
});
