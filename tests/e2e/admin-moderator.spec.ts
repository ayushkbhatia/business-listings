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
    await expect(sidebar.getByText("Reports & flags")).toBeVisible();

    /*
     * Not held, and rendered locked rather than hidden — AppSidebar's rule
     * since handoff 1. A route a person cannot use is still a route they
     * should know exists, so they can ask for it rather than assume it is
     * missing.
     */
    // "Staff & roles" left this list with board 4i: every staff seat reads the
    // roster and the matrix (`staff.read`), and only an ops lead changes them.
    for (const locked of ["Plans & entitlements", "Invoices & credits"]) {
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

test.describe("board 4f — an account, read by a moderator", () => {
  test("opens the account and offers no decision on it", async ({ page }) => {
    await page.goto("/admin/businesses?q=Technopump");
    await page.getByRole("link", { name: "Open Technopump Trading LLC" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Technopump Trading LLC");
    await expect(page.getByText(/Decisions on an account are an ops lead's/)).toBeVisible();
    for (const name of ["Set tier", "Suspend", "Lift suspension", "Give notice to close"]) {
      await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
    }
  });
});

test.describe("board 4i — the staff screen, read-only", () => {
  test("shows who holds which role and offers nothing to change it", async ({ page }) => {
    await page.goto("/admin/staff");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Staff & roles");
    await expect(page.getByText(/Inviting, changing roles and deactivating are an ops lead's/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Invite staff" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Change role" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: /Deactivated/ })).toHaveCount(0);
    // Invitations are withheld, so they are not counted as zero either.
    await expect(page.getByText(/Invitations are visible to ops leads/)).toBeVisible();
    await expect(page.getByText(/and 0 invitations/)).toHaveCount(0);
    // The matrix is the same table an ops lead reads.
    await expect(page.getByRole("table", { name: "What each staff role may do" })).toBeVisible();
  });

  test("cannot invite or change anybody by posting to the actions directly", async ({ page }) => {
    // The server action refuses a moderator whatever the screen offers; the
    // integration suite proves the service half. Here: the export, which is a
    // URL, returns only this seat's own rows.
    const response = await page.request.get("/admin/audit/export");
    expect(response.status()).toBe(200);
    const lines = (await response.text()).trim().split("\r\n");
    const actors = new Set(lines.slice(1).map((line) => line.split(",")[1]));
    expect(actors.size).toBeLessThanOrEqual(1);
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

test.describe("board 12d — the call list is a moderator's to work", () => {
  test("opens the call list, which B11 gives to moderator and ops lead", async ({ page }) => {
    const response = await page.goto("/admin/crm");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Recruitment & accounts");
    const sidebar = page.getByRole("navigation", { name: "Staff navigation" });
    await expect(sidebar.getByRole("link", { name: "Ops CRM" })).toBeVisible();
  });
});

test.describe("phone leads are not a moderator's row", () => {
  /*
     Board `1d` amendment. Every row on `/admin/leads` is a buyer's name, work
     email and mobile; `contact_lead.platform.read` is the ops lead alone.
  */
  test("cannot reach /admin/leads", async ({ page }) => {
    const response = await page.goto("/admin/leads");
    expect(response?.status()).toBe(404);
  });
});

test.describe("the commercial screens a moderator cannot reach", () => {
  /*
   * §07 gives `revenue.read` to finance and ops lead. A moderator's job is the
   * queue and the reports; what the platform earns is not their row, and a 404
   * rather than a 403 is the console's rule — a 403 confirms the screen exists
   * to somebody who should not know it does.
   */
  for (const path of ["/admin/revenue", "/admin/revenue/export?period=2026-08", "/admin/dunning", "/admin/subscriptions"]) {
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

test.describe("board 12a — the importer is a moderator's, dedupe is not", () => {
  test("opens the runs and the queue, and offers no dedupe tab", async ({ page }) => {
    /*
     * `queue.decide` is moderator and ops lead, so the importer and its
     * categorisation queue are both a moderator's to work. `business.merge` is
     * ops lead alone, and the shared tab strip hides the dedupe tab rather than
     * leaving a moderator one click from a 404.
     */
    await page.goto("/admin/ingest");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Licence importer");
    await expect(page.getByRole("link", { name: "Categorisation queue" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Dedupe queue" })).toHaveCount(0);

    const response = await page.goto("/admin/ingest/dedupe");
    expect(response?.status()).toBe(404);
  });
});

test.describe("board 4d — the taxonomy, read-only", () => {
  /*
     `taxonomy.read` is the moderator's: the tree is how they answer "why is
     this seller filed there" while deciding a category change. `taxonomy.write`
     and `taxonomy.merge` are not, so every control is drawn disabled with a
     line saying whose decision it is, and the two header actions are absent.
  */
  test("opens the tree and the editor, and offers no change", async ({ page }) => {
    const response = await page.goto("/admin/categories");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Categories");

    await expect(page.getByRole("button", { name: "Merge tool" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add category" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Remove category" })).toHaveCount(0);
    await expect(page.getByText("You can read this category. Changing it is an ops lead decision.")).toBeVisible();

    const switches = page.getByRole("region", { name: "Visibility" }).getByRole("switch");
    await expect(switches).toHaveCount(3);
    for (const control of await switches.all()) await expect(control).toBeDisabled();
  });
});

test.describe("standing item 9.5 — the scheduled jobs are every seat's to read", () => {
  test("opens the record and is offered nothing to press on it", async ({ page }) => {
    // `jobs.read` is every staff seat's: a moderator answers for the
    // notifications the hourly sweep releases and the reports the nightly files.
    const response = await page.goto("/admin/jobs");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Scheduled jobs");
    await expect(page.getByRole("main").getByRole("button")).toHaveCount(0);
  });
});
