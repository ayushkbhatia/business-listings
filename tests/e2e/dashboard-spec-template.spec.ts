import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Board 3h — the spec template builder, in a browser.
 *
 * Named `dashboard-spec-template` so the seller project owns it: Playwright
 * matches the filename regex against the absolute path, and `templates.spec.ts`
 * would run signed out, in chromium and mobile, and fail on a 404.
 *
 * What is asserted here rather than in integration: that the screen states the
 * ownership split a seller acts on, that the fields table fits its column, and
 * that the one figure the board asked for which has nothing behind it is not on
 * screen. The rename guarantee, the blast radii and the revisions are services,
 * and tests/integration/template.test.ts owns them against real rows.
 */

const TEMPLATE = "/dashboard/templates";

test.describe("board 3h — the fields table", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEMPLATE);
  });

  test("keeps the h1 the seller shell and the nav depend on", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("is a real table with the five columns the board names", async ({ page }) => {
    const table = page.getByRole("table", { name: /fields on your products/i });
    await expect(table).toBeVisible();
    for (const column of ["Field label", "Type & unit", "Required", "Filter", "Filled"]) {
      await expect(table.getByRole("columnheader", { name: column })).toBeVisible();
    }
  });

  test("fits its column with the longest label in the fixture", async ({ page }) => {
    /*
       Criterion 13, and the board's own defect: four panes at 236 nav + 200
       rail + 300 settings left 626px of table against 672px of columns, so
       `FILLED` — the number the whole screen turns on — was clipped off the
       right edge. Measured rather than eyeballed.
    */
    await page.setViewportSize({ width: 1440, height: 900 });
    const overflow = await page.evaluate(() => {
      const table = document.querySelector("table");
      if (!table) return null;
      const box = table.closest('[class*="overflow-x-auto"]');
      return box ? table.scrollWidth - box.clientWidth : null;
    });
    expect(overflow).not.toBeNull();
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("renders the filter column as state, never as a control", async ({ page }) => {
    /*
       Criterion 4. A per-seller facet returns a subset of the sellers who hold
       the data while its count claims otherwise, and hands a seller a switch
       whose only effect is making them harder to find.
    */
    const table = page.getByRole("table", { name: /fields on your products/i });
    const filterCells = table.getByText(/^(Platform|Not a facet|Yours only)$/);
    await expect(filterCells.first()).toBeVisible();

    // No checkbox, radio or switch anywhere in the filter column.
    const rows = table.getByRole("row");
    const count = await rows.count();
    for (let i = 1; i < Math.min(count, 4); i += 1) {
      const cells = rows.nth(i).getByRole("cell");
      await expect(cells.nth(3).getByRole("checkbox")).toHaveCount(0);
      await expect(cells.nth(3).getByRole("switch")).toHaveCount(0);
    }
  });

  test("states every count against a denominator", async ({ page }) => {
    // Criterion 11: every count is a query. All eight `FILLED` figures on the
    // board were hardcoded, and a bare numerator is a figure with no meaning.
    await expect(page.getByText(/^\d+ \/ \d+$/).first()).toBeVisible();
  });

  test("offers a keyboard route to reorder, not a drag handle alone", async ({ page }) => {
    // The order is the thing this table exists to set, and a pointer-only
    // control is one a keyboard cannot reach.
    await expect(page.getByRole("button", { name: /^Move .+ down$/ }).first()).toBeVisible();
  });
});

test.describe("board 3h — what is yours and what is not", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEMPLATE);
  });

  test("shows the platform mapping locked beside the label", async ({ page }) => {
    /*
       Criterion 2, and the reason a rename is safe rather than warned about:
       the label is free text and the platform field id is immutable. A seller
       who cannot see the pairing has no reason to believe it.
    */
    await expect(page.getByText("Mapped to")).toBeVisible();
    await expect(page.getByText("LOCKED", { exact: false }).first()).toBeVisible();
    await expect(page.getByText(/Comparison follows the mapping below, not the label/)).toBeVisible();
  });

  test("says why the filter column is not the seller's", async ({ page }) => {
    // §7: the card is load-bearing. The column is read-only and a seller who
    // does not know why will read it as broken.
    await expect(page.getByText(/set once for everyone in the category/)).toBeVisible();
  });

  test("states the asymmetry a new requirement creates", async ({ page }) => {
    /*
       §5. Turning on a requirement never delists a live product — it flags the
       gap and blocks the next save — and the screen has to say so, because the
       alternative a seller assumes is that products come down.
    */
    const body = (await page.textContent("main")) ?? "";
    if (/missing a required field/.test(body)) {
      await expect(page.getByText(/stay live and stay in search/)).toBeVisible();
    }
  });

  test("makes no claim it cannot measure", async ({ page }) => {
    /*
       The board's nudge read "buyers filtered on Cv in 41 valve searches in
       Dubai last month". `SearchQueryLog` records the query, the category and
       the emirate — not which facets were applied — so there is no such number.
       Same class as the claims cut from boards 3j, 3k and 7e.
    */
    const body = (await page.textContent("main")) ?? "";
    expect(body).not.toMatch(/buyers filtered on/i);
    expect(body).not.toMatch(/\d+ (valve )?searches in/i);
  });
});

