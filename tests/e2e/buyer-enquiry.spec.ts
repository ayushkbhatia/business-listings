import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Handoff 2, step 3 — the buyer's side, in a browser.
 *
 * The rules are proven in tests/integration/enquiry-fanout.test.ts, against a
 * real database and through the same service the routes call. What is proven
 * here is what a test in node cannot see: that the three-step wizard advances,
 * that the tracking page draws its zero-quotes state, that comparing two quotes
 * puts the numbers in a column, and that none of it is reachable by somebody
 * who is not the buyer.
 *
 * The claim token is seeded — see PROVISIONAL_CLAIM_TOKEN in prisma/seed.mts.
 * A buyer with no account is the normal case, and it is the only way to reach
 * these pages without a session.
 */
const TOKEN = "seed-0000-4000-8000-provisional01";
const ENQUIRY_ID = "seedenquiryprovisional0001";
const ENQUIRY_REF = "ENQ-8871";

/** Both fixed in prisma/seed.mts, so no test-only endpoint is needed. */
const enquiryPath = (suffix = "") => `/enquiry/${ENQUIRY_ID}${suffix}?t=${TOKEN}`;

test.describe("the fan-out, in one route", () => {
  /*
     These pinned the wizard: "Step 1 of 3", a Continue button between each
     step, and validation that refused to advance. Board 1h removed all three —
     "the stepper reflects completion, not navigation", "all three steps live on
     one route and the page never reloads", "steps never gate backwards" — so
     they assert the same intents against the model that replaced it.

     Rewritten rather than deleted. What they were protecting is still worth
     protecting: that a buyer can see who the enquiry reaches, that the page
     says what is missing rather than dead-ending, and that the privacy promise
     is made before anything is sent.
  */

  test("shows who the enquiry will reach, with no step to walk through", async ({ page }) => {
    await page.goto("/rfq/new?category=valves-and-fittings");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Request a quote");
    await expect(page.getByText("1 / 3")).toBeVisible();

    // One line is the whole of step 1. There is no Continue.
    await page.getByLabel("Item on line 1").fill("Resilient seated gate valve, flanged");
    await expect(page.getByText("2 / 3")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0);

    // Matched, not guessed: the same selector the send uses.
    await expect(page.getByText(/Sending to \d+ sellers?/)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Send to \d+ seller/ })).toBeVisible();
  });

  test("says what is missing rather than refusing to advance", async ({ page }) => {
    /*
       The old shape blocked a Continue and raised an alert. There is nothing to
       advance past now, so the same information is on the Send button's reason
       line — and it is visible from the first paint rather than after a click
       that fails.
    */
    await page.goto("/rfq/new?category=valves-and-fittings");
    await expect(page.getByRole("button", { name: /^Send/ })).toBeDisabled();
    /*
       The Send block renders at both breakpoints with `display` deciding which
       is shown, so the reason line matches twice. Ask for the visible one — the
       same shape board 1f's delivery card needed.
    */
    await expect(
      page.getByText("Add what you need, and sellers will match.").locator("visible=true"),
    ).toHaveCount(1);
  });

  test("says a buyer's number is withheld before they type it", async ({ page }) => {
    /*
       Rule 1, said before the enquiry is sent rather than after — and now said
       on arrival, because nothing is hidden behind a step. The old version had
       to click through two Continues to reach it.
    */
    await page.goto("/rfq/new?category=valves-and-fittings");
    await expect(page.getByText(/stay with us until you accept a quote/)).toBeVisible();
  });
});

test.describe("tracking an enquiry", () => {
  test("a buyer with no account reaches theirs by the link they were given", async ({ page }) => {
    await page.goto(enquiryPath());
    await expect(page.getByText(ENQUIRY_REF)).toBeVisible();
    await expect(page.getByRole("heading", { name: /Track this enquiry/ })).toBeVisible();
  });

  test("shows who has it, and every quote that came back", async ({ page }) => {
    await page.goto(enquiryPath());
    await expect(page.getByRole("heading", { name: "Who has it" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /\d+ quotes?/ })).toBeVisible();
  });

  test("is not reachable without the token", async ({ page }) => {
    const path = enquiryPath();
    const response = await page.goto(path.replace(/\?t=.*/, ""));
    expect(response?.status()).toBe(404);
  });

  test("is not reachable with somebody else's token", async ({ page }) => {
    const path = enquiryPath();
    const response = await page.goto(path.replace(TOKEN, "seed-0000-4000-8000-notyourtoken"));
    expect(response?.status()).toBe(404);
  });
});

