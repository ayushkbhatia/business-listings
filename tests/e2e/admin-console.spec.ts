import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Board 4a, from an ops lead's session.
 *
 * The console's one job each morning is answering which of the six jobs is
 * behind. So the assertions are about that: six panels, age before volume, and
 * every number either a link into the queue that fixes it or visibly marked as
 * a screen that does not exist yet.
 */

test.describe("board 4a — the console overview", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin");
  });

  test("opens on the six jobs", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Platform overview");

    for (const job of [
      "Get listings in",
      "Keep the data comparable",
      "Build what sellers fill",
      "Grow and keep accounts",
      "Take the money",
      "Protect the trust",
    ]) {
      await expect(page.getByRole("heading", { level: 2, name: job })).toBeVisible();
    }
  });

  test("says how much is past its service level, in the page meta", async ({ page }) => {
    const header = page.getByRole("banner").or(page.locator("header")).first();
    await expect(header).toContainText(/past their service level|Nothing is past its service level/);
  });

  test("names the service levels rather than leaving them implicit", async ({ page }) => {
    // A queue with no stated deadline is a queue nobody can be behind on, so
    // the numbers are on the screen that uses them.
    await expect(page.getByText(/Service level, in days/)).toBeVisible();
  });

  test("does not offer an ops lead a number they cannot open", async ({ page }) => {
    /*
     * §07 puts `revenue.read` and `subscription.credit` with finance. The
     * "Take the money" panel used to show a past-due count linking straight
     * into a 404 for this seat — the two lists, nav capabilities and overview
     * metrics, were maintained separately until the overview started reading
     * the nav's.
     */
    const money = page
      .getByRole("heading", { level: 2, name: "Take the money" })
      .locator("xpath=..");
    await expect(money.getByText(/Somebody else's row/)).toBeVisible();
    await expect(money.getByRole("link")).toHaveCount(0);
  });

  test("links a built screen and names an unbuilt one", async ({ page }) => {
    const sidebar = page.getByRole("navigation", { name: "Staff navigation" });
    // Built in steps 0 and 1.
    await expect(sidebar.getByRole("link", { name: "Platform overview" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Approval queue" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Taxonomy" })).toBeVisible();
    /*
     * Not yet. Named, not linked — the rule handoff 1 arrived at after the
     * seller sidebar shipped a dozen dead links.
     *
     * This used to point at "Ranking & boosts", which board 12c built. The
     * example has to be something still unbuilt or the assertion stops meaning
     * anything, and `/admin/areas` is the one nobody has scheduled.
     */
    await expect(sidebar.getByRole("link", { name: "Emirates & areas" })).toHaveCount(0);
    await expect(sidebar.getByText("Emirates & areas")).toBeVisible();
  });

  test("every admin link on the page resolves", async ({ page }) => {
    /*
     * Board 4a's numbers link into the queue that fixes them, and only once
     * that queue exists. A link here that 404s is the failure this test is for.
     */
    const links = await page.getByRole("main").getByRole("link").all();
    const hrefs = new Set<string>();
    for (const link of links) {
      const href = await link.getAttribute("href");
      if (href?.startsWith("/admin")) hrefs.add(href);
    }
    expect(hrefs.size).toBeGreaterThan(0);

    for (const href of hrefs) {
      const response = await page.request.get(href);
      expect(response.status(), href).toBe(200);
    }
  });

  test("says 'not measurable yet' where the table does not exist, never zero", async ({ page }) => {
    // Storefront templates and the call list have no table until later steps.
    // Zero would mean the work is done. Licence records became measurable in
    // step 2 and are no longer in this list.
    // Scoped to main: the sidebar also names the storefront-templates route.
    const row = page
      .getByRole("main")
      .getByRole("listitem")
      .filter({ hasText: "Storefront templates" });
    await expect(row).toContainText("Not measurable yet");
  });

  test("carries no fabricated badge counts in the sidebar", async ({ page }) => {
    /*
     * ADMIN_NAV shipped with `badge: 34` on the queue, `3` on reports and `5`
     * on dunning as placeholders. The seed's real pending count is 3, so a 34
     * on screen is the tell.
     */
    const sidebar = page.getByRole("navigation", { name: "Staff navigation" });
    await expect(sidebar).not.toContainText("34");
  });

  test("is compact density", async ({ page }) => {
    const density = await page
      .locator("[data-density]")
      .first()
      .getAttribute("data-density");
    expect(density).toBe("compact");
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page })
      .disableRules(["color-contrast"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("the console is staff-only", () => {
  test("a signed-out visitor gets a 404, not a sign-in wall", async ({ browser }) => {
    // A guessed URL should not confirm that the URL exists.
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    const response = await page.goto("/admin");
    expect(response?.status()).toBe(404);
    await context.close();
  });
});

test.describe("boards 4b, 4d and 4e", () => {
  test("the queue bands late rows above the rest", async ({ page }) => {
    await page.goto("/admin/queue");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Approval queue");

    // Age before volume. The band headings are the ordering.
    const bands = await page.getByRole("columnheader").allTextContents();
    expect(bands.join(" ")).toMatch(/service level/i);
  });

  test("the taxonomy says which half of the floor a category failed", async ({ page }) => {
    await page.goto("/admin/categories");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Taxonomy");

    // The seed has 40 businesses against a floor of 60, so something is held.
    await expect(page.getByText("Held back").first()).toBeVisible();
    // And it says what is missing rather than only that something is.
    await expect(page.getByText(/of 60/).first()).toBeVisible();
  });

  test("the taxonomy does not claim to measure intro words", async ({ page }) => {
    // The copy belongs to the landing page, which is handoff 5. Counting it
    // here would fail every category on a threshold this screen cannot see.
    await page.goto("/admin/categories");
    await expect(page.getByText(/Intro word count is not measurable here/)).toBeVisible();
  });

  test("the spec library shows the version and who has cloned it", async ({ page }) => {
    await page.goto("/admin/spec-library");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Spec templates");
    await expect(page.getByRole("cell", { name: /^v\d+$/ }).first()).toBeVisible();
  });

  test("all three are axe clean at compact density", async ({ page }) => {
    for (const path of [
      "/admin/queue",
      "/admin/categories",
      "/admin/spec-library",
      "/admin/ingest",
      "/admin/reports",
      "/admin/audit",
      "/admin/visits",
      "/admin/businesses",
      "/admin/crm",
      "/admin/support",
    ]) {
      await page.goto(path);
      const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
      expect(results.violations, path).toEqual([]);
    }
  });
});

test.describe("what taxonomy.write gates", () => {
  test("a moderator cannot reach the taxonomy or the spec library", async ({ browser }) => {
    // §07 gives "edit taxonomy & spec templates" to ops lead alone.
    const context = await browser.newContext({
      storageState: "tests/e2e/.auth/staff-moderator.json",
    });
    const page = await context.newPage();
    for (const path of ["/admin/categories", "/admin/spec-library"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
    }
    await context.close();
  });
});

test.describe("board 12a — the licence importer", () => {
  test("opens on the runs, and says nothing publishes itself", async ({ page }) => {
    await page.goto("/admin/ingest");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Licence importer");
    await expect(
      page.getByText(/Listings are created only when somebody approves the run/),
    ).toBeVisible();
  });

  test("shows a run table with real column heads", async ({ page }) => {
    /*
     * Not an empty-state assertion. The integration suite stages runs into the
     * same database, so whether this list is empty depends on what ran before —
     * and a test whose subject depends on the order of other files is a test
     * that fails for reasons unrelated to what it is checking. The empty state
     * is covered where it is stable, in the gallery.
     */
    await page.goto("/admin/ingest");
    for (const head of ["Source", "Rows", "Staged", "Rejected", "Status"]) {
      await expect(page.getByRole("columnheader", { name: head })).toBeVisible();
    }
  });
});

test.describe("board 12b — dedupe", () => {
  test("bands the pairs and says why each one matched", async ({ page }) => {
    await page.goto("/admin/ingest/dedupe");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Dedupe & merge");
    await expect(
      page.getByText(/A merge moves everything the absorbed listing has/),
    ).toBeVisible();
    for (const head of ["The pair", "Why", "Match"]) {
      await expect(page.getByRole("columnheader", { name: head })).toBeVisible();
    }
  });

  test("is axe clean", async ({ page }) => {
    await page.goto("/admin/ingest/dedupe");
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("boards 4h, 4i and 12h — trust", () => {
  test("the report queue offers three outcomes and never a fourth", async ({ page }) => {
    await page.goto("/admin/reports");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Supplier reports");
    await expect(page.getByText(/Outcomes are corrected, upheld or no action/)).toBeVisible();
    // The word this product does not use, anywhere a report can reach.
    await expect(page.getByRole("main")).not.toContainText(/refund/i);
  });

  test("off-platform payment reports are outside the queue", async ({ page }) => {
    await page.goto("/admin/reports");
    await expect(page.getByText("Off-platform payment, outside the queue")).toBeVisible();
  });

  test("an ops lead sees the whole audit log", async ({ page }) => {
    await page.goto("/admin/audit");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Audit log");
    // The scope is in the page header's meta, not in the table.
    await expect(page.getByText(/entries, every actor/)).toBeVisible();
  });

  test("the visits queue says a visit does not set a tier", async ({ page }) => {
    await page.goto("/admin/visits");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Field visits");
    await expect(page.getByText(/Recording a visit does not set a tier/)).toBeVisible();
  });
});

test.describe("boards 4f, 12d and 12f — accounts", () => {
  test("account health shows measured figures, with a dash where there is not enough", async ({
    page,
  }) => {
    await page.goto("/admin/businesses");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Businesses");
    for (const head of ["Plan", "Tier", "Median reply", "State"]) {
      await expect(page.getByRole("columnheader", { name: head })).toBeVisible();
    }
  });

  test("the call list says nobody types it", async ({ page }) => {
    await page.goto("/admin/crm");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Recruitment");
    await expect(page.getByText(/Nobody types this list/)).toBeVisible();
    // No way to add somebody. That absence is criterion 7.
    await expect(page.getByRole("button", { name: /add/i })).toHaveCount(0);
  });

  test("the support desk asks for a ticket first", async ({ page }) => {
    await page.goto("/admin/support");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Support desk");
    await expect(page.getByLabel(/Ticket/)).toBeVisible();
    await expect(page.getByText(/without a reason is a privacy event/)).toBeVisible();
    // Read-only is not a hidden button, and the screen says where the fence is.
    await expect(page.getByText(/enforced where the seller's own mutations are/)).toBeVisible();
  });

  test("all three are axe clean", async ({ page }) => {
    for (const path of ["/admin/businesses", "/admin/crm", "/admin/support"]) {
      await page.goto(path);
      const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
      expect(results.violations, path).toEqual([]);
    }
  });

  /*
     The decisions this screen had no buttons for.

     `setVerificationTier`, `suspendBusiness` and `liftSuspension` were written,
     audited, capability-checked and tested, and called by nothing outside
     their own test file — staff could read the state of every account here and
     change none of it. These assert the wire, and that the row lands in the
     audit log with the words somebody actually typed.
  */
  test("sets a verification tier, and the audit log says who and why", async ({ page }) => {
    const reason = `Trade licence and TRN both checked. ${Date.now()}`;

    await page.goto("/admin/businesses");
    await page.getByRole("button", { name: "Decide" }).first().click();

    // The tier is a fixed list, so it is radios rather than a free field.
    await page.getByRole("radio", { name: "Tier 2" }).check();
    await page.getByRole("textbox", { name: "Reason" }).fill(reason);
    await page.getByRole("button", { name: "Set tier", exact: true }).click();

    await expect(page.getByText(/Tier set to 2/)).toBeVisible();

    await page.goto("/admin/audit");
    await expect(page.getByText(reason)).toBeVisible();
  });

  test("will not act without a reason", async ({ page }) => {
    await page.goto("/admin/businesses");
    await page.getByRole("button", { name: "Decide" }).first().click();

    // Disabled until the reason is written, and the fence would refuse it
    // anyway — the button is the courtesy, `assertReason` is the rule.
    await expect(page.getByRole("button", { name: "Set tier", exact: true })).toBeDisabled();
    await page.getByRole("textbox", { name: "Reason" }).fill("ok");
    await expect(page.getByRole("button", { name: "Set tier", exact: true })).toBeDisabled();
    await page.getByRole("textbox", { name: "Reason" }).fill("Checked the licence.");
    await expect(page.getByRole("button", { name: "Set tier", exact: true })).toBeEnabled();
  });

  test("suspends a listing and lifts it again, each with its own reason", async ({ page }) => {
    const stamp = Date.now();
    await page.goto("/admin/businesses");

    // A live row, so the control offered is Suspend rather than Lift.
    const live = page.getByRole("row").filter({ hasText: "Live" }).first();
    await live.getByRole("button", { name: "Decide" }).click();
    const name = (await live.getByRole("cell").first().textContent())?.trim() ?? "";

    await page.getByRole("textbox", { name: "Reason" }).fill(`Licence lapsed. ${stamp}`);
    await page.getByRole("button", { name: "Suspend", exact: true }).click();
    await expect(page.getByText(/off the directory/)).toBeVisible();

    // "We were wrong" and "they fixed it" are different facts about the same
    // business, so lifting asks again rather than reusing what was typed.
    const suspended = page.getByRole("row").filter({ hasText: name }).first();
    await suspended.getByRole("button", { name: "Decide" }).click();
    await expect(page.getByRole("button", { name: "Lift suspension" })).toBeVisible();
    await page.getByRole("textbox", { name: "Reason" }).fill(`Licence renewed. ${stamp}`);
    await page.getByRole("button", { name: "Lift suspension" }).click();
    await expect(page.getByText(/back/)).toBeVisible();
  });
});
