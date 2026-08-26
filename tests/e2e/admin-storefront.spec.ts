import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Boards 5c, 5g and 5h, from an ops lead's session.
 *
 * The specimens page is the acceptance surface for the whole of step 6 — the
 * equivalent of `/dev/gallery` for sections — so criterion 10 is proved here or
 * it is not proved.
 */

test.describe("board 5c — templates and the section library", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/storefront-templates");
  });

  test("says how many trades have a live template, not just how many exist", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Storefront templates");
    const header = page.getByRole("banner").or(page.locator("header")).first();
    await expect(header).toContainText(/of \d+ trades have a live template/);
  });

  test("shows the store count each template governs", async ({ page }) => {
    const table = page.getByRole("table", { name: /how many live storefronts/ });
    await expect(table).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Storefronts" })).toBeVisible();
    // The seed puts two sectors on templates, and they have different counts.
    await expect(table.getByRole("row")).not.toHaveCount(1);
  });

  test("names the trades with no template rather than omitting them", async ({ page }) => {
    await expect(page.getByText("Trades with no template")).toBeVisible();
    await expect(page.getByText(/would hide the work/)).toBeVisible();
  });

  test("lists the catalogue with the services card visibly disabled", async ({ page }) => {
    const services = page.getByRole("listitem").filter({ hasText: "Services & packages" }).first();
    await expect(services).toBeVisible();
    await expect(services).toContainText(/Not built yet/);
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("criterion 10 — the specimens page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/storefront-templates/specimens");
  });

  test("renders all fifteen, numbered", async ({ page }) => {
    const specimens = page.getByRole("listitem").filter({ has: page.locator("h2") });
    // Fourteen buildable plus the disabled services card.
    await expect(specimens).toHaveCount(15);
  });

  test("labels each with its source and what the seller fills", async ({ page }) => {
    const hero = page.getByRole("listitem").filter({ hasText: "Hero banner" }).first();
    await expect(hero).toContainText("Pulls from: Media library");
    await expect(hero).toContainText("Seller fills:");
    await expect(hero).toContainText("Headline");
  });

  test("says which sections are derived rather than filled", async ({ page }) => {
    // A seller-editable trust signal is not a trust signal.
    const trust = page.getByRole("listitem").filter({ hasText: "Trust strip" }).first();
    await expect(trust).toContainText("Nothing — everything on it is derived");
  });

  test("shows the services card and says why it is empty", async ({ page }) => {
    const services = page.getByRole("listitem").filter({ hasText: "Services & packages" }).first();
    await expect(services).toContainText(/gap is legible rather than hidden/);
  });

  test("puts no price anywhere on any specimen", async ({ page }) => {
    /*
     * Non-negotiable 1, asserted where fourteen sections render at once. The
     * offer banner is the one that could have carried one — its fourth field is
     * a reference a buyer quotes, not a discount code.
     */
    const body = await page.locator("ol").first().innerText();
    expect(body).not.toMatch(/AED\s*[\d,]/);
    expect(body).not.toMatch(/\d+%\s*off/i);
  });

  test("renders the offer reference as something to quote, not to redeem", async ({ page }) => {
    const offer = page.getByRole("listitem").filter({ hasText: "Offer banner" }).first();
    await expect(offer).toContainText("Quote RAMADAN26 in your enquiry");
  });

  test("renders the run inside a storefront theme", async ({ page }) => {
    /*
     * The specimens are wrapped in `data-theme="industrial"` because that is
     * how sections render in life, and because a reviewer needs to see the
     * trust strip's badge sitting inside a themed page.
     *
     * That the badge does not *take* the theme — non-negotiable 2, criterion 4
     * — is owned by `gallery.spec.ts`, which asserts it across all six themes
     * against a purpose-built proof block. A second, weaker assertion here
     * would be two tests of one rule with different selectors, which is how
     * they drift.
     */
    const trust = page.getByRole("listitem").filter({ hasText: "Trust strip" }).first();
    const themed = await trust.evaluate((node) =>
      node.querySelector("[data-theme]")?.getAttribute("data-theme"),
    );
    expect(themed).toBe("industrial");
  });

  test("uses a real table for the spec comparison", async ({ page }) => {
    // The design draws comparison grids with divs. The build does not.
    const spec = page.getByRole("listitem").filter({ hasText: "Spec comparison" }).first();
    await expect(spec.locator("table thead th").first()).toBeVisible();
    await expect(spec.locator('table tbody th[scope="row"]').first()).toBeVisible();
  });

  test("never shows a trade licence in certifications or downloads", async ({ page }) => {
    /*
     * `verify_listing.documents_hint` promises the seller these files are never
     * on their public listing. The fence is in the service and again in the
     * component; this asserts the outcome.
     *
     * Scoped to the document names rather than the whole page, because the
     * certifications section carries a note that says a trade licence is never
     * shown here — which is the copy doing its job, and which tripped the first
     * version of this test.
     */
    for (const name of ["Certifications", "Downloads"]) {
      const section = page.getByRole("listitem").filter({ hasText: name }).first();
      const titles = await section.locator("li").allInnerTexts();
      for (const title of titles) {
        expect(title, `${name}: ${title}`).not.toMatch(/trade licence|vat certificate/i);
      }
    }
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 5a — the builder, and step 6's checkpoint", () => {
  /**
   * The checkpoint: *change one template and see the store count before and
   * after the save.* Criterion 1 in one walk — a template edit shows the
   * affected store count before saving, and publishing requires a confirm
   * naming that count.
   */
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/storefront-templates");
    await page.getByRole("link", { name: "Industrial" }).click();
    await page.waitForURL(/\/admin\/storefront-templates\/[a-z0-9]+$/);
  });

  test("names the store count in the bar before anything is touched", async ({ page }) => {
    await expect(page.getByText(/APPLIES TO \d+ STORES/)).toBeVisible();
  });

  test("holds the header fixed and offers no way to turn it off", async ({ page }) => {
    // Criterion 6, from the screen. The database refuses it too.
    const header = page
      .getByRole("complementary", { name: "Sections" })
      .getByRole("listitem")
      .filter({ hasText: "Header & contact bar" })
      .first();
    await expect(header).toContainText("FIXED");
    await expect(header.getByRole("checkbox")).toBeDisabled();
  });

  test("will not let anything be changed without a reason", async ({ page }) => {
    /*
     * The reason is not a field somebody fills in at the end. Every mutation
     * writes an audit row and `assertReason` refuses a blank, so the controls
     * are dead until there is something to write.
     */
    const hero = page
      .getByRole("complementary", { name: "Sections" })
      .getByRole("listitem")
      .filter({ hasText: "Hero banner" })
      .first();
    await expect(hero.getByRole("checkbox")).toBeDisabled();

    await page.getByLabel("Why", { exact: true }).fill("Turning reviews off while we re-cut the card.");
    await expect(hero.getByRole("checkbox")).toBeEnabled();
  });

  test("does not offer a second hero", async ({ page }) => {
    // Criterion 7. A button that always fails is a button nobody should see.
    const add = page.getByRole("list", { name: "Add a section" });
    await expect(add.getByRole("button", { name: "Hero banner", exact: true })).toHaveCount(0);
    await expect(add.getByRole("button", { name: "Offer banner", exact: true })).toBeVisible();
  });

  test("lists what changed in words, and publishing confirms with the count", async ({ page }) => {
    /*
     * Flips whatever the section currently is rather than assuming it is on.
     *
     * An earlier version of this test unchecked Reviews, published, and put it
     * back at the end — which left the seeded template half-changed whenever it
     * failed part-way, and then the next run's first assertion was against a
     * state it did not expect. A walk that reads before it writes does not care
     * how it found things.
     */
    const reviews = page
      .getByRole("complementary", { name: "Sections" })
      .getByRole("listitem")
      .filter({ hasText: "Reviews" })
      .first();
    const box = reviews.getByRole("checkbox");

    await page.getByLabel("Why", { exact: true }).fill("Flipping the reviews section while we re-cut the card.");
    const wasOn = await box.isChecked();
    await box.setChecked(!wasOn);

    // Step one: the diff, in sentences. Scoped to the settings pane by its
    // landmark name, which is why the two asides are labelled.
    const settings = page.getByRole("complementary", { name: "Settings" });
    await expect(settings).toContainText(wasOn ? "turned off" : "turned on");

    // Step two: the confirm, which names the count.
    await page.getByRole("button", { name: "Review and publish" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(/Publish to \d+ storefronts/);
    if (wasOn) await expect(dialog).toContainText(/take something away/);

    // Publish is its own decision and carries its own reason. The edit's
    // reason was consumed by the edit.
    await expect(dialog.getByRole("button", { name: /^Publish to \d+ storefronts$/ })).toBeDisabled();
    await dialog.getByLabel("Why publish").fill("Publishing the re-cut card for this trade.");
    await dialog.getByRole("button", { name: /^Publish to \d+ storefronts$/ }).click();
    await expect(page.getByText(/storefronts now render version/)).toBeVisible();

    // And back, so the template is as it was found.
    await page.getByLabel("Why", { exact: true }).fill("Putting the reviews section back after the re-cut.");
    await box.setChecked(wasOn);
    await expect(page.getByText("Saved. Not published yet.")).toBeVisible();
    await page.getByRole("button", { name: "Review and publish" }).click();
    const second = page.getByRole("dialog");
    await second.getByLabel("Why publish").fill("Publishing the section back where it was.");
    await second.getByRole("button", { name: /^Publish to \d+ storefronts$/ }).click();
    await expect(page.getByText(/storefronts now render version/)).toBeVisible();
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("the storefront builder is staff-only", () => {
  test("a moderator cannot reach it", async ({ browser }) => {
    // §07: a storefront builder is a superadmin tool and is explicitly out of
    // scope for sellers. `storefront.template.write` is ops lead only.
    const context = await browser.newContext({
      storageState: "tests/e2e/.auth/staff-moderator.json",
    });
    const page = await context.newPage();
    for (const path of ["/admin/storefront-templates", "/admin/storefront-templates/specimens"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
    }
    await context.close();
  });
});
