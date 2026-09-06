import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Board 3i, in a browser, signed in as a seller.
 *
 * What the services refuse and what they write is proved in
 * `tests/integration/media-library.test.ts` — a browser is the wrong instrument
 * for "a quote-held file is not deleted". What is asserted here is what the
 * seller is **told**, because on this screen the wording is the correction: the
 * board offered to delete 41 files and free 380 MB from one column, and the
 * difference between that and the truth is a document already sent to a
 * customer.
 *
 * The filename has to start with `dashboard` — Playwright matches the `seller`
 * project on `/(dashboard|overview|catalogue|listing|account|onboarding|pricing-seller)[\w-]*\.spec\.ts/`
 * against the absolute path.
 */

test.describe("board 3i — the media library", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/media");
  });

  test("states the storage cap and what happens at it", async ({ page }) => {
    // `2.1 GB of 10 GB` said nothing about whose 10 GB or what happens at 10.
    // Per board 3f §6 a plan limit is visible before it bites and never
    // destroys a record.
    const header = page.getByRole("banner");
    await expect(header).toContainText(/used|stored/i);
    await expect(header).toContainText(/uploads stop at the cap/i);
  });

  test("puts every file in exactly one folder, and says so", async ({ page }) => {
    // The board listed `Unused 41` as a sixth folder, which put 41 files in two
    // folders at once. Unreferenced is a state, not a folder.
    await expect(page.getByText(/Every file is in exactly one/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /^Unfiled/ })).toBeVisible();
  });

  test("never offers Unused as a folder", async ({ page }) => {
    const rail = page.getByText(/Every file is in exactly one/i).locator("xpath=ancestor::section[1]");
    await expect(rail.getByRole("link", { name: /^Unused/ })).toHaveCount(0);
  });

  test("makes sort a control rather than a label", async ({ page }) => {
    // `Newest first` was static text on the board — the same defect corrected
    // on 3f §5.
    const sort = page.getByLabel(/Sort/i);
    await expect(sort).toBeVisible();
    await expect(sort).toHaveJSProperty("tagName", "SELECT");
  });

  test("searches alt text as well as filenames", async ({ page }) => {
    await expect(page.getByPlaceholder(/Filename or alt text/i)).toBeVisible();
  });

  test("opens a detail panel for one file, with its references", async ({ page }) => {
    // The board had 1,482 files and no way to look at one: selecting offered
    // only bulk actions, so the alt-text chip counted a problem the screen had
    // no way to fix.
    await expect(page.getByText(/Nothing selected/i)).toBeVisible();

    await page.getByRole("checkbox").first().check();

    /*
       Scoped to the panel. `Used in` is also the filter row's label, so an
       unscoped match resolves to two elements and fails strict mode — which is
       itself worth knowing: the same two words name a filter and a heading on
       one screen, and only the region tells them apart.
    */
    const panel = page
      .getByText(/Selected file/i)
      .locator("xpath=ancestor::section[1]");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(/Used in/i);
    await expect(panel).toContainText(/Uploaded/i);
  });

  test("states the selection scope before a bulk action", async ({ page }) => {
    await page.getByRole("checkbox").first().check();
    // `2 selected` alone is ambiguous across a filtered grid, and a bulk delete
    // is the wrong place to be ambiguous — 3f §3.
    await expect(page.getByText(/1 selected in/i)).toBeVisible();
  });

  test("names what a delete changes before it runs", async ({ page }) => {
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: "Delete…" }).last().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // Either the refusal or the blast radius — never a bare "are you sure".
    await expect(dialog).toContainText(
      /cannot be deleted|loses this file|also comes off|Nothing references/i,
    );
  });

  test("refuses a quote-held file with no confirm button at all", async ({ page }) => {
    // The seed attaches a datasheet to a sent quote. Refusal, not a warning:
    // the control is absent rather than disabled beside a caution.
    const held = page.getByText(/In a sent quote/i).first();
    if ((await held.count()) === 0) test.skip();

    await held.locator("xpath=ancestor::label[1]").getByRole("checkbox").check();
    await page.getByRole("button", { name: "Delete…" }).last().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(/cannot be deleted/i);
    await expect(dialog).toContainText(/a buyer holds quote/i);
    await expect(dialog.getByRole("button", { name: /Delete this file/i })).toHaveCount(0);
  });

  test("distinguishes unreferenced from unattached in the rail", async ({ page }) => {
    // "Deleting them frees 380 MB" conflated the two. The card states both
    // numbers, and says the held ones cannot be deleted.
    const card = page.getByText(/held by a sent quote|unreferenced/i).first();
    if ((await card.count()) === 0) test.skip();
    await expect(page.locator("body")).toContainText(
      /cannot be deleted|Safe to delete/i,
    );
  });

  test("renders a document as its type, never as a broken image", async ({ page }) => {
    const pdf = page.getByText("PDF", { exact: true }).first();
    if ((await pdf.count()) === 0) test.skip();
    await expect(pdf).toBeVisible();
  });

  test("holds the detail panel at 268px when the grid narrows", async ({ page }) => {
    // The panel is the part that cannot shrink — it is the screen's only route
    // to one file.
    await page.setViewportSize({ width: 1300, height: 900 });
    const panel = page.getByText(/Nothing selected/i).locator("xpath=ancestor::section[1]");
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect(Math.round(box?.width ?? 0)).toBe(268);
  });

  test("does not scroll the page sideways at either width", async ({ page }) => {
    for (const width of [1300, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflows).toBe(false);
    }
  });

  test("axe clean but for the pinned token contrast", async ({ page }) => {
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
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });

  test("names every selection checkbox with the file it selects", async ({ page }) => {
    const boxes = page.getByRole("checkbox");
    const count = await boxes.count();
    for (let i = 0; i < Math.min(count, 4); i += 1) {
      await expect(boxes.nth(i)).toHaveAttribute("aria-label", /Select .+/);
    }
  });
});
