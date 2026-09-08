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

  test("has no control anywhere that sets a verification tier", async ({ page }) => {
    await expect(page.getByRole("button", { name: /tier/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /set.*tier/i })).toHaveCount(0);
  });

  test("has no control anywhere that issues a credit or suspends an account", async ({ page }) => {
    await expect(page.getByRole("button", { name: /credit/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /suspend/i })).toHaveCount(0);
  });
});

test.describe("removing a review is not a moderator's row", () => {
  /*
     §07, both tables. A moderator may reject a submission and resolve a
     supplier report about a review, and may not remove the review. Removing a
     buyer's published words is held one rung higher — `review.remove` is ops
     lead alone.

     This is the screen that closes criterion 9's last gap, so the refusal is
     asserted the moment the screen exists rather than after somebody notices.
  */
  test("cannot reach /admin/reviews", async ({ page }) => {
    const response = await page.goto("/admin/reviews");
    expect(response?.status()).toBe(404);
  });

  test("is not offered it in the sidebar", async ({ page }) => {
    await page.goto("/admin");
    const sidebar = page.getByRole("navigation", { name: "Staff navigation" });
    await expect(sidebar.getByRole("link", { name: "Reviews", exact: true })).toHaveCount(0);
  });

  test("has no control anywhere that removes a review", async ({ page }) => {
    await page.goto("/admin/reports");
    await expect(page.getByRole("button", { name: /remove/i })).toHaveCount(0);

    /*
       Including behind the review-dispute panel, which board 11c added to this
       screen. Upholding a dispute *is* a removal, and a closed panel is not a
       control that is absent — it is a control nobody has opened yet, which is
       exactly the distinction `Decide` hides. So the panel is opened and asked
       again.
    */
    const decide = page.getByRole("button", { name: "Decide" }).first();
    if ((await decide.count()) > 0) {
      await decide.click();
      await expect(page.getByRole("button", { name: /uphold/i })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Refuse" })).toBeVisible();
      await expect(page.getByText(/is an ops lead's decision/)).toBeVisible();
    }
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

});

test.describe("the commercial screens a moderator cannot reach", () => {
  /*
   * §07 gives `revenue.read` to finance and ops lead. A moderator's job is the
   * queue and the reports; what the platform earns is not their row, and a 404
   * rather than a 403 is the console's rule — a 403 confirms the screen exists
   * to somebody who should not know it does.
   */
  for (const path of ["/admin/revenue", "/admin/dunning", "/admin/tax", "/admin/subscriptions"]) {
    test(`cannot reach ${path}`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
    });
  }

  test("is not offered them in the sidebar either", async ({ page }) => {
    await page.goto("/admin");
    const sidebar = page.getByRole("navigation", { name: "Staff navigation" });
    await expect(sidebar.getByRole("link", { name: "Revenue" })).toHaveCount(0);
    await expect(sidebar.getByRole("link", { name: "Failed payments" })).toHaveCount(0);
  });
});
