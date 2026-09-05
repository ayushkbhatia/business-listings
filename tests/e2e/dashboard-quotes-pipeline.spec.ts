import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Board 3k — the quotes pipeline, in a browser.
 *
 * Named `dashboard-quotes-pipeline` so the seller project owns it: Playwright
 * matches the filename regex against the absolute path, and `quotes.spec.ts`
 * would run signed out, in chromium and mobile, and fail on a redirect.
 *
 * What is asserted here rather than in integration: the tab counts on screen
 * agreeing with the table under them, the two facts the extend dialog has to
 * state before a seller touches it, and the absence of the two claims §8 cut.
 * The count contract and the extend rules are queries and services, and
 * tests/integration/quotes-pipeline.test.ts owns them against real rows.
 */

test.describe("board 3k — the table", () => {
  test("keeps the h1 the seller shell and the nav depend on", async ({ page }) => {
    await page.goto("/dashboard/quotes");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Quotes sent");
  });

  test("adds up on screen: awaiting, won, lost and expired make all", async ({ page }) => {
    /*
       §3's contract, read off the rendered tabs rather than from the service.
       `Expiring soon` is a filter over Awaiting and is deliberately excluded —
       a screen where the tabs do not sum is a screen a seller stops trusting,
       and board 3j shipped with exactly that.
    */
    await page.goto("/dashboard/quotes");

    async function count(name: RegExp): Promise<number> {
      const text = (await page.getByRole("link", { name }).first().textContent()) ?? "";
      return Number(text.replace(/\D/g, ""));
    }

    const all = await count(/^All/);
    const awaiting = await count(/^Awaiting decision/);
    const won = await count(/^Won/);
    const lost = await count(/^Lost/);
    const expired = await count(/^Expired/);

    expect(awaiting + won + lost + expired).toBe(all);
    expect(await count(/^Expiring soon/)).toBeLessThanOrEqual(awaiting);
  });

  test("counts the rows it is showing", async ({ page }) => {
    // "If a header, a note or a section title states a count, count the
    // elements." The footer says what is shown against what exists.
    await page.goto("/dashboard/quotes");
    const rows = await page.getByRole("row").filter({ hasText: /QT-/ }).count();
    const footer = (await page.getByText(/\d+ quotes?$|of \d+ shown/).first().textContent()) ?? "";
    expect(Number(footer.replace(/\D/g, "").slice(0, 3))).toBe(rows);
  });

  test("names the denominator beside the percentage it would otherwise imply", async ({
    page,
  }) => {
    /*
       §8.2: "A percentage needs a named denominator. Label the denominator in
       the strip or drop the figure." The board's `34% won` had none, so this
       reads "N of M marked won" — a reader can divide, and cannot be misled
       about what was divided by what.
    */
    await page.goto("/dashboard/quotes");
    await expect(page.getByText(/\d+ of \d+ marked won/)).toBeVisible();
    await expect(page.getByText("Outcomes as you marked them")).toBeVisible();
  });

  test("says who decided each outcome", async ({ page }) => {
    // §8.3, and the same distinction board 3j draws: "you marked this won" and
    // "the buyer accepted your quote" are different sentences.
    await page.goto("/dashboard/quotes?tab=won");
    const body = (await page.textContent("main")) ?? "";
    expect(body).toMatch(/You marked this won|The buyer accepted your quote/);
  });

  test("shows a first name and no more of the buyer", async ({ page }) => {
    // Rule 1 does not relax on a second screen.
    await page.goto("/dashboard/quotes");
    const body = (await page.textContent("main")) ?? "";
    expect(body).not.toContain("Al Hameli");
    expect(body).not.toContain("Al Nuaimi");
    expect(body).not.toMatch(/\+971|\b0\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/);
  });

  test("makes none of the two claims about other sellers that were cut", async ({ page }) => {
    /*
       §8.4: `speed beats price five times out of six` and `one follow-up each
       is worth about AED 60k of pipeline`. The second asserts a value we cannot
       know for a buyer we cannot follow past the quote.
    */
    await page.goto("/dashboard/quotes");
    const body = (await page.textContent("main")) ?? "";
    expect(body).not.toMatch(/times out of/i);
    expect(body).not.toMatch(/worth about/i);
    expect(body).not.toMatch(/\d+% won/);
  });

  test("carries no price input anywhere on the screen", async ({ page }) => {
    /*
       §2: "There is no price input on this screen." `Revise` and `Re-quote`
       both open board 3j's composer, and this board never becomes a second
       place where money is typed.
    */
    await page.goto("/dashboard/quotes");
    await expect(page.getByLabel(/unit price/i)).toHaveCount(0);
  });
});

