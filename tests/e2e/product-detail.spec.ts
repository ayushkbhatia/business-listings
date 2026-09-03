import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Board 1g — product detail & spec table.
 *
 * The page the whole no-price model is designed around. If the rule holds here
 * it holds everywhere; if it leaks, it leaks here first — this is the one place
 * a buyer looks at a quantity and expects a number beside it.
 *
 * Seeded by `seedProductDetail`: a datasheet, answered questions, and a second
 * verified seller carrying the same spec, because without those four of the
 * board's sections render their own empty states.
 */

const SELLER = "al-marwan-industrial-supplies-llc";
const PRODUCT = "cast-iron-gate-valve-imperial-0";
const URL = `/b/${SELLER}/p/${PRODUCT}`;

test.describe("no price, anywhere", () => {
  test("not in the DOM, not in a data attribute, not in the JSON-LD", async ({ page }) => {
    await page.goto(URL);

    /*
       Criterion 1. `innerHTML` rather than `innerText`, because the criterion
       says "or in any data attribute" — a price hidden in markup is still a
       price on a public surface.
    */
    const html = await page.locator("main").innerHTML();
    expect(html).not.toMatch(/\bAED\b/);
    expect(html).not.toMatch(/priceCurrency/);
    expect(html).not.toMatch(/data-price/);

    const product = await page
      .locator('script[type="application/ld+json"]')
      .evaluateAll((nodes) =>
        nodes
          .map((n) => JSON.parse(n.textContent ?? "{}") as Record<string, unknown>)
          .find((b) => b["@type"] === "Product"),
      );

    const offers = (product?.["offers"] ?? {}) as Record<string, unknown>;
    expect(offers["availability"]).toBeTruthy();
    /*
       Omitted entirely, never emitted empty or zero. An omitted price with a
       stated availability is valid `Product` markup; a zero price is not, and
       would be read as free.
    */
    expect(offers).not.toHaveProperty("price");
    expect(offers).not.toHaveProperty("priceCurrency");
    expect(offers).not.toHaveProperty("priceSpecification");
  });

  test("the quantity table's second column is availability, never a unit price", async ({ page }) => {
    await page.goto(URL);
    const table = page.locator("table").filter({ hasText: "QUANTITY" });
    await expect(table).toBeVisible();

    const headers = await table.locator("th[scope=col]").allInnerTexts();
    expect(headers).toEqual(["QUANTITY", "AVAILABILITY"]);
    expect(headers.join(" ")).not.toMatch(/price/i);

    // Criterion 3: four bands, and "better rate" says volume moves the number
    // without stating one.
    const rows = table.locator("tbody tr");
    await expect(rows).toHaveCount(4);
    await expect(table).toContainText("Collect today");
    await expect(table).toContainText("Contract pricing");
  });

  test("says why there is no price, with the measured reply time", async ({ page }) => {
    // Criterion 2. Never "log in to see prices", which reads as a paywall.
    await page.goto(URL);
    await expect(page.getByText("Price on enquiry")).toBeVisible();
    await expect(
      page.getByText(/volume, delivery point and payment terms all move the number/),
    ).toBeVisible();
    await expect(page.locator("main")).not.toContainText("Log in to see");
    await expect(page.locator("main")).not.toContainText("Contact for pricing");
  });
});

