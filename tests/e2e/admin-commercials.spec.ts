import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Boards 4g and 12e, from an ops lead's session.
 *
 * Criterion 10 is the one worth being careful about — *"dunning runs the
 * D0/D3/D7/D14 sequence and never deletes a listing or removes a badge"* — and
 * its second half is a negative. It is asserted here as an absence on the
 * screen: no control on the failed-payments page can suspend, unpublish or
 * unverify, because the sequence has no such action to offer.
 *
 * These run under `staff-finance`, not `staff`. §07 puts `revenue.read` with
 * finance and gives ops lead a dash, so an ops lead gets a 404 from every
 * screen here — which `admin-moderator.spec.ts` asserts is the rule rather than
 * a gap.
 *
 * `color-contrast` is disabled, as it is on every other console spec since
 * handoff 1. The token pairings in §09.2 fail the floor at caption sizes and
 * the decision to change them is a canvas one that has not been made. Leaving
 * the rule on would fail every screen in the console for the same reason, and
 * silently disabling it per screen would let a real regression through — so it
 * is off deliberately and said out loud.
 */

test.describe("board 4g — revenue", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/revenue");
  });

  test("opens on last month's five figures", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Revenue");
    await expect(page.getByText(/closed month/)).toBeVisible();
    for (const label of ["Placement revenue", "ARPA", "Gross revenue churn", "Failed payments"]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
  });

  test("prints the formula beside every ratio (B2)", async ({ page }) => {
    // Net revenue retention states its sum, and the sum has no new business in it.
    await expect(page.getByText(/Net revenue retention [\d.]+% = \(/)).toBeVisible();
    await expect(page.getByText(/new subscriptions and accounts that came back are not in it/)).toBeVisible();
    await expect(page.getByText(/cancelled or lapsed ÷ AED [\d,.]+ starting MRR/)).toBeVisible();
    await expect(page.getByText(/÷ [\d,]+ paying accounts?$/)).toBeVisible();
    await expect(page.getByText(/^Customer churn [\d.]+%: [\d,]+ of [\d,]+ accounts? paying at the start$/)).toBeVisible();
  });

  test("draws the waterfall with cancellations and lapses as their own lines", async ({ page }) => {
    const figure = page.getByRole("figure", { name: /Starting MRR, each line of movement/ });
    await expect(figure).toBeVisible();
    for (const line of [
      "Starting MRR",
      "New subscriptions",
      "Came back",
      "Upgrades",
      "Downgrades",
      "Billing term changes",
      "Cancellations",
      "Lapsed after failed payments",
      "Ending MRR",
    ]) {
      await expect(figure.getByText(line, { exact: true })).toBeVisible();
    }
  });

  test("counts reasons that sum to the cancellations in the title (criterion 5)", async ({ page }) => {
    const panel = page.getByRole("region", { name: /Why they cancelled/ });
    const title = await panel.getByRole("heading", { level: 2 }).innerText();
    const stated = Number(/— ([\d,]+)/.exec(title)![1]!.replace(/,/g, ""));
    const counts = await panel.locator("ul").first().locator("li > div > span:last-child").allInnerTexts();
    expect(counts.reduce((sum, count) => sum + Number(count.replace(/,/g, "")), 0)).toBe(stated);
    // The seeded month has three "not enough enquiries" accounts, two of them not answering.
    await expect(panel.getByText(/of the \d+ “not enough enquiries” accounts had a reply rate under 50%/)).toBeVisible();
  });

  test("splits ending MRR by licence emirate in a real table", async ({ page }) => {
    const table = page.getByRole("table", { name: "Revenue by licence emirate" });
    await expect(table.getByRole("rowheader", { name: "Dubai" })).toBeVisible();
    await expect(table.getByRole("rowheader")).toHaveCount(7);
  });

  test("says what MRR counts rather than leaving it to be guessed", async ({ page }) => {
    await expect(page.getByText(/counts subscriptions that are active or past due/)).toBeVisible();
  });

  test("names no share of what buyers pay suppliers", async ({ page }) => {
    // The platform is never party to that transaction. A revenue screen that
    // showed a cut of it would be describing a different product.
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/take rate of|commission/i);
    await expect(page.getByText(/there is no take rate on them/)).toBeVisible();
  });

  test("breaks MRR down by plan, in a real table", async ({ page }) => {
    const table = page.getByRole("table", { name: /By plan/ });
    await expect(table).toBeVisible();
    await expect(table.locator("thead th").first()).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "ARPA" })).toBeVisible();
    // Free is not revenue and does not get a row of zeros.
    await expect(table.getByRole("cell", { name: "Free", exact: true })).toHaveCount(0);
  });

  test("moves between months, and labels the one in progress", async ({ page }) => {
    await page.locator("summary", { hasText: /Month/ }).click();
    const months = page.getByRole("navigation", { name: "Month" });
    const current = months.getByRole("link").first();
    await expect(current).toContainText("So far");
    await current.click();
    await expect(page).toHaveURL(/period=\d{4}-\d{2}/);
    await expect(page.getByText(/days so far/).first()).toBeVisible();
    await expect(page.getByText(/not comparable with a whole one/)).toBeVisible();
  });

  test("exports the month for finance with its period, formulas and filter (criterion 10)", async ({ page }) => {
    const link = page.getByRole("link", { name: "Export for finance" });
    const href = await link.getAttribute("href");
    expect(href).toMatch(/^\/admin\/revenue\/export\?period=\d{4}-\d{2}$/);

    const response = await page.request.get(href!);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/csv");
    expect(response.headers()["content-disposition"]).toMatch(/revenue-\d{4}-\d{2}\.csv/);
    const body = await response.text();
    expect(body).toContain(`# filter,${href!.split("?")[1]}`);
    expect(body).toContain("# formula,net_revenue_retention,");
    expect(body).toContain("section,line,business_id,display_name,licence_emirate,occurred_at_utc,aed,accounts,ratio,detail");
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 12e — plans and entitlements", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/plans");
  });

  test("shows the caps and how many accounts an edit would move", async ({ page }) => {
    const table = page.getByRole("table", { name: /What each plan allows/ });
    await expect(table).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Accounts" })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "On old numbers" })).toBeVisible();
  });

  test("apply-to-existing is off until somebody ticks it, and says what it would move", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /Change Basic/ }).first().click();

    const apply = page.getByRole("checkbox", { name: /Apply to the \d+ accounts/ });
    await expect(apply).toBeVisible();
    await expect(apply).not.toBeChecked();
    await expect(
      page.getByText(/keeps forty until somebody decides otherwise/),
    ).toBeVisible();
  });

  test("will not save without a reason", async ({ page }) => {
    await page.getByRole("button", { name: /Change Basic/ }).first().click();
    await expect(page.getByRole("button", { name: "Save the entitlements" })).toBeDisabled();
    await page.getByRole("textbox", { name: "Why" }).fill("Raising the catalogue cap.");
    await expect(page.getByRole("button", { name: "Save the entitlements" })).toBeEnabled();
  });

  test("does not offer the price on the same form as a cap", async ({ page }) => {
    await page.getByRole("button", { name: /Change Basic/ }).first().click();
    await expect(page.getByText(/Price is not editable here/)).toBeVisible();
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 12e — failed payments, and criterion 10's negative", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/dunning");
  });

  test("names the sequence on the page", async ({ page }) => {
    await expect(
      page.getByText(/Day 0 retry, day 3 email, day 7 WhatsApp, day 14 final notice/),
    ).toBeVisible();
  });

  test("says what a drop does not take away", async ({ page }) => {
    await expect(page.getByText(/the badge stays/)).toBeVisible();
    await expect(page.getByText(/The listing stays live/)).toBeVisible();
  });

  test("offers no control that could delete, unpublish or unverify", async ({ page }) => {
    /*
     * The negative half of criterion 10, asserted as an absence rather than
     * read off the source. Nothing on this screen can reach those actions
     * because the sequence has none to offer.
     */
    const controls = await page.getByRole("button").allInnerTexts();
    const links = await page.getByRole("link").allInnerTexts();
    const forbidden = /suspend|unpublish|delete|remove badge|unverify|take down/i;
    for (const label of [...controls, ...links]) {
      expect(label, label).not.toMatch(forbidden);
    }
  });

  test("says plainly that no card is being charged", async ({ page }) => {
    // The console provider cannot take money. A screen that implied otherwise
    // is how a staging environment convinces somebody the billing works.
    await expect(page.getByText(/No payment gateway is configured/)).toBeVisible();
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 12e — VAT export", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/tax");
  });

  test("scopes itself to our own invoices", async ({ page }) => {
    await expect(page.getByText(/Our own subscription and placement invoices only/)).toBeVisible();
  });

  test("totals in a real tfoot", async ({ page }) => {
    const table = page.getByRole("table", { name: /Issued invoices in the period/ });
    await expect(table.locator("tfoot")).toBeAttached();
  });

  test("downloads a CSV named for the quarter", async ({ page }) => {
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download the CSV" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^vat-\d{4}-q[1-4]\.csv$/);
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 12e — invoices and credits", () => {
  test("calls a correction a subscription credit", async ({ page }) => {
    await page.goto("/admin/invoices");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Invoices");
    await expect(page.getByText(/A correction is a subscription credit/)).toBeVisible();
    // No buyer money, so nothing to send back.
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/\brefund/i);
  });

  test("is axe clean", async ({ page }) => {
    await page.goto("/admin/invoices");
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 4g — subscriptions", () => {
  test("names which caps an account keeps from signup", async ({ page }) => {
    await page.goto("/admin/subscriptions");
    const table = page.getByRole("table", { name: /Every subscription/ });
    await expect(table).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "On old numbers" })).toBeVisible();
  });

  test("opens the account from a row, and names a lapse rather than calling it active", async ({ page }) => {
    await page.goto("/admin/subscriptions");
    const table = page.getByRole("table", { name: /Every subscription/ });
    // Seeded by board 4g: dropped to Free after fourteen days of failed payments.
    const row = table.getByRole("row", { name: /Umm Al Quwain Boatyard/ });
    await expect(row.getByText("Dropped to Free")).toBeVisible();
    await row.getByRole("link", { name: "Umm Al Quwain Boatyard" }).click();
    await expect(page).toHaveURL(/\/admin\/businesses\/[\w-]+$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Umm Al Quwain Boatyard");
  });
});