test.describe("comparing quotes", () => {
  test("puts the quotes in columns and names what accepting does", async ({ page }) => {
    await page.goto(enquiryPath("/compare"));
    await expect(page.getByRole("heading", { name: "Compare quotes" })).toBeVisible();

    // A real table, because the buyer is reading down a column.
    const table = page.getByRole("table", { name: /Quotes side by side/ });
    await expect(table).toBeVisible();
    await expect(table.getByRole("columnheader")).toHaveCount(3);

    await expect(page.getByText(/Accepting releases your number/)).toBeVisible();
  });

  test("the accept button names the revision and the amount", async ({ page }) => {
    // "Accept r1 — AED 8,904". A button that says only "Accept" on a screen
    // with three columns is a button that does not say what it does.
    await page.goto(enquiryPath("/compare"));
    await expect(page.getByRole("button", { name: /^Accept r\d+ — AED [\d,]+$/ }).first()).toBeVisible();
  });

  test("marks the lowest total, so the comparison is not only arithmetic", async ({ page }) => {
    await page.goto(enquiryPath("/compare"));
    await expect(page.getByText("Lowest total")).toBeVisible();
  });

  test("shows no price anywhere for somebody without the token", async ({ page }) => {
    const path = enquiryPath("/compare");
    const response = await page.goto(path.replace(/\?t=.*/, ""));
    expect(response?.status()).toBe(404);
  });
});

test.describe("the catalogue tray", () => {
  test("selecting products offers an enquiry about all of them", async ({ page }) => {
    await page.goto("/b/al-marwan-industrial-supplies-llc/products");
    const boxes = page.getByRole("checkbox");
    await boxes.first().check();
    await boxes.nth(1).check();
    await expect(page.getByText("2 products selected")).toBeVisible();
    await expect(page.getByRole("button", { name: /Enquire about 2 products/ })).toBeVisible();
  });
});

test.describe("the storefront composer", () => {
  /*
   * Board 1d made these controls width-dependent, so the tests match on what
   * they do rather than on one label.
   *
   * The board sets the verbs deliberately: "Request a quote" opens a composer
   * the buyer has not filled in, "Enquire" is the compact control where there
   * is no room for that, and "Send enquiry" is the submit *inside* a composer.
   * The identity block carries the first; the mobile bar carries the second.
   */
  const OPENS_COMPOSER = /Request a quote|^Enquire$/;
  /* The masked number is the control on a wide screen; the bar says "Call". */
  const REVEALS_NUMBER = /•|^Call$/;

  test("the enquiry affordance is live, and opens a composer naming the supplier", async ({ page }) => {
    await page.goto("/b/al-marwan-industrial-supplies-llc");
    await page.getByRole("button", { name: OPENS_COMPOSER }).first().click();
    await expect(page.getByRole("dialog")).toContainText("Al Marwan");
    await expect(page.getByRole("dialog")).toContainText(/stay with us until you accept a quote/);
  });

  test("revealing a phone number shows it, having recorded the ask", async ({ page }) => {
    await page.goto("/b/al-marwan-industrial-supplies-llc");

    /*
     * The invariant, and it is about what a reader sees rather than what the
     * markup holds — which is a distinction this board created deliberately.
     *
     * `LocalBusiness` JSON-LD now carries the real telephone, because board 1d
     * says so in as many words: the mask exists so that asking is an event we
     * can count, and a crawler will never send an enquiry. So the number *is*
     * in the document before the reveal, and correctly so. What must not be
     * there is the number on screen.
     *
     * `textContent` would read the script tags and fail on exactly that, which
     * is how this assertion was written first.
     */
    const before = await page.evaluate(() => document.body.innerText);
    expect(before).not.toMatch(/\+9715|\b0\d{8}\b/);

    await page.getByRole("button", { name: REVEALS_NUMBER }).first().click();

    /*
     * Rendered text again, and for a second reason: `getByText(...).first()`
     * matched the *masked* number in the hidden desktop row, because "02 37•
     * ••••" also begins with a digit. `innerText` skips what is display:none,
     * so this asks the question the test means — is a real number now on
     * screen — at either width.
     */
    await expect
      .poll(() => page.evaluate(() => document.body.innerText))
      .toMatch(/\+971|\b0\d{8}\b/);
  });
});

test.describe("accessibility", () => {
  for (const path of ["/rfq/new?category=valves-and-fittings"]) {
    test(`${path} is axe clean`, async ({ page }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .disableRules(["color-contrast"])
        .analyze();
      const summary = results.violations.map((v) => `${v.id}: ${v.help}`);
      expect(summary, summary.join("\n")).toEqual([]);
    });
  }

  test("the tracking and compare pages are axe clean", async ({ page }) => {
    for (const suffix of ["", "/compare"]) {
      await page.goto(enquiryPath(suffix));
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .disableRules(["color-contrast"])
        .analyze();
      const summary = results.violations.map((v) => `${suffix || "/"} ${v.id}: ${v.help}`);
      expect(summary, summary.join("\n")).toEqual([]);
    }
  });
});
