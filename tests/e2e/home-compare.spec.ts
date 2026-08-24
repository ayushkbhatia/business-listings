import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/** Handoff 1, step 5. Home and the comparison tray. */

const A = "al-marwan-industrial-supplies-llc";
const B = "al-manara-equipment-trading-llc";

test.describe("home", () => {
  test("says the number rather than describing it", async ({ page }) => {
    await page.goto("/");
    const body = (await page.textContent("body")) ?? "";
    // Voice rule: "218 suppliers in Al Quoz", never "many suppliers".
    expect(body).not.toMatch(/\b(many|lots of|hundreds of|thousands of) (suppliers|businesses)\b/i);
    expect(body).toMatch(/\d+ licensed UAE businesses/);
  });

  test("search works as a plain GET form, before any JavaScript", async ({ page }) => {
    await page.goto("/");
    const form = page.locator('form[action="/search"][method="get"]');
    await expect(form).toHaveCount(1);
    await expect(form.locator('input[name="q"]')).toHaveCount(1);
  });

  test("carries every home category through to a real category page", async ({ page }) => {
    await page.goto("/");
    const hrefs = await page.$$eval('a[href^="/c/"]', (links) =>
      [...new Set(links.map((l) => l.getAttribute("href")!))],
    );
    expect(hrefs.length).toBeGreaterThan(3);
    for (const href of hrefs) {
      const response = await page.request.get(href);
      expect(response.status(), href).toBe(200);
    }
  });

  test("renders no price", async ({ page }) => {
    await page.goto("/");
    expect((await page.textContent("body")) ?? "").not.toMatch(/AED\s*[\d,]/);
  });

  test("has no dead links anywhere in the chrome", async ({ page }) => {
    await page.goto("/");
    const hrefs = await page.$$eval("a[href^='/']", (links) =>
      [...new Set(links.map((l) => l.getAttribute("href")!))],
    );
    for (const href of hrefs) {
      const response = await page.request.get(href);
      expect(response.status(), href).toBeLessThan(400);
    }
  });

  test("names unbuilt routes without linking to them", async ({ page }) => {
    await page.goto("/");
    // docs/routes.md says a later route is named so the nav is shaped right.
    // Named, not linked — a dead link is worse than an honest greyed one.
    //
    // The footer names its four on every width. The nav's own three live in a
    // `hidden lg:flex` list, so below 1024 they are not shown at all — which is
    // the design, not a regression. Asserting visibility on both projects made
    // this test fail on mobile for doing exactly what it should.
    const footer = ["Terms", "Privacy"];
    const nav = ["Pricing", "Guides"];
    const width = page.viewportSize()?.width ?? 0;
    const shown = width >= 1024 ? [...footer, ...nav] : footer;

    for (const label of shown) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    // Never a link, at any width — that part does not depend on the viewport.
    for (const label of [...footer, ...nav]) {
      await expect(page.getByRole("link", { name: label, exact: true })).toHaveCount(0);
    }
  });
});

test.describe("compare", () => {
  test("is a real feature, and the enquire-all action reaches the fan-out", async ({ page }) => {
    await page.goto(`/compare?p=${A},${B}`);
    const table = page.getByRole("table", { name: /compared side by side/ });
    await expect(table).toBeVisible();

    // Board 10d's "Enquire with all 4", live from handoff 2 step 3. Every
    // compared supplier is pinned so the fan-out keeps them.
    const enquire = page.getByRole("link", { name: /Send one enquiry/ });
    await expect(enquire).toBeVisible();
    await expect(enquire).toHaveAttribute("href", new RegExp(`/rfq/new\\?to=.*${A}`));
  });

  test("is real table markup, transposed", async ({ page }) => {
    await page.goto(`/compare?p=${A},${B}`);
    const table = page.locator("table").first();
    // Suppliers are columns, attributes are rows — so both scopes are used.
    expect(await table.locator('th[scope="col"]').count()).toBe(3);
    expect(await table.locator('th[scope="row"]').count()).toBeGreaterThan(6);
    await expect(table.locator("caption")).toHaveCount(1);
  });

  test("compares no prices, because none exist", async ({ page }) => {
    await page.goto(`/compare?p=${A},${B}`);
    const body = (await page.textContent("body")) ?? "";
    expect(body).not.toMatch(/AED\s*[\d,]/);
    expect(body).toMatch(/quotes you privately/);
  });

  test("removing a supplier keeps the rest", async ({ page }) => {
    await page.goto(`/compare?p=${A},${B}`);
    await page.getByLabel(/Remove Al Marwan.*from the comparison/).click();
    await expect(page).toHaveURL(new RegExp(`p=${B}`));
    await expect(page.getByRole("link", { name: "Al Marwan Industrial Supplies" })).toHaveCount(0);
  });

  test("caps the tray rather than rendering an unreadable table", async ({ page }) => {
    await page.goto(`/compare?p=a,b,c,d,e,f`);
    // Six requested, at most four columns plus the attribute head.
    const cols = await page.locator('th[scope="col"]').count();
    expect(cols).toBeLessThanOrEqual(5);
  });

  test("has a designed empty state", async ({ page }) => {
    await page.goto("/compare");
    await expect(page.getByRole("heading", { name: "Nothing to compare yet" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Browse the directory" })).toBeVisible();
  });
});

test.describe("the tray accumulates in the URL", () => {
  test("adding from results keeps the buyer on the results page", async ({ page }) => {
    await page.goto("/c/valves-and-fittings");
    await page.getByRole("link", { name: "Compare", exact: true }).first().click();
    await expect(page).toHaveURL(/compare=/);
    await expect(page).toHaveURL(/\/c\/valves-and-fittings/);
    await expect(page.getByText(/supplier selected/)).toBeVisible();
  });

  test("adding a second supplier preserves the first and every facet", async ({ page }) => {
    await page.goto("/c/valves-and-fittings?tier=2");
    await page.getByRole("link", { name: "Compare", exact: true }).first().click();
    await page.getByRole("link", { name: "Compare", exact: true }).first().click();
    await expect(page.getByText(/2 suppliers selected/)).toBeVisible();
    await expect(page).toHaveURL(/tier=2/);
  });

  test("the tray opens the comparison", async ({ page }) => {
    await page.goto(`/c/valves-and-fittings?compare=${A}`);
    await page.getByRole("link", { name: "Compare them" }).click();
    await expect(page).toHaveURL(/\/compare\?p=/);
    await expect(page.getByRole("table")).toBeVisible();
  });
});

test.describe("axe", () => {
  for (const route of ["/", `/compare?p=${A},${B}`, "/compare"]) {
    test(`is clean on ${route}`, async ({ page }) => {
      await page.goto(route);
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
    });
  }
});
