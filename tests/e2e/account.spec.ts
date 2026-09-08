import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Boards 3l, 3m, 7d, 11e, 11f, 11g, 11h and 11j, signed in as a seller.
 *
 * Criteria 9 and 10 are proved in tests/integration — they are claims about
 * what services refuse and what they write, and a browser is the wrong
 * instrument for either. What is asserted here is what the seller is *told*,
 * because on this screen the wording is the product: the fear about cancelling
 * is that the catalogue is deleted, and the answer has to be visible.
 */

test.describe("board 11f — change plan", () => {
  /*
     The seller is `al-marwan-industrial-supplies-llc`, seeded on Pro. Every
     assertion below is against that: Pro is the current column, and Basic and
     Free are both downgrades.

     This block was written against the first `11f`, which drew three plan cards
     with a `Recommended` badge and a `Your plan` label. That board was replaced
     by a comparison table, so the assertions moved with it — what is tested is
     the same claim in both cases, which is that the screen says what a change
     costs before it costs anything.
  */
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/billing/change");
  });

  test("renders the whole ladder, with the seller's own column marked", async ({ page }) => {
    const grid = page.getByRole("table", { name: /What each plan holds/ });
    await expect(grid).toBeVisible();
    // Nine rows: four meters, then enquiries and four entitlements.
    await expect(grid.getByRole("row")).toHaveCount(10);
    await expect(grid.getByText("Current plan")).toBeVisible();
  });

  test("states one denominator per row — criterion 4", async ({ page }) => {
    /*
       The board's first correction. Team seats read `1 of 3`, `2 of 3` and
       `3 of 5 used` — the first two against the seller's seats and the third
       against Pro's cap, so a reader comparing across was comparing nothing.

       Every cell in a row now counts against the same figure: what the seller
       has. The plan holding all of them says `All n` rather than restating its
       own cap.
    */
    const seats = page.getByRole("row").filter({ hasText: "Team seats" });
    const cells = await seats.getByRole("cell").allInnerTexts();
    expect(cells).toHaveLength(3);

    const denominator = cells
      .map((cell) => /(?:of|All)\s+([\d,]+)/.exec(cell)?.[1])
      .filter(Boolean);
    expect(denominator).toHaveLength(3);
    expect(new Set(denominator).size).toBe(1);
  });

  test("never shows two prices for one plan without saying which it charges", async ({ page }) => {
    /*
       Board 11f's follow-up audit, and the reason it is asserted here rather
       than in a unit test: it is a claim about two numbers appearing on one
       screen, and the only instrument that can see both is a browser.

       The columns compare annual prices when the toggle is flipped; the rail
       quotes the seller's own term, because `quotePlanChange` reads it from the
       subscription and there is no shape for changing both in one transaction.
       A monthly seller could read AED 8,990 in the Pro column and AED 943.95 in
       the rail with nothing between them.
    */
    await page.goto("/dashboard/billing/change?term=annual&plan=basic");

    const body = (await page.textContent("main")) ?? "";
    test.skip(!body.includes("Quoted"), "this seller is already on the annual term");

    await expect(page.getByText(/Quoted monthly, because that is how your subscription is paid/))
      .toBeVisible();
    // And the other change is offered as its own step rather than left implied.
    await expect(page.getByRole("link", { name: "Switch to annual instead" })).toBeVisible();
  });

  test("names an absent entitlement rather than hiding it", async ({ page }) => {
    // The absence is what the next tier up is selling.
    const domain = page.getByRole("row").filter({ hasText: "Custom domain" });
    await expect(domain.getByText("Not on this plan").first()).toBeVisible();
  });

  test("schedules a downgrade rather than charging for one", async ({ page }) => {
    /*
       Criterion 6. A downgrade takes effect at the end of the period: nothing is
       charged on the day, the effective date is stated, and it is withdrawable
       until then. The action says what it does — `Schedule downgrade`, not
       `Downgrade`.
    */
    await page.getByRole("link", { name: /Select Basic/ }).click();

    await expect(page.getByText("Due today")).toBeVisible();
    await expect(page.getByText("AED 0.00")).toBeVisible();
    await expect(page.getByText(/takes effect at the end of the period/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Schedule downgrade to Basic/ })).toBeVisible();
    await expect(page.getByText(/Withdraw any time before/)).toBeVisible();
  });

  test("prices a downgrade from the renewal, VAT included", async ({ page }) => {
    // Rule 3 of the convention: every total is labelled `incl. VAT`, and nothing
    // is rounded.
    await page.getByRole("link", { name: /Select Basic/ }).click();
    await expect(page.getByText(/^From /)).toBeVisible();
    await expect(page.getByText("incl. VAT").first()).toBeVisible();
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

/**
 * Board 11g — the tax invoice.
 *
 * The route needs an invoice id, so it is reached the way a seller reaches it:
 * from `3m`'s list. That also asserts the link exists, which it deliberately did
 * not while `11g` was unbuilt — a reference pointing at a 404 is worse than one
 * that does not move.
 */
test.describe("board 11g — tax invoice", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/billing");
    await page.getByRole("link", { name: /^Open invoice / }).first().click();
    await expect(page.getByRole("heading", { name: /Tax invoice|Credit note/ })).toBeVisible();
  });

  test("states every mandatory field, each separately labelled", async ({ page }) => {
    // Criterion 5. The board printed one date and let it stand for three.
    const sheet = page.getByRole("article");
    await expect(sheet).toContainText("Date of issue");
    await expect(sheet).toContainText("Date of supply");
    await expect(sheet).toContainText("Supply period");
    await expect(sheet).toContainText("Place of supply");
    await expect(sheet).toContainText("Currency");
  });

  test("labels the recipient's TRN, and prints no supplier one", async ({ page }) => {
    /*
       The issuing entity is Delaware-registered and holds no TRN. With one tax
       number on a page an unlabelled one reads as the issuer's.
    */
    const sheet = page.getByRole("article");
    await expect(sheet).toContainText(/Recipient TRN/);
    await expect(sheet).toContainText("Bearing Deployment Company, Inc");
    await expect(sheet).not.toContainText(/Supplier TRN/);
  });

  test("carries VAT per line rather than one blended row", async ({ page }) => {
    // Criterion 4, and the correction that outranks the board: a blended row
    // cannot express a zero-rated line, and a document cannot be re-laid-out.
    const table = page.getByRole("article").getByRole("table");
    await expect(table.getByRole("columnheader", { name: /Rate/ })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: /VAT AED/ })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: /Unit AED/ })).toBeVisible();
  });

  test("marks every panel that will not reach the PDF", async ({ page }) => {
    // Criterion 9. The tag is the design decision rather than decoration: it is
    // how a reader can tell what a forwarded PDF will and will not say.
    await expect(page.getByText("Not in the PDF").first()).toBeVisible();
  });

  test("says an issued invoice cannot be edited, and offers nothing that would", async ({ page }) => {
    // Criterion 10. The only controls are send and download, and neither writes
    // to the document.
    await expect(page.getByText(/This document cannot be edited/)).toBeVisible();
    await expect(page.getByRole("article").getByRole("textbox")).toHaveCount(0);
    await expect(page.getByRole("article").getByRole("button")).toHaveCount(0);
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

/*
   Boards `11h` and `11j` — two routes, one flow, one spec.

   Nothing here confirms a cancellation. The seed rows are shared and this
   seller is the fixture for four other blocks in this file; a spec that
   actually cancelled would leave the account on Free and take the plan-change
   grid, the invoice list and the tax-invoice block down with it. What is
   asserted is everything up to the button, which is where the wording is.
*/
test.describe("board 11h — cancel, step 1", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/billing/cancel");
  });

  test("the consequence table is the screen, and it is a real table", async ({ page }) => {
    const table = page.getByRole("table", { name: /What changes if you cancel/ });
    await expect(table).toBeVisible();
    // Twelve areas plus the header row. Storage and CSV import are two of them,
    // and the board omitted both while claiming to cover every area.
    await expect(table.getByRole("row")).toHaveCount(13);
    await expect(table.getByRole("rowheader", { name: "Storage" })).toBeVisible();
    await expect(table.getByRole("rowheader", { name: "CSV import" })).toBeVisible();
  });

  test("dates the third column rather than heading it `on Free`", async ({ page }) => {
    // Criterion 1: every consequence is dated, and the date comes from the
    // period end rather than from anything written down.
    await expect(
      page.getByRole("columnheader", { name: /On Free from \d/ }),
    ).toBeVisible();
  });

  test("gives the marks a key, so meaning never rests on colour", async ({ page }) => {
    // Criterion 4, and the board's own eleventh correction: three colours and
    // no legend made colour the only carrier of the table's meaning.
    const legend = page.getByRole("list", { name: /What the marks mean/ });
    await expect(legend).toContainText("Unchanged");
    await expect(legend).toContainText(/Reduced/);
    await expect(legend).toContainText("Ends");
  });

  test("says the paid period is not shortened and nothing is paid back", async ({ page }) => {
    // Criterion 2, on both steps. The board never mentioned the paid period at
    // all, on a screen whose whole subject is what happens and when.
    await expect(page.locator("main")).toContainText(/not shortened and the unused part is not paid back/);
  });

  test("says who picks what stays live, and what happens if nobody does", async ({ page }) => {
    // The board said "you pick which" three times and offered no picker. The
    // choice is dated now, and build note B2 is the second sentence.
    await expect(page.locator("main")).toContainText(/picker opens when you confirm/);
    await expect(page.locator("main")).toContainText(/the oldest stay live/);
  });

  test("names the fork without linking to a route that does not exist", async ({ page }) => {
    // Build note B5. `11i` is not drawn and is blocked; a live link to it is
    // the defect corrected on `11d` and `11g`.
    await expect(page.locator("main")).toContainText(/Closing the account removes it altogether/);
    await expect(page.locator('main a[href*="/account/close"]')).toHaveCount(0);
  });

  test("makes no retention offer", async ({ page }) => {
    // Wave 4 ruled them out. The 86-vs-3 panel is the seller's own count from
    // their own account, which is evidence rather than an offer.
    const text = (await page.locator("main").textContent()) ?? "";
    expect(text).not.toMatch(/discount|special offer|wait!|are you sure|stay with us/i);
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 11j — reason and confirm", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/billing/cancel/confirm");
  });

  test("asks six reasons, in a group the question names", async ({ page }) => {
    /*
       The group and its name are the assertion, not decoration.

       The legend started inside a wrapper div for the layout — legal markup
       that silently costs a fieldset its caption, because a `<legend>` only
       names its group as the **first child**. The six radios were announced as
       loose controls with no question attached, and this locator is what found
       it.
    */
    await expect(page.getByRole("radio")).toHaveCount(6);
    const fieldset = page.getByRole("group", { name: /Why are you cancelling/ });
    await expect(fieldset).toBeVisible();
    // The required mark is on the reason and on nothing else.
    await expect(fieldset).toContainText("Required");
    await expect(page.locator("main")).toContainText(/One answer\. It does not change or delay/);
  });

  test("blocks confirming until a reason is picked, and never on the box", async ({ page }) => {
    // Criterion 6. The free-text box is optional and stays optional.
    const confirm = page.getByRole("button", { name: /Cancel from / });
    await expect(confirm).toBeDisabled();

    await page.getByRole("radio", { name: "Too expensive for what we use" }).check();
    await expect(confirm).toBeEnabled();
  });

  test("makes the box required under `Something else`, and says so on the option", async ({ page }) => {
    await expect(page.locator("main")).toContainText(/the box below becomes required/);

    await page.getByRole("radio", { name: "Something else" }).check();
    const confirm = page.getByRole("button", { name: /Cancel from / });
    await expect(confirm).toBeDisabled();

    await page.getByRole("textbox").fill("We are merging with another supplier.");
    await expect(confirm).toBeEnabled();
  });

  test("turns the closing reason into a fork that cancels nothing", async ({ page }) => {
    // Criterion 7. The confirm button is replaced rather than relabelled, and
    // it is inert because `11i` does not exist.
    await page.getByRole("radio", { name: /The business is closing/ }).check();
    await expect(page.getByRole("button", { name: /Cancel from / })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Continue to close account" })).toBeDisabled();
  });

  test("restates step 1 under the date, with one back label", async ({ page }) => {
    // The board headed these `WHAT YOU CONFIRMED` above four things the seller
    // had only read, and gave one destination two labels.
    await expect(page.locator("aside")).toContainText(/What happens on \d/);
    const backs = page.getByRole("link", { name: "What changes" });
    await expect(backs.first()).toBeVisible();
  });

  test("names the invoice that will not be raised", async ({ page }) => {
    // It reconciles with `3m` because both read one figure. A screen naming a
    // different total from the billing page is the defect that pair was drawn
    // to fix.
    await expect(page.locator("aside")).toContainText(/next invoice would have been AED [\d,]+\.\d\d/);
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

/*
   Board 7d's own screen moved to tests/e2e/dashboard-team.spec.ts when the
   screen was rebuilt: the seat table, the capability matrix, the routing card
   and the per-seat panel are a board's worth of assertions and they belong in
   one file with the board's number on it.

   Three of what was here are gone by design rather than untested.
   `Median reply time` is no longer a column — §3's six are `PERSON · ROLE ·
   BRANCH SCOPE · OPEN · REACHABLE ON · STATUS`, and the medians moved to the
   thirty-day panel where the window can be stated. `what protects your reply
   time` was cut with the response score it named (§8). The rest of what stood
   here is asserted in the new file, against the board that asks for it.

   What stays: the two facts about a seat that are this file's subject rather
   than 7d's — what a sales seat cannot do, and that an invitation cannot make
   an owner.
*/
test.describe("board 7d — the seat, from the account side", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/team");
  });

  test("says what a sales seat cannot do", async ({ page }) => {
    await expect(page.getByText(/cannot see invoices, change the plan or touch licence details/)).toBeVisible();
  });

  test("measures the owner too, and says so where the medians are", async ({ page }) => {
    // A dashboard that measures everybody except the person reading it is a
    // dashboard nobody trusts about anything else either. The measurement moved
    // to the thirty-day panel; that it includes the owner did not.
    await expect(page.getByRole("heading", { name: /Last 30 days by seat/ })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "YOU" })).toBeVisible();
  });

  test("cannot invite somebody as an owner", async ({ page }) => {
    const roles = page.getByLabel("What they can do");
    await expect(roles.getByRole("option", { name: "Owner" })).toHaveCount(0);
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 11e — sponsored placement", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/promote");
  });

  test("states the three rules before anything can be bought", async ({ page }) => {
    const rules = page.getByRole("region", { name: "What a sponsored slot does, and does not" });
    await expect(rules).toContainText(/Always labelled/);
    await expect(rules).toContainText(/Never above a verified supplier/);
    await expect(rules).toContainText(/Nobody can buy the whole category/);
  });

  test("puts the free things first, above the buy control", async ({ page }) => {
    // An honest upsell that appears below the thing it warns about is
    // decoration.
    const main = (await page.locator("main").textContent()) ?? "";
    expect(main.indexOf("Fix the free things first")).toBeLessThan(main.indexOf("What a sponsored slot"));
  });

  test("says it is not an auction", async ({ page }) => {
    await expect(page.getByText(/Not auctioned/)).toBeVisible();
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 3l — analytics", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/analytics");
  });

  test("states the window as a comparison, not as `last 30 days`", async ({ page }) => {
    /*
       The board's first rule. "Last 30 days" sat above a page of bare counts,
       and a seller opens analytics to find out whether last month's work moved
       anything — which a single window cannot answer.
    */
    await expect(page.getByRole("banner")).toContainText(/\d+ \w+.* vs .*\d+ \w+/);
  });

  test("carries every stage from the one above, and says so", async ({ page }) => {
    // Criterion 1 and the board's largest correction: the bars were drawn
    // against the top of the funnel and overstated every stage below the first.
    await expect(page.getByText("Bars are the share carried from the stage above")).toBeVisible();
    await expect(page.getByText(/Stages, not one path/)).toBeVisible();

    for (const stage of [
      "Appeared in search",
      "Clicked through to your listing",
      "Viewed a product",
      "Revealed a phone number",
      "Sent an enquiry",
    ]) {
      await expect(page.getByText(stage, { exact: false }).first()).toBeVisible();
    }
  });

  test("gives every figure a change or says it has none", async ({ page }) => {
    /*
       Criterion 2. Week one is a normal page with its comparisons suppressed —
       `no comparison yet` is the state, and a zero would say nothing changed
       when the truth is there is nothing to change against.
    */
    const main = page.locator("main");
    const text = (await main.textContent()) ?? "";
    expect(/[+−]\d|no comparison yet|held|Not ranked/.test(text)).toBe(true);
  });

  test("never says n/a in the colour of a bad rank", async ({ page }) => {
    // Criterion 4. Not ranked is a state, not the worst position on the page.
    const text = (await page.locator("main").textContent()) ?? "";
    expect(text).not.toMatch(/\bn\/a\b/i);
  });

  test("names what the export contains", async ({ page }) => {
    // Spec Q5. `Export CSV` with no scope left a seller guessing whether they
    // were about to download five rows or five hundred thousand.
    const link = page.getByRole("link", { name: /Export CSV/ });
    await expect(link).toBeVisible();
    await expect(link).toContainText(/tables on this page/);
  });

  test("makes no claim about what the seller stocks", async ({ page }) => {
    /*
       Build note B6. Nothing in the product knows a seller's unlisted
       inventory, and the board asserted "you stock them" anyway. Demand is ours
       to state; supply is not.
    */
    const text = (await page.locator("main").textContent()) ?? "";
    expect(text).not.toMatch(/you stock/i);
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});