test.describe("board 3h — nothing applies without review", () => {
  test("offers no direct save to live products", async ({ page }) => {
    /*
       §8: the board's `Save & apply to 318` was one click on a retroactive edit
       to 318 live products. There is no control that writes the applied overlay
       — every edit stages a draft.
    */
    await page.goto(TEMPLATE);
    await expect(page.getByRole("button", { name: /apply to \d+/i })).toHaveCount(0);
  });

  test("has no pending panel when nothing is pending", async ({ page }) => {
    // §"States": with none pending the primary action is absent rather than
    // disabled. A disabled `Review 0 changes` reads as broken.
    await page.goto(TEMPLATE);
    const pending = page.getByRole("heading", { name: "Pending changes" });
    if ((await pending.count()) === 0) {
      await expect(page.getByRole("button", { name: "Apply these changes" })).toHaveCount(0);
    }
  });

  test("reaches revision history from the header", async ({ page }) => {
    await page.goto(TEMPLATE);
    await page.getByRole("link", { name: "Revision history" }).click();
    await expect(page.getByRole("heading", { level: 1, name: /Revision history/ })).toBeVisible();
  });
});

test.describe("board 3h — accessibility", () => {
  test("passes axe", async ({ page }) => {
    await page.goto(TEMPLATE);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      // Token-level and pinned. See the note in dashboard-leads-inbox.spec.ts.
      .disableRules(["color-contrast"])
      .analyze();
    const summary = results.violations.map((v) => `${v.id}: ${v.help}`);
    expect(summary, summary.join("\n")).toEqual([]);
  });

  test("passes axe on revision history", async ({ page }) => {
    await page.goto(TEMPLATE);
    await page.getByRole("link", { name: "Revision history" }).click();
    /*
       Wait for the new document, as the sibling assertion above does. Without
       it axe races the navigation and reports `document-title` against the page
       it caught mid-flight — the route exports a title, so the violation was
       the timing, not the page. It loses that race only on CI, which is why a
       local run can call this green and the shard still go red.
    */
    await expect(page.getByRole("heading", { level: 1, name: /Revision history/ })).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .disableRules(["color-contrast"])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });

  test("keeps one h1", async ({ page }) => {
    await page.goto(TEMPLATE);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });

  test("names every reorder control with the field it moves", async ({ page }) => {
    // A table of seven rows otherwise offers fourteen buttons called "up" and
    // "down", which a screen-reader user cannot tell apart.
    await page.goto(TEMPLATE);
    await expect(page.getByRole("button", { name: /^Move .+ up$/ }).first()).toBeVisible();
  });
});
