import { expect, test } from "@playwright/test";

/**
 * Criterion 9, from a moderator's session.
 *
 *   "A moderator cannot change a verification tier, issue a credit or suspend
 *    an account — rejected server-side, covered by tests."
 *
 * `tests/integration/staff-refusals.test.ts` proves the services refuse them.
 * This file proves the console does not offer them the controls. Both halves
 * are needed and neither substitutes for the other: a hidden button is a UI
 * opinion, a server action is a URL, and a product that only hides the button
 * is one screenshot away from somebody discovering the URL.
 *
 * Asserted from a moderator's own session rather than an ops lead's, because a
 * negative checked from the wrong seat proves nothing.
 */

test.describe("what a moderator is not offered", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin");
  });

  test("reaches the console at all", async ({ page }) => {
    // The point of the rest of this file depends on them getting in.
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Platform overview");
  });

  test("sees no route they cannot act on", async ({ page }) => {
    const sidebar = page.getByRole("navigation", { name: "Staff navigation" });

    // Held: approve and reject edits, resolve reports, view-as.
    await expect(sidebar.getByText("Approval queue")).toBeVisible();
    await expect(sidebar.getByText("Supplier reports")).toBeVisible();

    /*
     * Not held, and rendered locked rather than hidden — AppSidebar's rule
     * since handoff 1. A route a person cannot use is still a route they
     * should know exists, so they can ask for it rather than assume it is
     * missing.
     */
    for (const locked of ["Plans & entitlements", "Invoices & credits", "Staff & roles"]) {
      const row = sidebar.getByText(locked, { exact: true });
      await expect(row).toBeVisible();
      await expect(sidebar.getByRole("link", { name: locked })).toHaveCount(0);
    }
  });

  test("gets no badge for a queue that is not theirs", async ({ page }) => {
    /*
     * A moderator has no `revenue.read` and no `visit.record`. A count on those
     * rows would be telling them how much work is waiting on somebody else,
     * which is noise on the one screen whose job is saying what *they* are
     * behind on.
     */
    const sidebar = page.getByRole("navigation", { name: "Staff navigation" });
    const visits = sidebar.locator("li").filter({ hasText: "Field visits" });
    await expect(visits).not.toContainText(/\d/);
  });

  test("has no control anywhere that sets a verification tier", async ({ page }) => {
    await expect(page.getByRole("button", { name: /tier/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /set.*tier/i })).toHaveCount(0);
  });

  test("has no control anywhere that issues a credit or suspends an account", async ({ page }) => {
    await expect(page.getByRole("button", { name: /credit/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /suspend/i })).toHaveCount(0);
  });
});

test.describe("the audit log a moderator sees", () => {
  test("is their own actions, and says so", async ({ page }) => {
    /*
     * §07: ops lead reads the whole log, everybody else reads their own. The
     * narrowing has existed in `auditScopeFor` since handoff 3 and was called
     * from nowhere until step 3 — so it narrowed nothing.
     */
    await page.goto("/admin/audit");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Audit log");
    await expect(page.getByText(/You see your own actions/)).toBeVisible();
    await expect(page.getByText(/every actor/)).toHaveCount(0);
  });

  test("cannot reach the visits queue", async ({ page }) => {
    // visit.record is ops lead or field verifier.
    const response = await page.goto("/admin/visits");
    expect(response?.status()).toBe(404);
  });
});
