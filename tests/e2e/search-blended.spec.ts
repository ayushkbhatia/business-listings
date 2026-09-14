import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Board `1c-s` — blended search, against the seed's VAT firms.
 *
 * `prisma/seed-blended-search.mts` puts four practices under *VAT & tax
 * advisory* and one software seller beside them. The assertions read the
 * numbers off the page and check them against each other rather than against
 * constants, because the board's defect was never a wrong total: it was a
 * header, four tabs and a rail that each answered a different query.
 */

const DUBAI = "/search?q=vat+return+filing&emirate=dubai";

/** The tab row's four counts, by name. A tab that is not drawn reads as absent. */
async function tabs(page: Page): Promise<Record<string, number>> {
  const row = page.getByLabel("Result kinds");
  const out: Record<string, number> = {};
  for (const link of await row.getByRole("link").all()) {
    const text = (await link.textContent()) ?? "";
    const match = text.match(/^(All|Services|Businesses|Products)(\d*)$/);
    if (match) out[match[1]!] = Number(match[2] || 0);
  }
  return out;
}

async function headerCount(page: Page): Promise<number> {
  const text = (await page.getByRole("heading", { level: 1 }).textContent()) ?? "";
  return Number(text.match(/^([\d,]+) results?/)?.[1]?.replace(/,/g, "") ?? Number.NaN);
}

/** The rail, wherever this width puts it. */
async function openRail(page: Page) {
  const trigger = page.getByRole("button", { name: /^Filters/ });
  if (await trigger.isVisible().catch(() => false)) {
    await trigger.click();
    return page.locator("dialog[open]").getByRole("complementary", { name: "Filters" });
  }
  return page.getByRole("complementary", { name: "Filters" }).first();
}

test.describe("one set, three shapes", () => {
  test("the header is the sum of the tabs, and all three shapes are in the blend", async ({ page }) => {
    await page.goto(DUBAI);
    const counts = await tabs(page);

    expect(counts.All).toBeGreaterThan(0);
    expect((counts.Services ?? 0) + (counts.Businesses ?? 0) + (counts.Products ?? 0)).toBe(counts.All);
    expect(await headerCount(page)).toBe(counts.All);

    const list = page.getByRole("region", { name: "Results" });
    await expect(list.locator('[data-result-kind="service"]').first()).toBeVisible();
    await expect(list.locator('[data-result-kind="business"]').first()).toBeVisible();
    // B4 — the product stays in the blended list, in goods vocabulary.
    const product = list.locator('[data-result-kind="product"]').first();
    await expect(product).toBeVisible();
    await expect(product.getByText("Price on enquiry")).toBeVisible();
    await expect(product.getByText("In stock")).toBeVisible();
    await expect(page.getByText(/products? also match/)).toBeVisible();
  });

  test("every service reads Fee on enquiry, and no amount appears anywhere", async ({ page }) => {
    await page.goto(DUBAI);
    const services = page.locator('[data-result-kind="service"]');
    const count = await services.count();
    for (let index = 0; index < count; index += 1) {
      await expect(services.nth(index).getByText("Fee on enquiry")).toBeVisible();
    }
    await expect(page.getByRole("region", { name: "Results" }).getByText(/AED\s?\d/)).toHaveCount(0);
  });

  test("the rail has no price filter and no stock filter", async ({ page }) => {
    await page.goto(DUBAI);
    const rail = await openRail(page);
    await expect(rail.getByText("Fee basis", { exact: true })).toBeVisible();
    for (const absent of ["Price", "Availability", "Stock", "Verification"]) {
      await expect(rail.getByText(absent, { exact: true })).toHaveCount(0);
    }
  });

  test("a business row says why it is there", async ({ page }) => {
    await page.goto(DUBAI);
    const ardent = page
      .locator('[data-result-kind="business"]')
      .filter({ has: page.getByRole("heading", { name: "Ardent Audit & Advisory" }) });
    await expect(ardent.getByText(/Matched on a service they offer/)).toBeVisible();
    await expect(ardent.getByText("+ 4 more")).toBeVisible();
    await expect(ardent.getByText("6 services listed.", { exact: false })).toBeVisible();
  });
});

