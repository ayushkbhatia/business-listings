import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Board 1h — the RFQ fan-out at `/rfq/new`.
 *
 * The highest-intent page on the public site, and the one the handoff says is
 * most likely to be built wrong in three specific ways: two composers rather
 * than one model, a separate "add items" route that should not exist, and the
 * buyer's target price being mistaken for a no-price violation.
 */

/** Seeded by `seedProductDetail`; matched line, and its seller pinned. */
const SEED_PRODUCT = "cmtlsnfud00glhf8o37nyano4";

const rows = (page: import("@playwright/test").Page) =>
  page.locator("table tbody tr");

test.describe("the three arrivals", () => {
  test("cold: step 1, requirement dimmed and refusing input", async ({ page }) => {
    /*
       Criterion 2. There is no separate route for adding items — step 1 is
       this page with no lines. The fields render so the buyer can see what is
       coming and refuse input so they cannot fill them out of order.
    */
    await page.goto("/rfq/new");
    await expect(page.getByText("1 / 3")).toBeVisible();
    await expect(page.getByText("Add items to see matching sellers")).toBeVisible();

    const requirement = page.locator("section").filter({ hasText: "Your requirement" });
    await expect(requirement).toHaveCSS("opacity", "0.55");
    const controls = requirement.locator("input, textarea, select");
    const count = await controls.count();
    expect(count).toBeGreaterThan(5);
    for (let i = 0; i < count; i += 1) {
      await expect(controls.nth(i)).toBeDisabled();
    }

    await expect(page.getByRole("button", { name: /^Send/ })).toBeDisabled();
  });

  test("one line enables everything, with no reload", async ({ page }) => {
    /*
       Criterion 2's second half, and the composer model's rule that the page
       never reloads between steps. Asserted by pinning a value on `window`
       across the transition — a navigation would wipe it.
    */
    await page.goto("/rfq/new");
    await page.evaluate(() => {
      (window as unknown as { __alive: boolean }).__alive = true;
    });

    await rows(page).first().locator("input").first().fill("Grooved gasket, EPDM, 4 inch");
    await expect(page.getByText("2 / 3")).toBeVisible();

    const survived = await page.evaluate(
      () => (window as unknown as { __alive?: boolean }).__alive === true,
    );
    expect(survived).toBe(true);

    const requirement = page.locator("section").filter({ hasText: "Your requirement" });
    await expect(requirement.locator("textarea")).toBeEnabled();
    // Criterion 4: a free-text line with no catalogue match is first-class.
    await expect(page.getByText("NOT MATCHED TO A LISTING")).toBeVisible();
  });

  test("query-seeded from 1c opens at step 2 and says why", async ({ page }) => {
    await page.goto("/rfq/new?q=grooved+gasket+EPDM+4+inch");
    await expect(page.getByText("2 / 3")).toBeVisible();
    await expect(page.getByText(/We couldn't find this listed/)).toBeVisible();
    await expect(rows(page).first().locator("input").first()).toHaveValue(
      "grooved gasket EPDM 4 inch",
    );
    await expect(page.getByText("NOT MATCHED TO A LISTING")).toBeVisible();
  });

  test("product-seeded from 1g pins that seller first and ticks it", async ({ page }) => {
    // Criterion 1's third arrival.
    await page.goto(`/rfq/new?products=${SEED_PRODUCT}`);
    await expect(page.getByText("2 / 3")).toBeVisible();

    // A matched line carries its SKU and its seller, not "not matched".
    await expect(page.getByText(/ALM-90 · FROM AL MARWAN/)).toBeVisible();

    const first = page.locator("li").filter({ has: page.locator("input[type=checkbox]") }).first();
    await expect(first).toContainText("Al Marwan Industrial Supplies");
    await expect(first).toContainText("from the page you were on");
    await expect(first.locator("input[type=checkbox]")).toBeChecked();
  });
});

test.describe("the recipient picker", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/rfq/new?products=${SEED_PRODUCT}`);
    await expect(page.getByText("2 / 3")).toBeVisible();
  });

  test("names every seller and caps the send at eight", async ({ page }) => {
    // Criterion 6, and criterion 16's "every checkbox names its seller".
    const boxes = page.locator("input[type=checkbox]");
    expect(await boxes.count()).toBeGreaterThan(0);
    for (const name of await boxes.evaluateAll((els) =>
      els.map((e) => e.getAttribute("aria-label")),
    )) {
      expect(name).toMatch(/^Send to .+/);
    }
    expect(await boxes.count()).toBeLessThanOrEqual(8);
  });

  test("unticking to zero disables Send and says why", async ({ page }) => {
    /*
       Criterion 6: never a silent dead button.

       The delivery area is filled first on purpose. `sendBlockedBy` names the
       *first* thing missing, in order, so without an area the page correctly
       reports the area rather than the recipients — an earlier version of this
       test asserted the recipients message against a form that was also missing
       its area, and read the right behaviour as a failure.
    */
    await page.locator("select").first().selectOption("dubai");

    const boxes = page.locator("input[type=checkbox]");
    const count = await boxes.count();
    for (let i = 0; i < count; i += 1) {
      const box = boxes.nth(i);
      if (await box.isChecked()) await box.uncheck();
    }
    await expect(page.getByRole("button", { name: /^Send/ })).toBeDisabled();
    await expect(page.getByText("Pick at least one seller to send to.")).toBeVisible();
  });

  test("no seller name carries a legal suffix", async ({ page }) => {
    // Criterion 12, grepped over the rendered DOM.
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(/\bLLC\b/);
    expect(text).not.toMatch(/\bFZE\b/);
    expect(text).not.toMatch(/Trading Co\./);
  });
});

test.describe("the buyer's target price is protected, not stripped", () => {
  test("is labelled TARGET PRICE, optional, and never required", async ({ page }) => {
    /*
       Criterion 5. The no-price rule governs what *sellers* publish on *public*
       surfaces; a buyer stating their own budget on their own line inside a
       private composer is the same class of private figure as a QuoteLine.
    */
    await page.goto(`/rfq/new?products=${SEED_PRODUCT}`);
    const header = page.getByRole("columnheader", { name: "TARGET PRICE" });
    await expect(header).toBeVisible();

    const headers = await page.locator("table th[scope=col]").allInnerTexts();
    expect(headers.join(" ")).not.toMatch(/\bBUDGET\b/);
    // Never renamed to a bare "PRICE".
    expect(headers.filter((h) => h.trim() === "PRICE")).toHaveLength(0);

    // Blank is fine: Send does not depend on it.
    await expect(page.getByText(/Only the sellers you pick see it/)).toBeVisible();
  });
});

test.describe("what the page must not contain", () => {
  test("has no cart, basket or checkout anywhere", async ({ page }) => {
    await page.goto("/rfq/new");
    const html = (await page.locator("main").innerHTML()).toLowerCase();
    for (const banned of ["add to cart", "basket", "checkout", "add to bag"]) {
      expect(html).not.toContain(banned);
    }
  });

  test("is noindex, follow, and has no site footer", async ({ page }) => {
    // Criterion 15. A composer has nothing to index, and the footer would
    // offer twelve ways to abandon the task.
    await page.goto("/rfq/new");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );
    await expect(page.locator("footer")).toHaveCount(0);
  });
});

test.describe("accessibility and structure", () => {
  test("one h1, a real items table, and axe clean", async ({ page }) => {
    await page.goto(`/rfq/new?products=${SEED_PRODUCT}`);
    await expect(page.locator("h1")).toHaveCount(1);
    // Criterion 16: a real table, not divs.
    await expect(page.locator("table thead th[scope=col]").first()).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
      .disableRules(["color-contrast"])
      .analyze();
    expect(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.length }))).toEqual([]);
  });
});

test.describe("a draft survives leaving the page", () => {
  test("comes back filled", async ({ page }) => {
    // Criterion 11: a buyer who goes to check a spec must not return to an
    // empty form.
    await page.goto("/rfq/new");
    await rows(page).first().locator("input").first().fill("Butterfly valve DN100, PN16");
    await expect(page.getByText("2 / 3")).toBeVisible();

    await page.goto("/");
    await page.goto("/rfq/new");

    await expect(rows(page).first().locator("input").first()).toHaveValue(
      "Butterfly valve DN100, PN16",
    );
    await expect(page.getByText("2 / 3")).toBeVisible();
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("Send is a sticky 44px bar carrying the live count", async ({ page }) => {
    // Criterion 15's second half.
    await page.goto(`/rfq/new?products=${SEED_PRODUCT}`);
    const bar = page.locator("div.fixed.bottom-0");
    await expect(bar).toBeVisible();

    const send = bar.getByRole("button", { name: /^Send/ });
    expect((await send.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await expect(send).toContainText(/Send to \d+ seller/);

    const overflow = await page.evaluate(
      () => document.body.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("the pages that lead here, and the ones that must not", () => {
  test("1d and 1e compose in place rather than linking to the fan-out", async ({ page }) => {
    /*
       Criterion 3. Those are single-seller surfaces: a buyer on a storefront
       has already chosen, and sending them to a fan-out undoes the choice.
    */
    for (const url of [
      "/b/al-marwan-industrial-supplies-llc",
      "/b/al-marwan-industrial-supplies-llc/products",
    ]) {
      await page.goto(url);
      const hrefs = await page.$$eval("main a[href]", (links) =>
        links.map((l) => l.getAttribute("href") ?? ""),
      );
      expect(hrefs.filter((h) => h.startsWith("/rfq"))).toEqual([]);
    }
  });
});
