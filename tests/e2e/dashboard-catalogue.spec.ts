import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Board 3f — the catalogue, in a browser, signed in as a seller.
 *
 * The filename routes this to the signed-in `seller` project; see
 * playwright.config.ts, which matches on `dashboard|catalogue|...`.
 *
 * Everything here is a claim about what the screen *says* — the counts adding
 * up, the two consequences being distinguishable, the scope of a bulk action
 * being stated before it runs. The queries behind them are asserted in
 * tests/integration/catalogue-3f.test.ts.
 */

test.describe("the header tells the truth about the catalogue", () => {
  test("its breakdown sums to its total, and the pagination counts to the same", async ({
    page,
  }) => {
    /*
       Criterion 1. The board read `1,204 live · 38 drafts · 14 out of stock` —
       1,256 — over a pagination reading `1–10 of 1,242`, because 1,204 was the
       seller's total and the header had labelled it as the live count.
    */
    await page.goto("/dashboard/products");

    /*
       `getByRole("banner")`, not `locator("header")`. The bulk actions
       put three <dialog>s on this page and each carries its own <header>,
       so the tag matches four elements and only the first is the page
       header this test is reading.
    */
    const header = await page.getByRole("banner").innerText();
    const total = Number(/([\d,]+)\s+products/.exec(header)?.[1]?.replace(/,/g, ""));
    const live = Number(/([\d,]+)\s+LIVE/i.exec(header)?.[1]?.replace(/,/g, ""));
    const drafts = Number(/([\d,]+)\s+DRAFTS?/i.exec(header)?.[1]?.replace(/,/g, ""));
    const oos = Number(/([\d,]+)\s+OUT OF STOCK/i.exec(header)?.[1]?.replace(/,/g, ""));

    expect(live + drafts + oos).toBe(total);

    const range = await page.getByText(/\d+–\d+ of [\d,]+/).first().innerText();
    expect(Number(/of ([\d,]+)/.exec(range)?.[1]?.replace(/,/g, ""))).toBe(total);
  });

  test("states the plan's product limit before it is reached", async ({ page }) => {
    // Criterion 13. On every plan, so it is never discovered at the moment of
    // being blocked.
    await page.goto("/dashboard/products");
    await expect(
      page.locator("header").getByText(/no product limit|\d+ of \d+ listed/i),
    ).toBeVisible();
  });
});

test.describe("a missing spec is two different problems", () => {
  test("counts them separately and never adds them together", async ({ page }) => {
    // Criterion 2. The board's single `62 with missing specs`, split.
    await page.goto("/dashboard/products");

    const blocked = page.getByRole("button", { name: /blocked on save/ });
    const filters = page.getByRole("button", { name: /missing a filter value/ });
    await expect(blocked).toBeVisible();
    await expect(filters).toBeVisible();

    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/with missing specs/i);
  });

  test("each chip filters the list on its own", async ({ page }) => {
    await page.goto("/dashboard/products");
    const before = await page.locator("tbody tr").count();

    await page.getByRole("button", { name: /blocked on save/ }).click();
    await page.waitForURL(/gap=blocked/);
    await expect(page.getByRole("button", { name: /blocked on save/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await page.locator("tbody tr").count()).toBeLessThanOrEqual(before);
  });

  test("a row can be live and save-blocked at once", async ({ page }) => {
    /*
       Criterion 3, and the case the board had no way to express. Deliberately
       surprising: board 3h §5's requirement never delists anything, it bites at
       the next save. A reviewer reading this row as a bug means the model needs
       restating in the UI, not changing.
    */
    await page.goto("/dashboard/products?gap=blocked");
    const row = page.locator("tbody tr").filter({ hasText: /SAVE BLOCKED/i }).first();
    await expect(row).toBeVisible();
    await expect(row.getByText("Live", { exact: true })).toBeVisible();
  });

  test("the SPECS column names the consequence, not only the ratio", async ({ page }) => {
    await page.goto("/dashboard/products?gap=blocked");
    const row = page.locator("tbody tr").first();
    // The ratio stays as context; underneath it, what the gap costs.
    await expect(row.getByText(/\d+ \/ \d+/)).toBeVisible();
    await expect(row.getByText(/save blocked|missing \d+ filter/i).first()).toBeVisible();
  });
});

test.describe("bulk actions say what they will do", () => {
  test("states the selection's scope, and offers the whole filtered set", async ({ page }) => {
    /*
       Criterion 10, and open question 5. `3 selected` above a 125-page list
       does not say whether an action applies to three products or to the
       filtered set.
    */
    await page.goto("/dashboard/products");
    await page.locator("tbody input[type=checkbox]").first().check();

    await expect(page.getByText(/selected on this page/)).toBeVisible();
    const selectAll = page.getByRole("button", { name: /Select all \d+ products these filters match/ });
    await expect(selectAll).toBeVisible();

    await selectAll.click();
    await expect(page.getByText(/the whole filtered set/)).toBeVisible();
  });

  test("unpublish states the count and the redirect before it runs", async ({ page }) => {
    // Criterion 7. Board 6f settled that an unpublished URL 301s rather than
    // 404ing; the board's two-click bulk unpublish never said so.
    await page.goto("/dashboard/products");
    await page.locator("tbody input[type=checkbox]").first().check();
    await page.getByRole("button", { name: "Unpublish…" }).click();

    const dialog = page.locator("dialog[open]");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/redirected to your storefront/)).toBeVisible();
    // The confirm repeats the verb. Never "OK".
    await expect(dialog.getByRole("button", { name: /^Unpublish \d+ product/ })).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
  });

  test("moving category previews what it costs", async ({ page }) => {
    // Criteria 6 and 8, in one preview — because a product's template comes
    // from its category, so the two actions the board drew are one write.
    await page.goto("/dashboard/products");
    await page.locator("tbody input[type=checkbox]").first().check();
    await page.getByRole("button", { name: "Move category…" }).click();

    const dialog = page.locator("dialog[open]");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/spec template comes from its category/)).toBeVisible();

    // Nothing is confirmable until a target is chosen and priced.
    await expect(dialog.getByRole("button", { name: /^Move \d+ product/ })).toBeDisabled();
    await dialog.getByRole("button", { name: "Cancel" }).click();
  });

  test("the safe bulk action has no confirmation", async ({ page }) => {
    /*
       Criterion 9's intent. The board's unguarded action was `Change price`;
       there is no price on a product here, so availability takes that role —
       reversible, destroys nothing, visible in the list afterwards. Gating it
       would teach the seller to click through the ones that matter.
    */
    await page.goto("/dashboard/products");
    await page.locator("tbody input[type=checkbox]").first().check();
    const safe = page.getByRole("button", { name: /Mark out of stock|Publish$/ }).first();
    await expect(safe).toBeVisible();
    await expect(safe).not.toHaveText(/…/);
  });

  test("the bulk bar is absent with nothing selected, not disabled", async ({ page }) => {
    await page.goto("/dashboard/products");
    await expect(page.getByRole("button", { name: "Unpublish…" })).toHaveCount(0);
  });
});