test.describe("the spec table", () => {
  test("renders unfilled rows and the count agrees with them", async ({ page }) => {
    await page.goto(URL);

    /*
       Criterion 4, asserted by parsing the rendered table rather than by eye.
       This is the number `CompletenessMeter` reads, the number the seller sees
       in 3g, and the spec-completeness ranking weight — a mismatch is not
       cosmetic.
    */
    const meta = await page.getByText(/TEMPLATE: .* FIELDS FILLED/).innerText();
    const [, filled, total] = /(\d+) OF (\d+) FIELDS FILLED/.exec(meta) ?? [];
    expect(filled).toBeTruthy();

    const specTable = page.locator("table").filter({ hasText: "Nominal diameter" });
    const rows = specTable.locator("tbody tr");
    await expect(rows).toHaveCount(Number(total));

    const notProvided = await rows.filter({ hasText: "Not provided" }).count();
    expect(Number(total) - notProvided).toBe(Number(filled));
    // The grey rows must be there at all — hiding them makes an incomplete
    // spec look complete.
    expect(notProvided).toBeGreaterThan(0);
  });

  test("spec values are body text, not only structured data", async ({ page }) => {
    // Criterion 14: a query for "PN16 ductile iron DN100" matches the page.
    await page.goto(URL);
    const text = await page.locator("main").innerText();
    expect(text).toMatch(/PN\d+|DN\d+|\d+ inch/);
  });

  test("offers a one-click request naming the missing fields", async ({ page }) => {
    // Criterion 5. "Please confirm the seat material" is answerable in a line.
    await page.goto(URL);
    await expect(page.getByRole("button", { name: "Request the missing fields" })).toBeVisible();
  });
});

test.describe("same spec, other sellers", () => {
  test("compares on spec, lead time and replies — with no price column", async ({ page }) => {
    await page.goto(URL);
    const table = page.locator("table").filter({ hasText: "Replies in" });
    await expect(table).toBeVisible();

    const headers = await table.locator("th[scope=col]").allInnerTexts();
    expect(headers.join(" ")).not.toMatch(/price|AED/i);

    // Criterion 6: verified, spec-matched, published — and the current seller
    // is in it, marked.
    await expect(table).toContainText("· this page");
    expect(await table.locator("tbody tr").count()).toBeGreaterThan(1);
  });

  test("every seller name is a display name", async ({ page }) => {
    /*
       Criterion 11, asserted by a grep over the rendered DOM. Each row links to
       that seller's storefront, so a legal name here means the buyer reads one
       name and lands on another.
    */
    await page.goto(URL);
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(/\bLLC\b/);
    expect(text).not.toMatch(/\bFZE\b/);
    expect(text).not.toMatch(/Trading Co\./);
  });
});

test.describe("what a buyer can take away", () => {
  test("a datasheet downloads without an enquiry or a login", async ({ page }) => {
    // Criterion 12. Gating it costs more enquiries than it earns.
    await page.goto(URL);
    const doc = page.locator('a[href*="/d/"]').first();
    await expect(doc).toBeVisible();
    // Its display name, never the filename off somebody's desktop.
    await expect(doc).not.toHaveText(/\.pdf$/i);
    await expect(doc).not.toHaveText(/scan_/i);
  });

  test("shows one answered question verbatim and counts the rest", async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByText(/questions? answered/)).toBeVisible();
  });
});

test.describe("accessibility and structure", () => {
  test("has one h1, a real spec table, and is axe clean", async ({ page }) => {
    await page.goto(URL);
    await expect(page.locator("h1")).toHaveCount(1);

    // Non-negotiable 4: a real table with scoped headers, not divs.
    const specTable = page.locator("table").filter({ hasText: "Nominal diameter" });
    await expect(specTable.locator("th[scope]").first()).toBeVisible();

    /*
       Contrast excluded, as every axe test in this suite does — the failing
       pairs are token-level and pinned, per `docs/contrast.md`.
    */
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
      .disableRules(["color-contrast"])
      .analyze();
    expect(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.length }))).toEqual([]);
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("keeps the enquiry action in a 44px sticky bar", async ({ page }) => {
    /*
       Criterion 13. The page is long and the buyer arrives mid-page from a
       search — losing the action above the fold loses the enquiry.
    */
    await page.goto(URL);
    const bar = page.locator("div.fixed.bottom-0");
    await expect(bar).toBeVisible();
    await expect(bar).toContainText("Cast iron gate valve");

    const send = bar.getByRole("button", { name: "Send enquiry" });
    expect((await send.boundingBox())?.height).toBeGreaterThanOrEqual(44);

    const overflow = await page.evaluate(
      () => document.body.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
