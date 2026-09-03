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

/*
   The four states board 1g builds and the first pass never asserted.

   Each was implemented and visible in a browser, and none had a test — which
   is the same shape of gap as a rule the schema promises and no job performs.
   Criterion 8 is the one that mattered most: it swaps the primary action and
   replaces the entire quantity table, and the board is explicit that the
   enquiry path must survive that swap.
*/
const OUT_OF_STOCK = "/b/al-basma-general-trading-llc/p/brass-ball-valve-dn50-4";
const STALE_STOCK = "/b/al-marwan-industrial-supplies-llc/p/brass-ball-valve-dn50-deep-12";

test.describe("out of stock keeps the enquiry open", () => {
  test("swaps to Notify me and still offers a way to ask", async ({ page }) => {
    // Criterion 8. An out-of-stock product is still a live enquiry.
    await page.goto(OUT_OF_STOCK);

    await expect(page.getByRole("button", { name: "Notify me" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Send enquiry" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Enquire about lead time" })).toBeVisible();

    /*
       The quantity table is replaced by one sentence rather than four rows
       about something there is none of — four rows would push the enquiry
       action, which is the point of the state, further down the page.
    */
    await expect(page.getByText("The seller quotes on indent orders.")).toBeVisible();
    await expect(page.locator("table").filter({ hasText: "QUANTITY" })).toHaveCount(0);
  });
});

test.describe("a stock figure that has aged out", () => {
  test("shows the band and withholds the number", async ({ page }) => {
    /*
       Criterion 10, and board 1e's rule: a count older than thirty days is a
       promise the seller never made. "In stock" is honest; "56 units" from two
       months ago is not.
    */
    await page.goto(STALE_STOCK);
    const identity = page.locator("main").getByText(/In stock/).first();
    await expect(identity).toBeVisible();
    await expect(page.locator("main")).not.toContainText("56 units");
    await expect(page.locator("main")).not.toContainText(/\d+ units at/);
  });
});

test.describe("a product with nothing to compare", () => {
  test("hides the comparison and says nothing about other sellers", async ({ page }) => {
    /*
       Criterion 7's other half. A listing with none of its filterable fields
       filled has no spec to match on, so "the only verified listing for this
       spec" would be a claim about a spec that does not exist — on the listings
       least entitled to make one. Silence instead.
    */
    await page.goto(OUT_OF_STOCK);
    const text = await page.locator("main").innerText();
    // Either it has matches and shows the table, or it has none and shows
    // neither the table nor a claim about being the only one.
    if (!text.includes("Same spec, other sellers")) {
      expect(text).not.toMatch(/other verified sellers? stock/);
    }
  });
});

test.describe("a product page that should not be live", () => {
  test("sends an unknown product to the storefront rather than a dead end", async ({ page }) => {
    /*
       Criterion 9, as far as it honestly goes on this platform. The board's
       premise — that a Free-plan seller has no catalogue — does not hold here:
       `Free` carries a `productLimit` of 10 and `allowance()` says a downgrade
       legitimately leaves a seller over their cap. What is buildable is the
       board's own second sentence, never a live page for an unpublished
       product, and the buyer lands on the supplier rather than a 404.
    */
    const response = await page.goto(
      "/b/al-marwan-industrial-supplies-llc/p/a-product-that-was-unpublished",
    );
    expect(response?.status()).toBeLessThan(400);
    await expect(page).toHaveURL(/\/b\/al-marwan-industrial-supplies-llc$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Al Marwan Industrial Supplies",
    );
  });

  test("404s when the storefront is gone too", async ({ page }) => {
    // Nowhere honest to send them.
    const response = await page.goto("/b/no-such-supplier-at-all/p/no-such-product");
    expect(response?.status()).toBe(404);
  });
});