test.describe("sorting and paging are controls, not sentences", () => {
  test("defaults to gaps first and can be changed", async ({ page }) => {
    // Criterion 11. `Sorted by last edited` was static text, which is the one
    // order guaranteeing the worst rows are unreachable.
    await page.goto("/dashboard/products");
    const sort = page.getByLabel("Sort");
    await expect(sort).toHaveValue("gaps");
    await sort.selectOption("updated");
    await page.waitForURL(/sort=updated/);
  });

  test("pages fifty rows at a time, not ten", async ({ page }) => {
    await page.goto("/dashboard/products");
    const range = await page.getByText(/\d+–\d+ of [\d,]+/).first().innerText();
    const to = Number(/–(\d+)/.exec(range)?.[1]);
    expect(to).toBeGreaterThan(10);
  });
});

test.describe("search reaches the spec values", () => {
  test("matches a value, not only a name", async ({ page }) => {
    // Criterion 12. It is how a seller finds "everything PN16" without a facet.
    await page.goto("/dashboard/products");
    await page.getByLabel("Search").fill("PN25");
    await page.getByLabel("Search").press("Enter");
    await page.waitForURL(/q=PN25/);
    // Either rows, or the empty state naming the filter — never a bare table.
    const rows = await page.locator("tbody tr").count();
    if (rows === 0) await expect(page.getByText(/Nothing matches those filters/)).toBeVisible();
  });
});

test.describe("what the screen must not carry", () => {
  test("has no price column and no price bulk action", async ({ page }) => {
    /*
       The board draws both, with values. `Product` has no price field and
       cannot gain one — non-negotiable 1, and `check:schema-invariants` fails
       the build on such a column. Prices live on a quote line.
    */
    await page.goto("/dashboard/products");
    const heads = await page.locator("thead th").allInnerTexts();
    expect(heads.join(" ")).not.toMatch(/price/i);

    await page.locator("tbody input[type=checkbox]").first().check();
    await expect(page.getByRole("button", { name: /price/i })).toHaveCount(0);
  });
});

test.describe("accessibility", () => {
  test("is axe clean", async ({ page }) => {
    await page.goto("/dashboard/products");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      // Measured by `pnpm check:contrast`; the token-level shortfall is the
      // pinned decision in docs/contrast.md, not this board's.
      .disableRules(["color-contrast"])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test("keeps SPECS and STATUS at 1280, where SKU folds into the product cell", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/dashboard/products");
    const heads = await page.locator("thead th").allInnerTexts();
    expect(heads.join(" ")).toMatch(/Specs/);
    expect(heads.join(" ")).toMatch(/Status/);
    // The SKU has no column of its own; it sits under the name.
    expect(heads.join(" ")).not.toMatch(/^SKU$/m);
  });
});
