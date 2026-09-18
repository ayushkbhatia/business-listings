import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Board 4h — one queue for six kinds of complaint.
 *
 * ## What this file is careful about
 *
 * It never decides a seeded row. Other staff specs work down this queue and
 * board 11c's own spec decides the seeded dispute, so a test here that took
 * "the first row" would be eating another file's fixture. Where a decision has
 * to be exercised, the report is **filed by this test** through the public form
 * and decided by this test, start to finish.
 */

test.describe("the queue", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/admin/reports");
  });

  test("counts one taxonomy in the header and the chips (B3)", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Reports & flags");

    /*
       `11c`'s acceptance criterion 5, which is the house rule this board was
       corrected for: every count in the header reconciles with the list
       beneath it. The header's open figure is the sum of the type chips.
    */
    const header = await page
      .getByText(/\d+ open · \d+ types? · \d+% auto-detected/)
      .innerText();
    const open = Number(/(\d+) open/.exec(header)![1]);

    const chips = page.getByRole("navigation", { name: "Filter by type" });
    const all = await chips.getByRole("link", { name: /^All \d+$/ }).innerText();
    expect(Number(/(\d+)/.exec(all)![1])).toBe(open);

    const perType = await chips.getByRole("link").allInnerTexts();
    const counted = perType
      // Drop "All" and the escalated chip: one is the total and the other is a
      // state that cuts across every type.
      .filter((text) => !/^All /.test(text) && !/^Escalated /.test(text))
      .map((text) => Number(/(\d+)$/.exec(text)![1]))
      .reduce((sum, n) => sum + n, 0);
    expect(counted).toBe(open);
  });

  test("shows a real table, with the evidence line under the claim", async ({ page }) => {
    /*
       Non-negotiable 4: real markup, not the canvas's div grid. Named, because
       the outcomes rail is a real table too — a page with two of them is two
       things counted rather than one drawn twice.
    */
    await expect(page.getByRole("table", { name: /Complaints waiting for a decision/ })).toBeVisible();
    for (const head of ["Type", "Reported", "Reporter", "Owner", "Waiting", "Next step"]) {
      await expect(page.getByRole("columnheader", { name: head })).toBeVisible();
    }
    /*
       The seeded shared-number sweep writes one, and it is what a moderator
       reads before the complaint under it. Matched case-insensitively: the
       uppercase is `text-transform`, and a locator reads the DOM rather than
       what the screen shows.
    */
    await expect(page.getByText(/same number on \d+ listings/i).first()).toBeVisible();
  });

  test("carries the service level beside the age, never the colour alone (B4)", async ({ page }) => {
    const ages = page.getByText(/^(Over|Due within|Inside) /);
    expect(await ages.count()).toBeGreaterThan(0);
  });

  test("filters by type, by owner and by what is escalated", async ({ page }) => {
    await page.getByRole("link", { name: /^Off-platform \d+$/ }).click();
    await expect(page).toHaveURL(/type=off_platform_payment/);
    const rows = page.getByRole("row");
    // The header row plus at least the seeded escalated one.
    expect(await rows.count()).toBeGreaterThan(1);

    await page.goto("/admin/reports?escalated=1");
    await expect(page.getByText("Escalated").first()).toBeVisible();

    await page.goto("/admin/reports");
    await page.getByRole("link", { name: "Assigned to me" }).click();
    await expect(page).toHaveURL(/mine=1/);
  });

  test("offers no suspension and no archive (B2, Q4)", async ({ page }) => {
    /*
       `12c` refused to put a second route to a suspension on this board, in
       writing. The row escalates; the suspension is taken on `/admin/businesses`
       where it has its reason codes and its appeal path.
    */
    await expect(page.getByRole("button", { name: /suspend/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /archive/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /archive/i })).toHaveCount(0);
  });

  test("states the outcome shares over a window, from decisions rather than a target", async ({ page }) => {
    const rail = page.getByRole("complementary", { name: /Outcomes and the rules behind them/ });
    await expect(rail.getByText(/Outcomes · 90 days/)).toBeVisible();
    await expect(rail.getByText(/Seller corrected the listing/)).toBeVisible();
    await expect(rail.getByText(/Median time to decide/)).toBeVisible();
  });

  test("lists exactly the four grounds the dispute flow accepts (B1)", async ({ page }) => {
    const rail = page.getByRole("complementary", { name: /Outcomes and the rules behind them/ });
    for (const ground of [
      "No traceable enquiry",
      "Abuse",
      "Private information",
      "Provably false factual claim",
    ]) {
      await expect(rail.getByText(ground, { exact: true })).toBeVisible();
    }
    // 11c names the exclusion deliberately, so the rail carries it.
    await expect(rail.getByText(/“It is unfair” is not a ground/)).toBeVisible();
  });

  test("has no axe violations", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("one report, filed and decided by this test", () => {
  test("files from the listing, collapses with nothing, and closes with a reason", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });

    // A listing this file is the only writer on: reported, then decided.
    await page.goto("/report/al-areen-industrial-supplies-llc");
    await page.getByRole("radio", { name: /Not this trade/ }).check();
    /*
       Board 13c. The form offers only the parts this listing shows, so the
       sub-choice appears where the listing has a description as well as a
       trade, and is filled in for the reporter where it does not.
    */
    const trade = page.getByRole("radio", { name: "Trade or category" });
    if (await trade.count()) await trade.check();
    const said = "Their own page says they do scaffolding hire, and this is filed under valves.";
    await page.getByLabel(/Anything that helps us check/).fill(said);
    await page.getByRole("button", { name: "Send report" }).click();
    /*
       Wait for the server action to answer before reading which way it went.
       `count()` does not auto-wait, so branching on it straight after the click
       reads the form that is still on screen and calls a slow round trip a
       refusal.
    */
    const sent = page.getByText("Report sent");
    /*
       By its words, not by `role="alert"`: the shell carries an empty live
       region for announcements, and matching the role alone matched that on
       every run — so the test skipped itself while the form was still working.
    */
    const refused = page.getByText(/already been reported|more reports than we take|more reports in the last hour/);
    await expect(sent.or(refused).first()).toBeVisible();
    if ((await refused.count()) > 0) {
      /*
         One open report per person, business, kind and field — the form's own
         guard. CI reseeds per job so this never fires there; locally it means a
         previous run of this spec filed and did not get as far as deciding.
         Reseed rather than reaching into the table.
      */
      test.skip(true, "This spec's report is still open from a previous local run. Reseed.");
    }
    await expect(sent).toBeVisible();

    await page.goto("/admin/reports?type=wrong_trade");
    const row = page.getByRole("row").filter({ hasText: said });
    await expect(row).toHaveCount(1);
    await row.getByRole("link", { name: "Investigate" }).click();

    await expect(page.getByRole("heading", { level: 1 })).toContainText("Report about");
    const corrected = page.getByRole("button", { name: "Seller corrected it" });
    // Nothing is decided without a written reason.
    await expect(corrected).toBeDisabled();
    await page
      .getByLabel("Reason")
      .first()
      .fill("Licence activities cover scaffolding only. Moved to the right subcategory.");
    await corrected.click();

    await expect(page.getByText(/Decided as Seller corrected it/)).toBeVisible();
    await expect(page.getByText("Reason given")).toBeVisible();
  });
});

test.describe("the detection thresholds", () => {
  test("are configurable outside the queue, and refuse a value out of range (B11)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/admin/reports");
    await page.getByRole("link", { name: "Detection thresholds" }).click();

    await expect(page.getByRole("heading", { level: 1 })).toContainText("Detection thresholds");
    // No confidence control: the platform has no scoring detector.
    await expect(page.getByText(/confidence/i)).toHaveCount(0);
    await expect(page.getByText(/turns off fraud detection is one nobody notices/)).toBeVisible();

    await page.getByLabel("Report at this many listings").fill("1");
    await page.getByLabel("Reason").fill("Trying a value the bounds refuse.");
    await page.getByRole("button", { name: "Save the thresholds" }).click();
    await expect(page.getByText(/whole number between 2 and 20/)).toBeVisible();
  });
});
