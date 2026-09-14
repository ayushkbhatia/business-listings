import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Board 4d — the category taxonomy, from an ops lead's session.
 *
 * The numbers first, because the board's defect was a header that disagreed
 * with its rows: every figure asserted here is counted off the markup, not read
 * from a fixture. Then one category's whole life on the screen, on rows this
 * file creates and removes — added, edited, held out of the index, given a new
 * address that is followed, merged into a sibling, and removed. No seeded
 * category is written to, because a destructive test on a shared seed row eats
 * the fixture every other spec reads.
 */

const TREE = "Category tree";
const toNumber = (text: string) => Number(text.replace(/[^\d]/g, ""));
const stamp = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1_000)}`;

async function openTree(page: Page) {
  await page.goto("/admin/categories");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Categories");
}

function tree(page: Page) {
  return page.getByRole("navigation", { name: TREE });
}

test.describe("board 4d — the tree and its numbers", () => {
  test("states a header total that is the sum of the sectors the tree draws", async ({ page }) => {
    await openTree(page);

    const meta = await page.getByText(/sectors? · [\d,]+ subcategor(y|ies) · [\d,]+ listings?/).first().innerText();
    const [sectors, subcategories, listings] = [...meta.matchAll(/[\d,]+/g)].map((match) => toNumber(match[0]));

    // B1: one row per sector, and their counts add up to the header.
    const sectorRows = tree(page).locator("ul[aria-label] > li");
    await expect(sectorRows).toHaveCount(sectors!);
    const counts = await sectorRows.evaluateAll((rows) =>
      rows.map((row) => row.querySelector(":scope > div a span:last-child")?.textContent ?? "0"),
    );
    expect(counts.reduce((total, count) => total + toNumber(count), 0)).toBe(listings);
    expect(subcategories).toBeGreaterThan(0);
  });

  test("finds a category through an Arabic synonym", async ({ page }) => {
    await openTree(page);
    // B4: routing terms are multilingual, and a person looking for the row a
    // buyer typing صمامات lands on has to be able to find it.
    await tree(page).getByRole("searchbox", { name: "Search the tree" }).fill("صمامات");
    await expect(tree(page).getByRole("link", { name: /Valves & fittings/ })).toBeVisible();
    await expect(page.getByText(/categor(y|ies) match(es)? “صمامات”/)).toBeVisible();

    await tree(page).getByRole("searchbox", { name: "Search the tree" }).fill("nothing-routes-here");
    await expect(page.getByText("No category name, address or synonym matches “nothing-routes-here”.")).toBeVisible();
  });

  test("shows which kind of seller a category configures, and where that came from", async ({ page }) => {
    /*
       Flagged 2 on the board: the most consequential field on the record was
       not drawn on the editor. Legal is set on its own row; PRO services
       follows it.
    */
    await openTree(page);
    await tree(page).getByRole("searchbox", { name: "Search the tree" }).fill("PRO services");
    await tree(page).getByRole("link", { name: /^PRO services/ }).click();

    const editor = page.getByRole("region", { name: "PRO services" });
    await expect(editor.getByText("By the job")).toBeVisible();
    await expect(editor.getByText(/From Legal, audit & business setup/)).toBeVisible();
    await expect(editor.getByRole("link", { name: "Change on the Trade kind tab" })).toHaveAttribute("href", "/admin/categories?tab=kind");

    await tree(page).getByRole("searchbox", { name: "Search the tree" }).fill("Legal, audit");
    await tree(page).getByRole("link", { name: /^Legal, audit & business setup/ }).click();
    // Anchored: the template picker's "None set here" option is not the answer.
    await expect(page.getByRole("region", { name: "Legal, audit & business setup" }).getByText(/^Set here/)).toBeVisible();
  });

  test("draws four demand figures that agree with the tree", async ({ page }) => {
    await page.goto("/admin/categories");
    const selected = tree(page).locator('a[aria-current="page"]');
    await expect(selected).toHaveCount(1);
    const rowCount = toNumber((await selected.locator("span").last().innerText()) ?? "0");

    const demand = page.getByRole("region", { name: "Demand signal" });
    const terms = demand.locator("dt");
    await expect(terms).toHaveText(["Listings", /^(Products|Services)$/, "RFQs / month", "Paid sellers here"]);
    const values = await demand.locator("dd").allInnerTexts();
    expect(toNumber(values[0]!)).toBe(rowCount);
    // "118 of 341": the second figure is the listings row, not another count.
    expect(values[3]).toMatch(new RegExp(`of ${values[0]!.replace(/[,]/g, ",")}$`));
  });

  test("reads the home grid rather than switching it, and switches the other three", async ({ page }) => {
    await page.goto("/admin/categories");
    const visibility = page.getByRole("region", { name: "Visibility" });
    await expect(visibility.getByText("Show on the home grid")).toBeVisible();
    await expect(visibility.getByText(/Computed, not set/)).toBeVisible();
    await expect(visibility.getByRole("switch")).toHaveCount(3);
    for (const name of ["Show in the category index", "Allow RFQ fan-outs", "Requires extra licence check"]) {
      await expect(visibility.getByRole("switch", { name })).toBeVisible();
    }
  });

  test("refuses to remove a sector with subcategories, and says so", async ({ page }) => {
    await openTree(page);
    await tree(page).getByRole("link", { name: /^HVAC & ventilation/ }).click();
    /*
       Wait for the editor to be HVAC's before pressing its button. The link is
       a navigation, and the previous category's editor stays on screen until it
       lands — pressing Remove in between opens the wrong category's dialog.
    */
    const editor = page.getByRole("region", { name: "HVAC & ventilation" });
    await expect(editor).toBeVisible();
    await editor.getByRole("button", { name: "Remove category" }).click();
    const dialog = page.getByRole("dialog", { name: /Remove HVAC & ventilation/ });
    await dialog.getByRole("textbox", { name: "Reason" }).fill("Checking what the refusal says.");
    await dialog.getByRole("button", { name: "Remove category" }).click();
    await expect(dialog.getByText(/subcategor(y sits|ies sit) under it/)).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
  });

  test("is axe clean at the acceptance viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/admin/categories");
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe.serial("board 4d — one category's life on the screen", () => {
  const id = stamp();
  const first = `E2E taxonomy ${id}`;
  const second = `E2E taxonomy merge ${id}`;
  let firstSlug = "";
  let movedSlug = "";

  async function addUnderHvac(page: Page, name: string) {
    await openTree(page);
    await page.getByRole("button", { name: "Add category" }).click();
    const dialog = page.getByRole("dialog", { name: "Add a category" });
    await dialog.getByRole("combobox", { name: "Sector" }).selectOption({ label: "HVAC & ventilation" });
    await dialog.getByRole("textbox", { name: "Display name" }).fill(name);
    await dialog.getByRole("textbox", { name: "Two-letter code" }).fill("EZ");
    await dialog.getByRole("textbox", { name: "Reason" }).fill("End-to-end test category.");
    await dialog.getByRole("button", { name: "Add subcategory" }).click();
    await expect(page).toHaveURL(/\/admin\/categories\?c=/);
    await expect(page.getByRole("region", { name })).toBeVisible();
    return (await page.getByRole("region", { name }).getByRole("textbox", { name: "URL slug" }).inputValue());
  }

  test("adds a subcategory, which lands in the tree under its sector", async ({ page }) => {
    firstSlug = await addUnderHvac(page, first);
    expect(firstSlug).toMatch(/^e2e-taxonomy-/);
    await expect(tree(page).getByRole("link", { name: new RegExp(`^${first}`) })).toBeVisible();
  });

  test("saves a synonym with a reason, and the reason is asked for", async ({ page }) => {
    await openTree(page);
    await tree(page).getByRole("searchbox", { name: "Search the tree" }).fill(first);
    await tree(page).getByRole("link", { name: new RegExp(`^${first}`) }).click();
    const editor = page.getByRole("region", { name: first });

    await editor.getByRole("button", { name: "Add" }).click();
    await editor.getByRole("textbox", { name: /New synonym/ }).fill("ductless split unit");
    await editor.getByRole("textbox", { name: /New synonym/ }).press("Enter");
    await expect(editor.getByText("1 unsaved change")).toBeVisible();

    await editor.getByRole("button", { name: "Save changes" }).click();
    await expect(editor.getByText("Write a reason of at least four characters.")).toBeVisible();

    await editor.getByRole("textbox", { name: "Reason" }).fill("Buyers type this for the product.");
    await editor.getByRole("button", { name: "Save changes" }).click();
    await expect(editor.getByText("Saved. 1 field changed.")).toBeVisible();
    await page.reload();
    // Exact: a retry's leftover category carrying the same term adds an "also routes to" line.
    await expect(page.getByRole("region", { name: first }).getByText("ductless split unit", { exact: true })).toBeVisible();
  });

  test("holds it out of the category index with a reason", async ({ page }) => {
    await openTree(page);
    await tree(page).getByRole("searchbox", { name: "Search the tree" }).fill(first);
    await tree(page).getByRole("link", { name: new RegExp(`^${first}`) }).click();
    // The panel is on screen for whichever category was open before; wait for this one.
    await expect(page.getByRole("region", { name: first })).toBeVisible();

    await page.getByRole("region", { name: "Visibility" }).getByRole("switch", { name: "Show in the category index" }).click();
    const dialog = page.getByRole("dialog", { name: new RegExp(`Take ${first} out of the category index`) });
    await dialog.getByRole("textbox", { name: "Reason" }).fill("Not ready for the public index.");
    await dialog.getByRole("button", { name: "Take it out of the index" }).click();

    await expect(page.getByText("Taken out of the category index.")).toBeVisible();
    await expect(page.getByRole("region", { name: "Visibility" }).getByRole("switch", { name: "Show in the category index" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await expect(tree(page).getByRole("link", { name: new RegExp(`^${first}.*Not in index`) })).toBeVisible();
  });

  test("changes its address, says how many redirects that writes, and the old address follows", async ({ page }) => {
    await openTree(page);
    await tree(page).getByRole("searchbox", { name: "Search the tree" }).fill(first);
    await tree(page).getByRole("link", { name: new RegExp(`^${first}`) }).click();

    movedSlug = `${firstSlug}-moved`;
    await page.getByRole("region", { name: first }).getByRole("button", { name: "Change" }).click();
    const dialog = page.getByRole("dialog", { name: `Change the address of ${first}` });
    await dialog.getByRole("textbox", { name: "New address" }).fill(movedSlug);
    await expect(dialog.getByText("1 address moves and redirects.")).toBeVisible();
    await dialog.getByRole("textbox", { name: "Reason" }).fill("A clearer address.");
    await dialog.getByRole("button", { name: "Change the address and write 1 redirect" }).click();
    await expect(page.getByText("Address changed. 1 redirect written.")).toBeVisible();

    // B7: the redirect row is served, not only written.
    const response = await page.request.get(`/c/hvac-and-ventilation/${firstSlug}`, { maxRedirects: 0 });
    expect([301, 307, 308]).toContain(response.status());
    expect(response.headers()["location"]).toContain(`/c/hvac-and-ventilation/${movedSlug}`);
  });

  test("merges it into a sibling, writes the redirect, and lands on the one that stays", async ({ page }) => {
    await addUnderHvac(page, second);

    await tree(page).getByRole("searchbox", { name: "Search the tree" }).fill(first);
    await tree(page).getByRole("link", { name: new RegExp(`^${first}`) }).click();
    // The tool opens on the selected category, so the selection has to have landed.
    await expect(page.getByRole("region", { name: first })).toBeVisible();
    await page.getByRole("button", { name: "Merge tool" }).click();

    const dialog = page.getByRole("dialog", { name: "Merge two categories" });
    await dialog.getByRole("combobox", { name: "Into" }).selectOption({ label: `${second} · 0` });
    await expect(dialog.getByText(`${first} merges into ${second}.`)).toBeVisible();
    await expect(dialog.getByText("1 redirect is written")).toBeVisible();
    await dialog.getByRole("textbox", { name: "Reason" }).fill("Two test categories for one trade.");
    await dialog.getByRole("button", { name: "Merge and write 1 redirect" }).click();

    await expect(page.getByRole("region", { name: second })).toBeVisible();
    await expect(tree(page).getByRole("link", { name: new RegExp(`^${first}`) })).toHaveCount(0);

    const response = await page.request.get(`/c/hvac-and-ventilation/${movedSlug}`, { maxRedirects: 0 });
    expect([301, 307, 308]).toContain(response.status());
    expect(response.headers()["location"]).toContain("/c/hvac-and-ventilation/e2e-taxonomy-merge-");
  });

  test("removes the category that stayed, since nothing is filed under it", async ({ page }) => {
    await openTree(page);
    await tree(page).getByRole("searchbox", { name: "Search the tree" }).fill(second);
    await tree(page).getByRole("link", { name: new RegExp(`^${second}`) }).click();
    await page.getByRole("region", { name: second }).getByRole("button", { name: "Remove category" }).click();
    const dialog = page.getByRole("dialog", { name: `Remove ${second}` });
    await dialog.getByRole("textbox", { name: "Reason" }).fill("End-to-end test finished.");
    await dialog.getByRole("button", { name: "Remove category" }).click();

    await expect(page.getByRole("region", { name: "HVAC & ventilation" })).toBeVisible();
    await tree(page).getByRole("searchbox", { name: "Search the tree" }).fill(second);
    await expect(page.getByText(`No category name, address or synonym matches “${second}”.`)).toBeVisible();
  });
});
