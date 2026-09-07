import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Boards 3f, 3g, 3h and 11d, signed in as a seller.
 *
 * The checkpoint for this step is here: a real supplier export, with two price
 * columns in it, blocked in the browser with the reason on screen. The service
 * refuses it too — tests/integration/import.test.ts — but a refusal the seller
 * cannot see is a refusal they will file a support ticket about.
 */

const FIXTURE = "tests/e2e/fixtures/supplier-export.csv";

/**
 * The row whose *own* column is named, not any row mentioning the name.
 *
 * Every unblocked row carries a select listing every spec field, so filtering
 * rows on "Body material" matches all eight — the seven other rows have it as
 * an option. The row header is the only place the column's own name appears.
 */
const columnRow = (page: import("@playwright/test").Page, header: string) =>
  page.locator("tbody tr").filter({ has: page.locator("th", { hasText: header }) });

test.describe("board 11d — the CSV mapper refuses a price", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/products/import");
    await page.setInputFiles("input[type=file]", FIXTURE);
    // `import.file.summary`, which board 11d rewrote from the older
    // `import.rows_found` ("5 rows, 10 columns."). Same two numbers, a middot
    // between them and no full stop.
    await expect(page.getByText("5 rows · 10 columns")).toBeVisible();
  });

  test("names both price columns and says why", async ({ page }) => {
    /*
       In the table, not in a panel above it.

       This asserted a `Not imported` region until board 11d removed it, for the
       reason the next test states: a banner at the top is a thing the seller
       scrolls past, and the refusal has to arrive where they are already
       reading. What has to hold is unchanged — both price columns are named,
       both are refused, and the reason is in the seller's terms rather than
       "invalid column" — so it is asserted where the answer now lives.
    */
    await expect(page.getByText("2 blocked")).toBeVisible();

    for (const header of ["Unit Price AED", "List Price"]) {
      const row = columnRow(page, header);
      await expect(row).toBeVisible();
      await expect(row).toContainText("they belong on a quote");
    }
  });

  test("puts the refusal in the same table as every other column", async ({ page }) => {
    // Not an error banner tucked at the top. The seller reads down the list of
    // their own columns and finds this one among them.
    const row = columnRow(page, "Unit Price AED");
    await expect(row).toContainText("Blocked");
    await expect(row).toContainText("Do not import");
  });

  test("offers no way to import it, not even a disabled one", async ({ page }) => {
    // A disabled select invites the seller to look for the permission to enable
    // it. There is none — this column cannot be imported under any setting.
    const blocked = columnRow(page, "Unit Price AED");
    await expect(blocked.locator("select")).toHaveCount(0);

    const allowed = columnRow(page, "Part No");
    await expect(allowed.locator("select")).toHaveCount(1);
  });

  test("does not refuse an engineering term that contains a money word", async ({ page }) => {
    // Kv is a flow coefficient. Refusing it would be refusing a spec.
    const row = columnRow(page, "K Value");
    await expect(row).not.toContainText("Blocked");
    await expect(row.locator("select")).toHaveCount(1);
  });

  test("marks the fields buyers filter on", async ({ page }) => {
    const row = columnRow(page, "Body material");
    await expect(row).toContainText("findable");
  });

  test("is axe clean with the refusal on screen", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 3f — the catalogue", () => {
  test("lists products with what they are missing", async ({ page }) => {
    await page.goto("/dashboard/products");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Products");
    await expect(page.locator("tbody tr").first()).toBeVisible();
    // The column that earns its place: a product with no filterable specs is
    // listed and not found.
    await expect(page.getByRole("columnheader", { name: "Specs" })).toBeVisible();
  });

  test("offers bulk actions only once something is selected", async ({ page }) => {
    await page.goto("/dashboard/products");
    // `exact`, or the name matches "Unpublish…" as a substring and the bulk bar
    // looks like two Publish buttons the moment anything is selected.
    await expect(page.getByRole("button", { name: "Publish", exact: true })).toHaveCount(0);

    await page.getByRole("checkbox", { name: "Select every product" }).check();
    await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeVisible();
    await expect(page.getByText(/\d+ selected/)).toBeVisible();
  });

  test("is axe clean", async ({ page }) => {
    await page.goto("/dashboard/products");
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

/*
   Board 3h's own screen moved to tests/e2e/dashboard-spec-template.spec.ts when
   it was rebuilt. Two of what stood here are gone by design rather than
   untested, and both were the board's substance rather than its decoration.

   **"Our field" as a column.** The old table put the platform's *label* beside
   the seller's. The pairing that actually holds is the platform field *id*,
   which a rename cannot touch, and it is shown locked in the settings rail —
   `valves.nominal_diameter`, next to the sentence saying comparison follows it
   rather than the label. A label beside a label invites the reading that the
   two have to match.

   **The rename warning.** §4 is explicit: "a warning is not a mapping". The
   board answered the epic's one hard rule with copy — *rename a field and it
   stops matching, we'll warn you* — and the answer is that the label and the
   mapping are two different fields, so a rename physically cannot break
   comparison and there is nothing to warn about. A dialog that appears before a
   safe act teaches a seller the act is dangerous.

   What stays here is the one thing this file is about rather than 3h's: that
   the catalogue's own route to the template still works.
*/
test.describe("board 3h — the spec template, from the catalogue side", () => {
  test("is reachable, and states the mapping a rename cannot break", async ({ page }) => {
    await page.goto("/dashboard/templates");

    const setUp = page.getByRole("button", { name: "Set up your template" });
    if (await setUp.isVisible().catch(() => false)) await setUp.click();

    await expect(page.getByText("Mapped to")).toBeVisible();
    await expect(
      page.getByText(/Comparison follows the mapping below, not the label/),
    ).toBeVisible();
  });

  test("offers no warning before a rename, because there is nothing to warn about", async ({
    page,
  }) => {
    await page.goto("/dashboard/templates");
    const setUp = page.getByRole("button", { name: "Set up your template" });
    if (await setUp.isVisible().catch(() => false)) await setUp.click();

    const label = page.getByRole("textbox").first();
    await label.fill("Material of construction");
    await page.getByRole("button", { name: "Save the template" }).click();

    // Staged, not applied — and no dialog in front of it.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Pending changes" })).toBeVisible();
  });

  test("is axe clean", async ({ page }) => {
    await page.goto("/dashboard/templates");
    const setUp = page.getByRole("button", { name: "Set up your template" });
    if (await setUp.isVisible().catch(() => false)) await setUp.click();
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 3g — the product editor", () => {
  test("has no price field, and says so", async ({ page }) => {
    await page.goto("/dashboard/products");
    await page.locator("tbody tr th a").first().click();
    await page.waitForURL(/\/dashboard\/products\/\w+/);

    await expect(page.getByText("There is no price field")).toBeVisible();
    // Not merely absent — absent under every name a form could use.
    for (const name of ["price", "unitPrice", "cost", "rate", "amount"]) {
      await expect(page.locator(`[name="${name}"]`)).toHaveCount(0);
    }
  });

  test("marks the spec fields buyers filter on", async ({ page }) => {
    await page.goto("/dashboard/products");
    await page.locator("tbody tr th a").first().click();
    await page.waitForURL(/\/dashboard\/products\/\w+/);

    const specs = page.getByRole("region", { name: "Specifications" });
    await expect(specs.getByText("FILTER").first()).toBeVisible();
  });

  test("is axe clean", async ({ page }) => {
    await page.goto("/dashboard/products");
    await page.locator("tbody tr th a").first().click();
    await page.waitForURL(/\/dashboard\/products\/\w+/);
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});