test.describe("the correction — a filter on screen that every count agrees with", () => {
  test("the accreditation filter narrows the header, the tabs and the rail together", async ({ page }) => {
    await page.goto(DUBAI);
    const before = await tabs(page);

    const rail = await openRail(page);
    await rail.getByRole("link", { name: /^FTA registered tax agent/ }).click();
    await expect(page).toHaveURL(/credential=fta_tax_agent/);

    const after = await tabs(page);
    expect(after.All).toBeLessThanOrEqual(before.All!);
    expect((after.Services ?? 0) + (after.Businesses ?? 0) + (after.Products ?? 0)).toBe(after.All);
    expect(await headerCount(page)).toBe(after.All);

    // The header names the filter rather than counting it.
    await expect(page.getByText("Dubai · FTA registered tax agent")).toBeVisible();

    // A ticked credential counts the whole filtered set.
    const railAfter = await openRail(page);
    const option = railAfter.getByRole("link", { name: /^FTA registered tax agent/ });
    await expect(option).toHaveAttribute("aria-current", "true");
    expect(Number((await option.textContent())?.match(/(\d+)$/)?.[1])).toBe(after.All);
  });

  test("a tab narrows the same set — the counts do not move", async ({ page }) => {
    await page.goto(DUBAI);
    const before = await tabs(page);
    await page.getByLabel("Result kinds").getByRole("link", { name: /^Services/ }).click();
    await expect(page).toHaveURL(/kind=services/);

    expect(await tabs(page)).toEqual(before);
    const kinds = await page.locator("[data-result-kind]").evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-result-kind")),
    );
    expect(kinds.length).toBe(before.Services);
    expect(new Set(kinds)).toEqual(new Set(["service"]));
  });

  test("filters that empty the list keep the rail and name the one to drop", async ({ page }) => {
    await page.goto(`${DUBAI}&credential=fta_tax_agent&delivered=on_site`);
    await expect(page.getByRole("heading", { name: "No results with these filters" })).toBeVisible();
    await expect(page.getByLabel("Result kinds").getByRole("link")).toHaveCount(1);

    await page.getByRole("link", { name: /^Clear Delivered/ }).click();
    await expect(page).not.toHaveURL(/delivered=/);
    expect(await headerCount(page)).toBeGreaterThan(0);
  });
});

test.describe("coverage resolves per service", () => {
  test("a firm whose only service is narrowed to Sharjah is not a Dubai result", async ({ page }) => {
    await page.goto(DUBAI);
    await expect(page.getByRole("heading", { name: "Saqr Tax Consultants" })).toHaveCount(0);

    await page.goto("/search?q=vat+return+filing&emirate=sharjah");
    await expect(page.getByRole("heading", { name: "Saqr Tax Consultants" })).toBeVisible();
  });
});

test.describe("which page /search renders", () => {
  test("words that find no service keep goods search", async ({ page }) => {
    await page.goto("/search?q=valve");
    await expect(page.getByLabel("Result kinds")).toHaveCount(0);
  });

  test("the RFQ prompt sits above the results and opens a brief", async ({ page }) => {
    await page.goto(DUBAI);
    const prompt = page.getByRole("link", { name: "Post a requirement" });
    await expect(prompt).toBeVisible();
    await expect(prompt).toHaveAttribute("href", /\/rfq\/new\?category=vat-and-tax&kind=services&emirate=dubai/);
  });
});

test.describe("axe", () => {
  for (const route of [DUBAI, `${DUBAI}&credential=fta_tax_agent&kind=services`, `${DUBAI}&delivered=on_site&credential=fta_tax_agent`]) {
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
        first: v.nodes[0]?.html?.slice(0, 120),
      }));
      expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
    });
  }
});
