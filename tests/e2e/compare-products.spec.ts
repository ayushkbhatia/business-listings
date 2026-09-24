import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Board `10d` — comparing products, from the tick to the table.
 *
 * The rules that decide the table — which cells differ, what normalises to
 * what — are unit tests beside `lib/compare`; the reads are integration tests.
 * This file is about what a buyer does: tick on a real page, watch the tray,
 * open the comparison, change it, and be told whenever something they asked
 * for is not in it.
 *
 * Product ids are cuids minted by the seed, so they are read off the ticks
 * (`data-compare-product`) rather than written here.
 */

/** Twelve sellers of pumps, six on this one's catalogue, all in one trade with a template. */
const PUMPS = "/b/technopump-trading-0/products";
const PUMP_TRADE = "Pumps & motors";
/** A product in another trade. */
const VALVE = "/b/al-marwan-industrial-supplies-llc/p/brass-ball-valve-dn25-4";
const VALVE_TRADE = "Ball valves";

const ticks = (page: Page) => page.locator("[data-compare-product]");
const tray = (page: Page) => page.getByRole("region", { name: "Comparison tray" });

async function tick(page: Page, index: number) {
  const button = ticks(page).nth(index);
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
}

async function productIds(page: Page, path: string): Promise<string[]> {
  await page.goto(path);
  const ids = await ticks(page).evaluateAll((buttons) =>
    buttons.map((button) => button.getAttribute("data-compare-product") ?? ""),
  );
  return [...new Set(ids.filter(Boolean))];
}

test.describe("the tick and the tray", () => {
  test("one product asks for another; two open the comparison", async ({ page }) => {
    await page.goto(PUMPS);
    await expect(tray(page)).toHaveCount(0);

    await tick(page, 0);
    await expect(tray(page)).toContainText(`Comparing 1 of 4 · ${PUMP_TRADE}`);
    await expect(tray(page)).toContainText(`Add one more product in ${PUMP_TRADE} to compare.`);

    await tick(page, 1);
    const open = tray(page).getByRole("link", { name: "Compare 2 products" });
    await expect(open).toBeVisible();
    await open.click();

    await expect(page).toHaveURL(/\/compare\?p=c[a-z0-9]+,c[a-z0-9]+$/);
    await expect(page.getByRole("table", { name: `2 products in ${PUMP_TRADE}, compared field by field` })).toBeVisible();
    // The page is the comparison; a bar offering to open it is not drawn on it.
    await expect(tray(page)).toHaveCount(0);
  });

  test("pressing a ticked product takes it out, and Clear empties the tray", async ({ page }) => {
    await page.goto(PUMPS);
    await tick(page, 0);
    await tick(page, 1);
    await ticks(page).nth(0).click();
    await expect(ticks(page).nth(0)).toHaveAttribute("aria-pressed", "false");
    await expect(tray(page)).toContainText("Comparing 1 of 4");

    await tray(page).getByRole("button", { name: "Clear" }).click();
    await expect(tray(page)).toHaveCount(0);
  });

  test("B7 — the fifth is refused, and the four held are named", async ({ page }) => {
    await page.goto(PUMPS);
    for (const index of [0, 1, 2, 3]) await tick(page, index);
    await expect(tray(page)).toContainText("Comparing 4 of 4");

    const fifth = ticks(page).nth(4);
    await expect(fifth).toContainText("Comparison full");
    await expect(fifth).toHaveAttribute("aria-disabled", "true");
    await expect(fifth).toHaveAccessibleDescription(/^The comparison holds four already: .+\. Remove one to add this\.$/);

    // Still in the tab order, so the reason can be reached — and pressing it changes nothing.
    // Pressed from the keyboard: Playwright will not click an aria-disabled control, and a buyer can still reach it.
    await fifth.focus();
    await expect(fifth).toBeFocused();
    await fifth.press("Enter");
    await expect(tray(page)).toContainText("Comparing 4 of 4");
    await expect(tray(page).getByRole("listitem")).toHaveCount(4);
  });

  test("one trade at a time: another trade starts a fresh comparison and says so", async ({ page }) => {
    await page.goto(PUMPS);
    await tick(page, 0);
    await tick(page, 1);

    await page.goto(VALVE);
    const valve = page.getByRole("button", { name: /^Compare Brass ball valve DN25/ }).first();
    await expect(valve).toHaveAccessibleDescription(
      `Starts a new comparison. Your tray holds 2 products in ${PUMP_TRADE}, which will be cleared.`,
    );
    await valve.click();

    await expect(tray(page)).toContainText(`Comparing 1 of 4 · ${VALVE_TRADE}`);
    await expect(tray(page)).toContainText(
      `Started a new comparison in ${VALVE_TRADE}. The 2 products from before were cleared.`,
    );
  });

  test("B8 — search offers the tick on products, never on a supplier or a service", async ({ page }) => {
    await page.goto("/search?q=valve&kind=products");
    await expect(ticks(page).first()).toBeVisible();

    await page.goto("/search?q=valve&kind=suppliers");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(ticks(page)).toHaveCount(0);

    await page.goto("/search?q=vat+return+filing&kind=services");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(ticks(page)).toHaveCount(0);
  });
});

