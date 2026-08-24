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
    await expect(page.getByText("5 rows, 10 columns.")).toBeVisible();
  });

  test("names both price columns and says why", async ({ page }) => {
    const panel = page.getByRole("region", { name: "Not imported" });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("2 columns will not be imported");
    await expect(panel).toContainText("Unit Price AED");
    await expect(panel).toContainText("List Price");
    // The reason, in the seller's terms, not "invalid column".
    await expect(panel).toContainText("they belong on a quote");
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
    await expect(page.getByRole("columnheader", { name: "Filterable specs" })).toBeVisible();
  });

  test("offers bulk actions only once something is selected", async ({ page }) => {
    await page.goto("/dashboard/products");
    await expect(page.getByRole("button", { name: "Publish" })).toHaveCount(0);

    await page.getByRole("checkbox", { name: "Select every product" }).check();
    await expect(page.getByRole("button", { name: "Publish" })).toBeVisible();
    await expect(page.getByText(/\d+ selected/)).toBeVisible();
  });

  test("is axe clean", async ({ page }) => {
    await page.goto("/dashboard/products");
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 3h — the spec template", () => {
  test("shows our field beside theirs on every row", async ({ page }) => {
    await page.goto("/dashboard/templates");

    const setUp = page.getByRole("button", { name: "Set up your template" });
    if (await setUp.isVisible().catch(() => false)) await setUp.click();

    await expect(page.getByRole("columnheader", { name: "Our field" })).toBeVisible();
    // The pairing is what makes a rename safe, and a seller who cannot see it
    // has no reason to believe it.
    await expect(page.locator("tbody tr").first()).toContainText("Nominal diameter");
  });

  test("warns before saving a rename, and says what is kept", async ({ page }) => {
    await page.goto("/dashboard/templates");
    const setUp = page.getByRole("button", { name: "Set up your template" });
    if (await setUp.isVisible().catch(() => false)) await setUp.click();

    await page.getByLabel("Your name for Body material").fill("Material of construction");
    await page.getByRole("button", { name: "Save the template" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Material of construction");
    // The fear is that entered values are lost. The sentence answers it.
    await expect(dialog).toContainText("keep their values");
    await expect(dialog).toContainText("still find you");
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
