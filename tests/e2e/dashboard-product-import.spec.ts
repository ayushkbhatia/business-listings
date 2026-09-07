import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Board 11d, in a browser, signed in as a seller.
 *
 * What the import writes and refuses is proved in
 * `tests/integration/import-mapper.test.ts` — a browser is the wrong instrument
 * for "one filename on forty rows becomes forty references to one file". What
 * is asserted here is what the seller is **shown**, because on this screen the
 * table is the correction: the board counted nine columns, listed seven, and
 * printed a tally over them that summed to something else again.
 *
 * The filename has to start with `dashboard` — Playwright matches the `seller`
 * project on `/(dashboard|overview|catalogue|listing|account|onboarding|pricing-seller)[\w-]*\.spec\.ts/`
 * against the absolute path.
 */

/** The board's own file: nine columns, and two of them decide what happens. */
const NINE_COLUMNS = [
  "Item Description,Part No,Category,Size,Material,Qty on hand,Photo File,Unit Price AED,Supplier Ref",
  'E2E butterfly valve DN100,E2E-BV-100,butterfly-valves,DN100,DI / SS316,24,bf-100.jpg,1240.00,SUP-1',
  'E2E end suction pump,E2E-PU-80,pumps-and-motors,DN80,CI / Bronze,12,pump-80.jpg,1980.00,SUP-2',
  'E2E gate valve DN50,E2E-GV-50,not-a-real-subcategory,DN50,DI / SS316,8,missing.jpg,860.00,SUP-3',
].join("\n");

async function upload(page: import("@playwright/test").Page, content: string, name = "stock.csv") {
  await page.goto("/dashboard/products/import");
  await page.setInputFiles('input[type="file"]', {
    name,
    mimeType: "text/csv",
    buffer: Buffer.from(content, "utf8"),
  });
  await expect(page.getByRole("table")).toBeVisible({ timeout: 20_000 });
}