test.describe("the comparison", () => {
  test("B1 — a real table, transposed, with every template row and the two seller rows", async ({ page }) => {
    const [a, b, c] = await productIds(page, PUMPS);
    await page.goto(`/compare?p=${a},${b},${c}`);

    const table = page.getByRole("table", { name: `3 products in ${PUMP_TRADE}, compared field by field` });
    await expect(table).toBeVisible();
    await expect(table.locator('th[scope="col"]')).toHaveCount(4);
    const rows = await table.locator('tbody th[scope="row"]').allInnerTexts();
    expect(rows.join("|")).toContain("Availability");
    expect(rows.join("|")).toContain("Reply time");
    expect(rows.join("|")).toContain("Spec completeness");
    // Template rows first, then availability and the two seller rows, then the ask row.
    expect(rows.length).toBeGreaterThan(4);

    await expect(page.getByRole("heading", { level: 1, name: "Comparing 3 products" })).toBeVisible();
    await expect(page.getByText(`Rows come from the shared ${PUMP_TRADE} template`)).toBeVisible();
  });

  test("no price anywhere, and one enquiry to every seller in it", async ({ page }) => {
    const [a, b, c] = await productIds(page, PUMPS);
    await page.goto(`/compare?p=${a},${b},${c}`);
    expect((await page.textContent("main")) ?? "").not.toMatch(/AED\s*[\d,]/);

    // Three products from one seller pin that seller once and carry all three.
    await expect(page.getByRole("link", { name: "Ask all 3 for a quote" })).toHaveAttribute(
      "href",
      `/rfq/new?to=technopump-trading-0&products=${a},${b},${c}`,
    );
    await expect(page.getByRole("link", { name: /^Ask for a quote for / })).toHaveCount(3);
  });

  test("downloads as the same table: the caveat first, a column per product, no price (1n flag 5)", async ({ page }) => {
    const [a, b, c] = await productIds(page, PUMPS);
    await page.goto(`/compare?p=${a},${b},${c}`);
    const link = page.getByRole("link", { name: "Download as CSV" });
    await expect(link).toHaveAttribute("href", `/compare/export?p=${a},${b},${c}`);

    const response = await page.request.get(`/compare/export?p=${a},${b},${c}`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/csv");
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    expect(response.headers()["content-disposition"]).toMatch(/^attachment; filename="[A-Za-z0-9-]+\.csv"$/);
    const csv = (await response.text()).replace(/^\uFEFF/, "");
    const [caveat, head] = csv.split("\r\n");
    expect(caveat).toContain(`3 products in ${PUMP_TRADE}`);
    // A column per product, each named with its seller, after the field column.
    expect(head!.split(",")[0]).toBe("Field");
    expect(csv).toContain("Availability");
    expect(csv).not.toMatch(/AED\s*[\d,]/);
  });

  test("B4 — Hide matching rows keeps what differs and the seller rows, and says so", async ({ page }) => {
    const [a, b, c, d] = await productIds(page, PUMPS);
    await page.goto(`/compare?p=${a},${b},${c},${d}`);
    const all = await page.locator("tbody tr[data-row-kind]").count();

    await page.getByRole("link", { name: "Hide matching rows" }).click();
    await expect(page).toHaveURL(/diff=1/);
    await expect(page.getByRole("table", { name: /only the rows where they differ/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Show every row" })).toBeVisible();

    const kept = page.locator("tbody tr[data-row-kind]");
    expect(await kept.count()).toBeLessThanOrEqual(all);
    for (const kind of await page.locator("tbody tr[data-row-kind]:not([data-differs])").evaluateAll((trs) =>
      trs.map((tr) => tr.getAttribute("data-row-kind")),
    )) {
      expect(["reply", "completeness"]).toContain(kind);
    }
    // A tint is never the only signal (WCAG 1.4.1).
    for (const heading of await page.locator("tbody tr[data-differs] th").allInnerTexts()) {
      expect(heading).toMatch(/differs between these products/);
    }
  });

  test("removing a column keeps the rest, in order", async ({ page }) => {
    const [a, b, c] = await productIds(page, PUMPS);
    await page.goto(`/compare?p=${a},${b},${c}`);
    const first = (await page.locator('thead th[scope="col"] p a').first().innerText()).trim();

    await page.getByRole("button", { name: `Remove ${first} from the comparison` }).click();
    await expect(page).toHaveURL(new RegExp(`p=${b},${c}$`));
    await expect(page.locator('thead th[scope="col"]')).toHaveCount(3);
  });

  test("B10 — a link naming too many shows four and says how many it left out", async ({ page }) => {
    const ids = await productIds(page, PUMPS);
    expect(ids.length).toBeGreaterThanOrEqual(6);
    await page.goto(`/compare?p=${ids.slice(0, 6).join(",")}`);
    await expect(page.locator('thead th[scope="col"]')).toHaveCount(5);
    await expect(page.getByText("This link names 2 more products than a comparison holds. The first four are shown.")).toBeVisible();
  });

  test("a product from another trade is named and left out, never compared on fields it lacks", async ({ page }) => {
    const [a, b] = await productIds(page, PUMPS);
    const [valve] = await productIds(page, VALVE);
    await page.goto(`/compare?p=${a},${b},${valve}`);
    await expect(page.locator('thead th[scope="col"]')).toHaveCount(3);
    await expect(page.getByText(new RegExp(`is in ${VALVE_TRADE}, not ${PUMP_TRADE}\\. A comparison holds one trade`))).toBeVisible();
  });

  test("one product is a column and a request for another", async ({ page }) => {
    const [a] = await productIds(page, PUMPS);
    await page.goto(`/compare?p=${a}`);
    await expect(page.getByText(`Add at least one more product in ${PUMP_TRADE} to compare it with.`)).toBeVisible();
    // A single column matches itself everywhere, so there is nothing to hide.
    await expect(page.getByRole("link", { name: "Hide matching rows" })).toHaveCount(0);
  });

  test("has a designed empty state that says this compares products", async ({ page }) => {
    await page.goto("/compare");
    await expect(page.getByRole("heading", { level: 1, name: "Nothing to compare yet" })).toBeVisible();
    await expect(page.getByText(/A service is compared on the proposals it returns/)).toBeVisible();
    // The footer has a link of the same name; the state's own is in main.
    await expect(page.getByRole("main").getByRole("link", { name: "Browse products" })).toHaveAttribute(
      "href",
      "/search?kind=products",
    );
  });

  test("an id that is not a product is never looked up", async ({ page }) => {
    await page.goto("/compare?p=al-marwan-industrial-supplies-llc,'%3B--");
    await expect(page.getByRole("heading", { level: 1, name: "Nothing to compare yet" })).toBeVisible();
  });

  test("the tray cookie sets the columns when the URL does not", async ({ page }) => {
    await page.goto(PUMPS);
    await tick(page, 0);
    await tick(page, 1);
    await page.goto("/compare");
    await expect(page.getByRole("heading", { level: 1, name: "Comparing 2 products" })).toBeVisible();
  });

  test("does not pan sideways on a phone — the table scrolls inside its own region", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const [a, b, c, d] = await productIds(page, PUMPS);
    await page.goto(`/compare?p=${a},${b},${c},${d}`);
    const { documentWidth, viewportWidth } = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(documentWidth).toBe(viewportWidth);
    // Focusable because it scrolls: a region a keyboard cannot reach is content a keyboard cannot read.
    await expect(page.getByRole("region", { name: /compared field by field/ })).toHaveAttribute("tabindex", "0");
  });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("a tick posts, comes back to the page, and the comparison reads the cookie", async ({ page }) => {
    await page.goto(PUMPS);
    await ticks(page).nth(0).click();
    await expect(page).toHaveURL(new RegExp(`${PUMPS}$`));
    await ticks(page).nth(1).click();
    await expect(page).toHaveURL(new RegExp(`${PUMPS}$`));

    await page.goto("/compare");
    await expect(page.getByRole("heading", { level: 1, name: "Comparing 2 products" })).toBeVisible();
  });
});

test.describe("axe", () => {
  async function clean(page: Page) {
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
      .disableRules(["color-contrast"])
      .analyze();
    const summary = results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.length,
      first: v.nodes[0]?.html?.slice(0, 130),
    }));
    expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
  }

  test("is clean on a four-column comparison", async ({ page }) => {
    const [a, b, c, d] = await productIds(page, PUMPS);
    await page.goto(`/compare?p=${a},${b},${c},${d}`);
    await clean(page);
  });

  test("is clean with matching rows hidden", async ({ page }) => {
    const [a, b, c] = await productIds(page, PUMPS);
    await page.goto(`/compare?p=${a},${b},${c}&diff=1`);
    await clean(page);
  });

  test("is clean on the empty state", async ({ page }) => {
    await page.goto("/compare");
    await clean(page);
  });

  test("is clean on a catalogue with the tray open and full", async ({ page }) => {
    await page.goto(PUMPS);
    for (const index of [0, 1, 2, 3]) await tick(page, index);
    await clean(page);
  });
});
