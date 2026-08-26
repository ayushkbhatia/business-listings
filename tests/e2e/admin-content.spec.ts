import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Board 6f — the SEO page matrix.
 *
 * The gate this screen adds is the intro word count, which sat in
 * `thresholdsFor` from handoff 0 and passed vacuously the whole time because
 * there was nowhere for a category's copy to live.
 */

test.describe("board 6f — the page matrix", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/content/matrix");
  });

  test("says how many pages publish and how many wait only on a paragraph", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Page matrix");
    const header = page.getByRole("banner").or(page.locator("header")).first();
    await expect(header).toContainText(/\d+ of \d+ pages publish/);
    await expect(header).toContainText(/waiting only on copy/);
  });

  test("lists every landing page with the address a visitor would type", async ({ page }) => {
    const table = page.getByRole("table", { name: /Every landing page/ });
    await expect(table).toBeVisible();
    await expect(table.getByText("/c/valves-and-fittings", { exact: true })).toBeVisible();
  });

  test("names which gate is holding a page back", async ({ page }) => {
    const table = page.getByRole("table", { name: /Every landing page/ });
    await expect(table.getByText("needs copy").first()).toBeVisible();
  });

  test("counts words against the floor as staff type", async ({ page }) => {
    /*
     * Criterion-adjacent: the floor is 250 and the count is live, because a
     * count that only appears after saving is a count nobody uses.
     */
    await page.getByRole("button", { name: /Write the intro for/ }).first().click();
    // By role: the panel's own name also contains "Intro".
    const field = page.getByRole("textbox", { name: "Intro" });
    await expect(field).toBeVisible();

    await field.fill("Three words only");
    await expect(page.getByText("3 words")).toBeVisible();
  });

  test("will not save a paragraph without a reason", async ({ page }) => {
    await page.getByRole("button", { name: /Write the intro for/ }).first().click();
    const save = page.getByRole("button", { name: "Save the intro" });
    await expect(save).toBeDisabled();
    await page.getByLabel("Why").fill("Writing the intro for this trade.");
    await expect(save).toBeEnabled();
  });

  test("says the floor is a floor, not a target", async ({ page }) => {
    await page.getByRole("button", { name: /Write the intro for/ }).first().click();
    await expect(page.getByText(/repeats the category name eight times/)).toBeVisible();
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 12g — notification templates", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/notifications");
  });

  test("says how many events nothing sends yet", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Notification templates");
    const header = page.getByRole("banner").or(page.locator("header")).first();
    await expect(header).toContainText(/events nothing sends yet/);
  });

  test("marks the dormant events in the table", async ({ page }) => {
    /*
     * Seven of the eleven are declared, seeded with templates, and emitted by
     * nothing. That is not a bug, but staff should know before spending an
     * afternoon on the copy.
     */
    const table = page.getByRole("table", { name: /Every notification template/ });
    await expect(table.getByText("nothing sends this yet").first()).toBeVisible();
  });

  test("names what the event supplies, and refuses a placeholder it does not", async ({ page }) => {
    await page.getByRole("button", { name: /Edit enquiry_received on whatsapp/ }).first().click();
    await expect(page.getByText(/This event supplies:/)).toBeVisible();

    const body = page.getByLabel("Body");
    await body.fill("New enquiry {ref} worth {quotedValue}");
    await expect(page.getByText(/\{quotedValue\} — this event does not supply that/)).toBeVisible();

    // And the save is dead while it would fail to send.
    await page.getByLabel("Why").fill("Trying a placeholder the event does not supply.");
    await expect(page.getByRole("button", { name: "Save as a new version" })).toBeDisabled();
  });

  test("a WhatsApp draft goes to Meta and is never offered a straight publish", async ({
    page,
  }) => {
    /*
     * The rule board 12g exists to enforce: the provider rejects wording Meta
     * has not approved, with an error nobody on this side can read.
     *
     * The draft is created here rather than assumed. An earlier version of this
     * test asserted against the seeded template being live, and then failed on
     * its own second run — because the save in the test below had left a draft
     * behind. A test that depends on what a previous run did is a test that
     * passes once.
     */
    await page.getByRole("button", { name: /Edit enquiry_received on whatsapp/ }).first().click();
    await page.getByLabel("Body").fill("New enquiry {ref}: {summary}. Quote before {closesAt}.");
    await page.getByLabel("Why").fill("Shortening the WhatsApp wording for the Meta resubmission.");
    await page.getByRole("button", { name: "Save as a new version" }).click();
    await expect(page.getByText(/Saved as version \d+, as a draft/)).toBeVisible();

    /*
     * Wait for the row, not just for the message. The save revalidates the
     * table and clicking straight after lands on the row that was there
     * before — which is why this passed on a second run and failed on a first.
     */
    const table = page.getByRole("table", { name: /Every notification template/ });
    await expect(table.getByText("Draft").first()).toBeVisible();

    // The newest version of that pair is the draft just written.
    await page.getByRole("button", { name: /Edit enquiry_received on whatsapp/ }).first().click();
    await expect(page.getByRole("button", { name: "Send to Meta" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Put it live" })).toHaveCount(0);
  });

  test("says why an edit is a new version", async ({ page }) => {
    await expect(page.getByText(/what a seller was sent last week/)).toBeVisible();
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("the copy reaches the public page", () => {
  test("a written category shows its intro, an unwritten one shows none", async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();

    await page.goto("/c/valves-and-fittings");
    await expect(page.getByText(/bought on specification rather than on brand/)).toBeVisible();

    // A trade nobody has written yet renders the heading and the results, and
    // no empty paragraph where the copy would be.
    await page.goto("/c/safety-and-ppe");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(/bought on specification/)).toHaveCount(0);

    await context.close();
  });
});
