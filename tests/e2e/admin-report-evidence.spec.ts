import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Board `7c` `B8`, the trust team's side: a report filed from an accepted record
 * arrives with the thread attached.
 *
 * Opens the seeded report by its fixed id (`RECORD_REPORT_ID` in
 * prisma/seed.mts) rather than through the queue, because other staff specs work
 * down that queue and the first row is not a stable address.
 *
 * Board 4h gave this route a decision panel — `B5`, *"`Investigate` needs a
 * destination"* — so it is no longer read-only, and it no longer answers for
 * one report kind alone. The quote and the thread are still what a report
 * carrying an enquiry shows, which is what this file is about.
 */

const REPORT = "/admin/reports/seedreport7cevidence00001";

test("shows the buyer's report, the accepted quote and the thread", async ({ page }) => {
  await page.goto(REPORT);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Report about");
  await expect(page.getByText("After an accepted quote")).toBeVisible();
  await expect(
    page.getByText(/Nothing has arrived and the supplier has stopped answering/),
  ).toBeVisible();
  await expect(page.getByRole("table")).toContainText("774.00");
  await expect(page.getByRole("link", { name: "Back to the queue" })).toBeVisible();
});

test("decides it here, with a written reason, or not at all", async ({ page }) => {
  await page.goto(REPORT);
  const outcome = page.getByRole("button", { name: "Seller corrected it" });
  if ((await outcome.count()) === 0) {
    test.skip(true, "Another staff spec decided the seeded report first.");
  }
  // Every outcome is gated on the reason, which is the audit row's own field.
  await expect(outcome).toBeDisabled();
  await expect(page.getByRole("button", { name: "Escalate to an ops lead" })).toBeDisabled();
});

test("is a 404 for a report id that is not one", async ({ page }) => {
  const response = await page.goto("/admin/reports/not-a-report");
  expect(response?.status()).toBe(404);
});

test("has no axe violations", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(REPORT);
  const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
  expect(results.violations).toEqual([]);
});
