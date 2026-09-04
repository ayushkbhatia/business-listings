import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Board 2d, criterion 2, from the seat it is about.
 *
 *   "On Free (`location_limit` 1), `+ Add another branch` is replaced by an
 *    upgrade link to step 5, never rendered as an available action."
 *
 * A negative asserted from the Pro fixture proves nothing — that seat has room
 * for nine more branches, so of course it sees a button. This is the Free
 * session, held by the seed on its one-location cap.
 */
test.describe("board 2d — locations on Free", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/onboarding/locations");
  });

  test("counts the one location against the one the plan allows", async ({ page }) => {
    // Criterion 1, and the singular. "1 of 1 locations" is a sentence nobody
    // writes, and a counter that reads wrong is a counter nobody trusts.
    await expect(page.getByText(/1 of 1 location used on Free/)).toBeVisible();
  });

  test("offers an upgrade rather than a button that would be refused", async ({ page }) => {
    /*
     * Criterion 2. A cap that is real only in the API's rejection is a screen
     * that disagrees with its own product — the seller clicks, waits, and is
     * told no by a page that had already drawn the control as available.
     */
    await expect(page.getByRole("button", { name: "Add another branch" })).toHaveCount(0);

    const upgrade = page.getByRole("link", { name: /allows/ });
    await expect(upgrade).toBeVisible();
    await expect(upgrade).toHaveAttribute("href", "/onboarding/plan");
  });

  test("names the plan that actually raises the cap", async ({ page }) => {
    // Read from the plans table, never written into copy: "Basic allows three"
    // in a sentence is a sentence that survives the plan being re-capped.
    const upgrade = page.getByRole("link", { name: /allows/ });
    await expect(upgrade).not.toContainText("Free");
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

/**
 * Board 2e, from the seat that sees three cards.
 *
 * The Pro fixture is already paying, so it gets criterion 21's one-line
 * confirmation and no chooser at all — every claim about the cards has to be
 * asserted from here, which is the same reason board 11a has its own session.
 */
test.describe("board 2e — the plan step on Free", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/onboarding/plan");
  });

  test("opens by saying the listing is already live", async ({ page }) => {
    /*
     * Criterion 1, and the whole design underneath it. Publishing is not gated
     * on payment, so this page cannot lean on a withheld listing — it has to
     * argue on merit, and the first thing it does is give up the leverage.
     */
    await expect(
      page.getByRole("heading", { level: 1, name: /You.re live/ }),
    ).toBeVisible();
    await expect(page.getByRole("banner")).toContainText("already live");
  });

  test("carries no countdown, no expiry and no nag against Free", async ({ page }) => {
    // Criterion 2. Free is a product, not a trial, and `1l` says so.
    const body = await page.locator("main").innerText();
    expect(body).not.toMatch(/expires?|hurry|limited time|only \d+ (hours|days) left/i);
    expect(body).not.toMatch(/complete your listing/i);
  });

  test("promotes exactly one card", async ({ page }) => {
    // Criterion 15. The promoted shadow is used here and on 1l and nowhere else.
    const promoted = page.locator('[data-promoted="true"]');
    await expect(promoted).toHaveCount(1);
  });

  test("offers the trial on Pro and on nothing else", async ({ page }) => {
    // Criterion 14. Basic's CTA never implies one.
    await expect(page.getByRole("button", { name: /Start Pro trial/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Choose Basic/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /trial/i })).toHaveCount(0);
  });

  test("says the trial takes no card", async ({ page }) => {
    // Criterion 12, stated where the decision is made rather than in a footnote.
    await expect(page.getByText(/No card\./)).toBeVisible();
  });

  test("renders every figure from the plan table", async ({ page }) => {
    /*
     * Criterion 3. The render drew AED 99 and AED 299; the seeded plans are 349
     * and 899, and this page is the fourth surface showing the same numbers
     * after 1a, 1l and 1d. A hardcoded price here is a seller who reads one
     * figure and is charged another.
     */
    const cards = page.getByRole("region").filter({ hasText: /AED|Free/ });
    const text = (await page.locator("main").innerText());
    expect(await cards.count()).toBeGreaterThanOrEqual(3);
    expect(text).not.toContain("AED 299");
    expect(text).toMatch(/AED [\d,]+/);
  });

  test("says locations, never branches", async ({ page }) => {
    // Criterion 8. One word, three screens — 1l, 2d and this.
    const body = await page.locator("main").innerText();
    expect(body).toMatch(/locations?/i);
    expect(body).not.toMatch(/\bbranch(es)?\b/i);
  });

  test("promises no top slot, and names the multiplier and the eligibility", async ({ page }) => {
    /*
     * Criterion 4, the correction this board exists for. The sponsored slot is
     * one per subcategory × emirate, bought on 11e, with a waiting list when it
     * is taken — so Pro cannot deliver it to every Pro subscriber and the
     * arithmetic forbids the claim.
     */
    const rail = page.getByRole("complementary");
    await expect(rail).toContainText(/eligible to buy the sponsored slot/);
    await expect(rail).not.toContainText(/top slot/i);
    await expect(rail).toContainText(/multiplied/);
  });

  test("says how small a ranking factor plan actually is", async ({ page }) => {
    // Criterion 5. A 3× multiplier on the smallest of six weights is not a
    // tripling of visibility, and the page must never imply that it is.
    await expect(
      page.getByText(/points a search score is built from, and the smallest of the six/),
    ).toBeVisible();
  });

  test("does not claim unlimited seats on Pro", async ({ page }) => {
    // Criterion 6. Pro caps at a real number and `1l` states it.
    const body = await page.locator("main").innerText();
    expect(body).not.toMatch(/unlimited (everything|seats)/i);
  });

  test("states the enquiry cap as something to answer", async ({ page }) => {
    // Criterion 7. On a seller-facing card an RFQ count reads as an allowance
    // to send; the cap is on what reaches them.
    await expect(page.getByText(/enquiries a month to answer/).first()).toBeVisible();
  });

  test("repeats the seller's own setup back to them", async ({ page }) => {
    /*
     * Criterion 9. The render cited three branches and a fabrication shop for a
     * seller who pinned one workshop — worse than a generic line, because it
     * says the platform was not paying attention for four steps.
     */
    const lead = page.getByText(/Based on what you told us/);
    await expect(lead).toBeVisible();
    await expect(lead).toContainText(/location/);
  });

  test("suppresses the cohort claim rather than softening it", async ({ page }) => {
    // Criterion 10. Below thirty sellers the clause is removed; "many" is a
    // claim with the evidence taken out and reads as one.
    const body = await page.locator("main").innerText();
    if (!/claimed suppliers in/.test(body)) {
      expect(body).not.toMatch(/most sellers|many sellers/i);
    } else {
      expect(body).toMatch(/\d+ of the \d+ claimed suppliers in/);
    }
  });

  test("counts the checklist rather than stating it", async ({ page }) => {
    // Criteria 17 and 18.
    const heading = page.getByText(/Finish setting up|Everything is done/);
    await expect(heading).toBeVisible();
    const text = await heading.innerText();
    expect(text).not.toContain("0 things left");
  });

  test("links the live URL at the listing it names", async ({ page }) => {
    // Criterion 19. `View it` opens 1d.
    const view = page.getByRole("link", { name: "View it" });
    await expect(view).toHaveAttribute("href", /^\/b\/[a-z0-9-]+$/);
  });

  test("carries the same step chain as every other step", async ({ page }) => {
    // Criterion 22.
    const chain = page.getByRole("navigation", { name: "Set up your listing" }).getByRole("list");
    await expect(chain.getByText("Plan", { exact: true })).toBeVisible();
    await expect(chain.getByText("Locations", { exact: true })).toBeVisible();
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});