test.describe("board 3k — extending a window", () => {
  test("states both facts before the seller commits to anything", async ({ page }) => {
    /*
       §5: extending moves the date the buyer already holds, and sends them
       nothing. A seller who assumes it messages will not send the follow-up
       that would have.
    */
    await page.goto("/dashboard/quotes?tab=awaiting");
    await page.getByRole("button", { name: /^Extend / }).first().click();

    /*
       Scoped to the dialog: the expiring card carries the same sentence in its
       footnote, deliberately, because §7 wants a seller to meet the fact before
       they reach for the action as well as inside it.
    */
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/moves the date on the quote the buyer already holds/)).toBeVisible();
    await expect(dialog.getByText(/It does not message them/)).toBeVisible();
    await expect(dialog.getByText(/sixty days from when you sent it/)).toBeVisible();
  });

  test("offers presets and a picker, and no way to type a price", async ({ page }) => {
    await page.goto("/dashboard/quotes?tab=awaiting");
    await page.getByRole("button", { name: /^Extend / }).first().click();

    await expect(page.getByRole("button", { name: "Add 7 days" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add 14 days" })).toBeVisible();
    await expect(page.getByLabel("New expiry date")).toBeVisible();
    await expect(page.getByLabel(/unit price/i)).toHaveCount(0);
  });

  test("is not offered on a row whose window has closed", async ({ page }) => {
    // §5: "Expired quotes cannot be extended… do not soften it." The row offers
    // Re-quote instead, which opens the composer under a new reference.
    await page.goto("/dashboard/quotes?tab=expired");
    const rows = await page.getByRole("row").filter({ hasText: /QT-/ }).count();
    if (rows === 0) return;

    await expect(page.getByRole("button", { name: /^Extend / })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Re-quote / }).first()).toBeVisible();
  });

  test("is not offered on a decided row", async ({ page }) => {
    await page.goto("/dashboard/quotes?tab=won");
    const rows = await page.getByRole("row").filter({ hasText: /QT-/ }).count();
    if (rows === 0) return;
    await expect(page.getByRole("button", { name: /^Extend / })).toHaveCount(0);
  });

  test("opens straight from the deep link board 3a's queue points at", async ({ page }) => {
    await page.goto("/dashboard/quotes?tab=awaiting");
    const ref = (await page.getByRole("link", { name: /^Open quote QT-/ }).first().textContent()) ?? "";
    await page.goto(`/dashboard/quotes/${ref.trim()}/extend`);
    await expect(page.getByRole("button", { name: "Extend it" })).toBeVisible();
  });
});

test.describe("board 3k — the two cards", () => {
  test("reads speed as counts rather than as a rate", async ({ page }) => {
    /*
       §8.1: 23 resolved quotes split into buckets of 13 and 10 cannot carry a
       percentage — one deal landing moves it eight points, and the board's
       `61% won` was the same unsourced figure already cut from board 3j.
    */
    await page.goto("/dashboard/quotes");
    await expect(page.getByText("Your reply speed and your outcomes")).toBeVisible();
    await expect(page.getByText(/Counts, not rates/)).toBeVisible();

    const card = (await page.textContent("main")) ?? "";
    expect(card).not.toMatch(/\d+% won/);
  });

  test("offers no bulk follow-up, only named quotes", async ({ page }) => {
    /*
       §6: the board's `Follow up on all 6` bypasses board 11b's one-per-lead
       cap and spends a nudge on leads that may already have used theirs. The
       replacement is a card naming the quotes actually expiring.
    */
    await page.goto("/dashboard/quotes");
    await expect(page.getByRole("button", { name: /follow up on all/i })).toHaveCount(0);
    await expect(page.getByText(/each lead gets one follow-up/)).toBeVisible();
  });

  test("collapses to one line when nothing is expiring", async ({ page }) => {
    // §7: "It does not go looking for something else to say."
    await page.goto("/dashboard/quotes");
    const heading = (await page.textContent("main")) ?? "";
    expect(heading).toMatch(/quotes? expires? this week|Nothing expires in the next seven days/);
  });
});

test.describe("board 3k — the export", () => {
  test("downloads the current tab with the caveat on its first line", async ({ page }) => {
    await page.goto("/dashboard/quotes?tab=awaiting");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Export pipeline" }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/^quotes-awaiting-.*\.csv$/);

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const csv = Buffer.concat(chunks).toString("utf8");

    // §9: the caveat travels with the numbers, because a spreadsheet outlives
    // the screen it came from.
    expect(csv.split("\r\n")[0]).toContain("takes no payment and never sees the order");
    expect(csv).toContain("Times extended");
  });
});

test.describe("board 3k — accessibility", () => {
  test("passes axe on every tab", async ({ page }) => {
    for (const tab of ["all", "awaiting", "won", "expired"]) {
      await page.goto(`/dashboard/quotes?tab=${tab}`);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        // Token-level and pinned. See the note in dashboard-leads-inbox.spec.ts.
        .disableRules(["color-contrast"])
        .analyze();
      const summary = results.violations.map((v) => `${v.id}: ${v.help}`);
      expect(summary, `${tab}\n${summary.join("\n")}`).toEqual([]);
    }
  });

  test("passes axe with the extend dialog open", async ({ page }) => {
    await page.goto("/dashboard/quotes?tab=awaiting");
    await page.getByRole("button", { name: /^Extend / }).first().click();
    await expect(page.getByRole("button", { name: "Extend it" })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .disableRules(["color-contrast"])
      .analyze();
    const summary = results.violations.map((v) => `${v.id}: ${v.help}`);
    expect(summary, summary.join("\n")).toEqual([]);
  });

  test("names every row action with the quote it acts on", async ({ page }) => {
    /*
       A table of twenty-five rows otherwise offers twenty-five buttons called
       "Extend", which is twenty-five controls a screen-reader user cannot tell
       apart.
    */
    await page.goto("/dashboard/quotes?tab=awaiting");
    const rows = await page.getByRole("row").filter({ hasText: /QT-/ }).count();
    if (rows === 0) return;
    await expect(page.getByRole("button", { name: /^Extend QT-/ }).first()).toBeVisible();
  });

  test("is a real table with column headers", async ({ page }) => {
    await page.goto("/dashboard/quotes");
    const table = page.getByRole("table");
    await expect(table).toBeVisible();
    await expect(table.getByRole("columnheader")).toHaveCount(7);
  });
});