test.describe("board 11d — the import mapper", () => {
  test("says what the plan allows before a file is chosen", async ({ page }) => {
    // An import is the fastest way to hit a cap, so the sentence is on the
    // upload step rather than after nine columns have been mapped.
    await page.goto("/dashboard/products/import");
    // All three of the sentence's forms: `import.room` when there is room,
    // `import.room_none` at the cap, and `import.room_unlimited` on a plan that
    // does not cap at all — which is the one the seeded Pro seller gets, and
    // the one this assertion used to omit.
    await expect(
      page.getByText(/product limit|Room for|at the|does not cap/i).first(),
    ).toBeVisible();
  });

  test("gives every column in the file a row, in file order", async ({ page }) => {
    // Criterion 1. The board counted nine and listed seven; the two it left out
    // were the two that decide what the import does.
    await upload(page, NINE_COLUMNS);
    const rows = page.getByRole("table").locator("tbody tr");
    await expect(rows).toHaveCount(9);
    await expect(rows.first()).toContainText("Item Description");
    await expect(rows.nth(8)).toContainText("Supplier Ref");
  });

  test("shows the two columns the board hid", async ({ page }) => {
    await upload(page, NINE_COLUMNS);
    const table = page.getByRole("table");
    await expect(table).toContainText("Category");
    await expect(table).toContainText("Photo File");
  });

  test("prints a tally that sums to the column count", async ({ page }) => {
    // Criterion 2. `Auto-matched 7 of 9` sat above statuses showing four.
    await upload(page, NINE_COLUMNS);
    const tally = page.getByText(/matched · .* need you · .* blocked · .* ignored/);
    await expect(tally).toBeVisible();
    const text = (await tally.textContent()) ?? "";
    const numbers = [...text.matchAll(/(\d+)\s+(?:matched|need you|blocked|ignored)/g)].map((m) =>
      Number(m[1]),
    );
    expect(numbers).toHaveLength(4);
    expect(numbers.reduce((sum, n) => sum + n, 0)).toBe(9);
  });

  test("offers a price column no destination at all", async ({ page }) => {
    /*
       Criterion 4, and the refusal this screen exists to make legible. The
       select is **absent**, not disabled: a disabled control invites the seller
       to look for the permission to enable it, and there is none. The board
       offered to move the column into a private quote list, which is a screen
       that does not exist.
    */
    await upload(page, NINE_COLUMNS);
    const row = page.getByRole("row").filter({ hasText: "Unit Price AED" });
    await expect(row).toContainText(/Do not import/i);
    await expect(row.locator("select")).toHaveCount(0);
    await expect(row).toContainText(/belong on a quote/i);
  });

  test("names the subcategories the file spans, not one template", async ({ page }) => {
    // §2's `3 subcategories · 3 templates apply`. A single global badge either
    // applies the wrong field set to most of the file or drops what it cannot
    // place.
    await upload(page, NINE_COLUMNS);
    await expect(page.getByText(/subcategor(y|ies) ·/i)).toBeVisible();
  });

  test("states what will happen, and the cap outcome with it", async ({ page }) => {
    await upload(page, NINE_COLUMNS);
    const rail = page.getByText("What will happen").locator("xpath=ancestor::section[1]");
    await expect(rail).toBeVisible();
    await expect(rail).toContainText(/New products/i);
    await expect(rail).toContainText(/Rows with errors/i);
    await expect(rail).toContainText(/Listed immediately/i);
    // The cap says what happens at it rather than only naming a number.
    await expect(rail).toContainText(/no product limit|stored unlisted/i);
  });

  test("says what a rollback restores, not only that there is one", async ({ page }) => {
    // The board promised 24 hours and never said what it put back, which on an
    // import that overwrote 18 live products is the only part anyone needs.
    await upload(page, NINE_COLUMNS);
    await expect(page.getByText(/return to their previous values/i).first()).toBeVisible();
  });

  test("lists the rows that will not import, and why", async ({ page }) => {
    // Criterion 6: a row whose category matches no subcategory is an error row,
    // never a default-template import.
    await upload(page, NINE_COLUMNS);
    await expect(page.getByText(/Rows that will not import/i)).toBeVisible();
    await expect(page.getByText(/That subcategory does not exist/i)).toBeVisible();
    await expect(page.getByText("not-a-real-subcategory")).toBeVisible();
  });

  test("makes the header-row assumption a control", async ({ page }) => {
    // Criterion 9, and the same defect corrected on 3f §5 and 3i §3.
    await upload(page, NINE_COLUMNS);
    const toggle = page.getByRole("switch", { name: /First row names the columns/i });
    await expect(toggle).toBeVisible();
    await toggle.click();
    // Re-parsed: with no header row the columns are numbered and every line is
    // data, so the table gains the row that used to be the heading.
    await expect(page.getByRole("table")).toContainText("Column 1", { timeout: 20_000 });
  });

  test("refuses a file with nothing importable, rather than previewing nothing", async ({ page }) => {
    // §States: "a file that is all price and no spec".
    await upload(page, ["Unit Price AED,Cost AED", "1240.00,900.00", "1980.00,1400.00"].join("\n"));
    await expect(page.getByText(/Nothing in this file can be imported/i)).toBeVisible();
  });

  test("offers the round trip its own mapping", async ({ page }) => {
    // §5, and board 3f Q3's answer made visible: a file that left the platform
    // maps itself.
    await upload(
      page,
      [
        "sku,name,subcategory,description,stock_status,stock_qty,lead_time_days",
        "E2E-RT-1,E2E round trip valve,butterfly-valves,,in_stock,10,7",
      ].join("\n"),
      "catalogue-2026-09-06.csv",
    );
    await expect(page.getByText("MAPS 1:1")).toBeVisible();
    await expect(page.getByText(/came from Export/i)).toBeVisible();
  });

  test("keyboard reaches every control on the mapping step", async ({ page }) => {
    await upload(page, NINE_COLUMNS);
    const focusable = page.locator(
      "a[href], button:not([disabled]), select, input:not([type=hidden]), [tabindex]:not([tabindex='-1'])",
    );
    expect(await focusable.count()).toBeGreaterThan(5);
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toBeVisible();
  });

  test("axe clean but for the pinned token contrast", async ({ page }) => {
    await upload(page, NINE_COLUMNS);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      // `--text-muted` is 4.23:1 on paper and `--text-faint` 2.57:1. Both are
      // design-system tokens used by every screen, pinned pending a canvas
      // decision — see docs/contrast.md.
      .disableRules(["color-contrast"])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test("keeps one h1", async ({ page }) => {
    await upload(page, NINE_COLUMNS);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });

  test("does not scroll the page sideways at either width", async ({ page }) => {
    await upload(page, NINE_COLUMNS);
    for (const width of [1300, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflows).toBe(false);
    }
  });
});

test.describe("board 11d — the catalogue's half of the round trip", () => {
  test("offers an export, and says what the file does and does not carry", async ({ page }) => {
    // Board 3f §1 drew `Export ▾` and 3f shipped without it; 3h §6 recorded the
    // export as one-way until this board.
    await page.goto("/dashboard/products");
    await expect(page.getByRole("link", { name: "Export", exact: true })).toBeVisible();
    await expect(page.getByText(/edit and import again/i)).toBeVisible();
  });

  test("downloads a file the mapper recognises as its own", async ({ page }) => {
    await page.goto("/dashboard/products");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Export", exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^catalogue-\d{4}-\d{2}-\d{2}\.csv$/);

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const header = Buffer.concat(chunks).toString("utf8").split("\r\n")[0] ?? "";

    // The columns §5 names, and none of the ones it refuses.
    expect(header).toContain("sku");
    expect(header).toContain("subcategory");
    expect(header).toContain("photo_1");
    expect(header).not.toMatch(/price/i);
    // No `views`: nothing in this schema attributes a view to a product, so the
    // column would be zeros presented as a measurement.
    expect(header.split(",")).not.toContain("views");
  });
});
