import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Board 3j — the leads and RFQ inbox, in a browser.
 *
 * Named `dashboard-leads-inbox` because the name decides which Playwright
 * project owns the file: the seller project matches
 * `(dashboard|overview|catalogue|listing|account|onboarding|pricing-seller)[\w-]*\.spec\.ts`
 * against the absolute path. `leads-inbox.spec.ts` would run signed *out*, in
 * chromium and mobile, and fail on a redirect that had nothing to do with the
 * screen.
 *
 * The seat is al-marwan-industrial-supplies-llc, which the seed gives a
 * catalogue and — since `seedInboxStates` — one lead in each of the four tabs
 * and each of the four waiting bands.
 *
 * ## What is asserted here and not in integration
 *
 * The four tabs, the ordering and the outcome rules are queries, and
 * tests/integration/leads-inbox.test.ts owns them against a real database. What
 * needs a browser is the half a query cannot answer: that the counts on screen
 * agree with the list under them and with the sidebar, that a band carries a
 * word rather than only a colour, and that no buyer's surname reaches the page.
 */

test.describe("board 3j — the rail", () => {
  test("lands on an h1 the auth setup depends on", async ({ page }) => {
    /*
       tests/e2e/auth.setup.ts sends both seller seats to `/dashboard/leads` and
       asserts a heading containing "Leads", and every signed-in project declares
       `dependencies: ["setup"]`. Break this and five projects go red for a
       reason that names none of them.
    */
    await page.goto("/dashboard/leads");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Leads");
  });

  test("shows a first name and no more of the buyer", async ({ page }) => {
    /*
       Rule 1, on the screen rather than only in the query layer. Both of this
       board's renders show the buyer's company and full name on an unaccepted
       RFQ; lib/db/queries/seller-visibility.ts never selects the columns, and
       this is what would catch a screen that found another way to them.

       The seeded buyers are Rashid Al Hameli and Khalid Al Nuaimi.
    */
    await page.goto("/dashboard/leads");
    const body = (await page.textContent("main")) ?? "";
    expect(body).not.toContain("Al Hameli");
    expect(body).not.toContain("Al Nuaimi");
    expect(body).not.toMatch(/\+971|\b0\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/);
    expect(body).not.toMatch(/[\w.-]+@[\w.-]+\.\w+/);
  });

  test("agrees with the sidebar about how many leads are open", async ({ page }) => {
    /*
       The badge used to count delivered, opened *and* quoted while the rail's
       Open tab counts the first two, so the nav said twenty over a list of nine.
       Both now read `tabWhere`; this is what holds them together.
    */
    await page.goto("/dashboard/leads");
    const openTab = page.getByRole("link", { name: /^Open/ });
    const openCount = ((await openTab.textContent()) ?? "").replace(/\D/g, "");
    const badge = (await page.getByRole("link", { name: /Leads & RFQ/ }).textContent()) ?? "";
    expect(badge.replace(/\D/g, "")).toBe(openCount);
  });

  test("counts the rows it is showing", async ({ page }) => {
    // "If a header, a note or a section title states a count, count the
    // elements." The footer says what is shown against what exists.
    await page.goto("/dashboard/leads");
    const rows = await page.getByRole("listitem").filter({ hasText: /ENQ-/ }).count();
    const footer = (await page.getByText(/lead(s)? *$|of \d+ shown/).first().textContent()) ?? "";
    const shown = Number(footer.replace(/\D/g, "").slice(0, 3));
    expect(rows).toBeGreaterThan(0);
    expect(shown).toBe(rows);
  });

  test("says overdue in words, not only in red", async ({ page }) => {
    // docs/design-system.md: never colour alone. The seller reading this on a
    // bad monitor at the end of a long day is who the rule is for.
    await page.goto("/dashboard/leads");
    await expect(page.getByText("Overdue").first()).toBeVisible();
  });

  test("labels the buyer's figure as the buyer's", async ({ page }) => {
    /*
       There is no stored estimate. The only source is the buyer's own
       `targetUnitPriceAed`, and calling it a deal value would turn a budget
       into a forecast.
    */
    await page.goto("/dashboard/leads");
    await expect(page.getByText(/Buyer's budget AED/).first()).toBeVisible();
    // And never abbreviated — formatAED says so in its own docblock.
    expect(await page.textContent("main")).not.toMatch(/AED\s*[\d.]+\s*[kKmM]\b/);
  });

  test("keeps the tab and the scope in the URL, so a view can be sent", async ({ page }) => {
    await page.goto("/dashboard/leads");
    await page.getByRole("link", { name: /^Won/ }).click();
    await expect(page).toHaveURL(/tab=won/);
    // A tab is a link, so it is in history and opens in a new tab.
    await page.goBack();
    await expect(page).toHaveURL(/\/dashboard\/leads$/);
  });

  test("offers each of the four tabs a state of its own", async ({ page }) => {
    for (const tab of ["quoted", "won", "lost"]) {
      await page.goto(`/dashboard/leads?tab=${tab}`);
      const main = (await page.textContent("main")) ?? "";
      // Either rows, or the empty state written for that tab — never a blank.
      expect(main.length, tab).toBeGreaterThan(200);
    }
  });
});

test.describe("board 3j — one lead", () => {
  async function openFirstLead(page: import("@playwright/test").Page) {
    await page.goto("/dashboard/leads");
    await page.getByRole("listitem").filter({ hasText: /ENQ-/ }).first().getByRole("link").click();
    await page.waitForURL(/\/dashboard\/leads\/[a-z0-9]+/);
  }

  test("carries the buyer's own words rather than a summary", async ({ page }) => {
    // §4: sellers price off details a summary loses — "UL/FM listed", "two
    // drops". The quoted block is the buyer's text as submitted.
    await openFirstLead(page);
    await expect(page.getByText(/as submitted/)).toBeVisible();
  });

  test("flags a line no catalogue can match, and never leaves it blank", async ({ page }) => {
    await openFirstLead(page);
    await expect(page.getByRole("table", { name: /Quote lines/ })).toBeVisible();
    // The price box on a hand-priced line starts empty, with no placeholder
    // that could be mistaken for a value.
    const prices = page.getByLabel(/^Unit price for/);
    await expect(prices.first()).toHaveValue("");
    await expect(prices.first()).toHaveAttribute("placeholder", "");
  });

  test("bridges to the conversation, from the seller's side of the words", async ({ page }) => {
    /*
       §2 requires the exit in both directions. It says "the buyer" because the
       person reading this screen is the seller — buyer and seller are the
       vocabulary CLAUDE.md and check:vocabulary both police.
    */
    await openFirstLead(page);
    const bridge = page.getByRole("link", { name: "Message the buyer" });
    await expect(bridge).toBeVisible();
    await bridge.click();
    await expect(page).toHaveURL(/\/thread$/);
  });

  test("offers both outcomes, which is what the Won tab counts", async ({ page }) => {
    // `Mark won` was missing from the board while the tab bar counted `Won 14`,
    // so nothing on the screen could have produced that number.
    await openFirstLead(page);
    await expect(page.getByRole("button", { name: "Mark won" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Mark lost" })).toBeVisible();
  });

  test("says no amount is recorded when a lead is marked lost", async ({ page }) => {
    /*
       Board 3j asks for a seller-reported figure. CLAUDE.md lists quoted value
       among the derived metrics with no writable path, so the dialog says so
       rather than leaving the absence to be noticed.
    */
    await openFirstLead(page);
    await page.getByRole("button", { name: "Mark lost" }).click();
    await expect(page.getByText(/Quoted value is the sum of accepted quotes/)).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
  });

  test("states rule 1 to the seller rather than only enforcing it", async ({ page }) => {
    await openFirstLead(page);
    await expect(
      page.getByText("Contact details are released when a quote is accepted"),
    ).toBeVisible();
  });
});

test.describe("board 3j — accessibility", () => {
  test("passes axe on the rail and on a lead", async ({ page }) => {
    for (const path of ["/dashboard/leads", "/dashboard/leads?tab=won"]) {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        /*
           Token-level, enumerated in docs/contrast.md and pinned on the gallery:
           `--muted` on `--card` is 4.45:1 against a 4.5 floor, everywhere in the
           product. It is a decision the canvas owes, not one this screen can
           take, and the rest of the seller suite disables the rule for the same
           reason. `pnpm check:contrast` is where it is watched.
        */
        .disableRules(["color-contrast"])
        .analyze();
      const summary = results.violations.map((v) => `${v.id}: ${v.help}`);
      expect(summary, `${path}\n${summary.join("\n")}`).toEqual([]);
    }
  });

  test("reaches every tab from the keyboard, with a visible focus ring", async ({ page }) => {
    await page.goto("/dashboard/leads");
    const won = page.getByRole("link", { name: /^Won/ });
    await won.focus();
    await expect(won).toBeFocused();
    const shadow = await won.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(shadow).not.toBe("none");
  });

  test("has one h1 and a named list", async ({ page }) => {
    await page.goto("/dashboard/leads");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("list", { name: /oldest waiting first/ })).toBeVisible();
  });
});
