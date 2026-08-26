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
