import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Boards `1c-s`, `10c` and `10c-s` — search results, against the seed's VAT
 * firms and its valve catalogue.
 *
 * `prisma/seed-blended-search.mts` puts four practices under *VAT & tax
 * advisory* and one software seller beside them. The assertions read the
 * numbers off the page and check them against each other rather than against
 * constants, because the defect was never a wrong total: it was a header, four
 * tabs and a rail that each answered a different query.
 */

const DUBAI = "/search?q=vat+return+filing&emirate=dubai";

/** The tab row's four counts, by name. A tab that is not drawn reads as absent. */
async function tabs(page: Page): Promise<Record<string, number>> {
  const row = page.getByLabel("Result kinds");
  const out: Record<string, number> = {};
  for (const link of await row.getByRole("link").all()) {
    const text = (await link.textContent()) ?? "";
    const match = text.match(/^(Everything|Products|Services|Suppliers)(\d*)$/);
    if (match) out[match[1]!] = Number(match[2] || 0);
  }
  return out;
}

async function headerCount(page: Page): Promise<number> {
  const text = (await page.getByRole("heading", { level: 1 }).textContent()) ?? "";
  return Number(text.match(/^([\d,]+) results?/)?.[1]?.replace(/,/g, "") ?? Number.NaN);
}

/**
 * The rail, wherever this width puts it.
 *
 * The column is asked about first, not the drawer trigger. Both are in the DOM
 * at every width — a `<dialog>` cannot share a subtree with a column — and the
 * trigger resolves before CSS has hidden it above `lg`, so a check that starts
 * there clicks a button that is about to become invisible and then waits thirty
 * seconds for it.
 */
async function openRail(page: Page) {
  const column = page.getByRole("complementary", { name: "Filters" }).first();
  if (await column.isVisible().catch(() => false)) return column;
  /*
     The drawer needs JavaScript to open, and a click that lands before the
     island has hydrated does nothing at all — which is what a second call on a
     freshly navigated page does. Retry the click until the dialog is actually
     open. The facet links inside it are anchors either way, so this is the
     harness waiting for hydration, not the page needing it.
  */
  const dialog = page.locator("dialog[open]");
  await expect(async () => {
    await page.getByRole("button", { name: /^Filters/ }).click();
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  return dialog.getByRole("complementary", { name: "Filters" });
}

test.describe("one set, three shapes", () => {
  test("the header is the count of the list, and both kinds are in the blend", async ({ page }) => {
    await page.goto(DUBAI);
    const counts = await tabs(page);

    expect(counts.Everything).toBeGreaterThan(0);
    /*
       `B2`. Everything is the things, plus any firm nothing else in the set
       represents — never the things plus every one of their sellers, and never
       a number the two kind counts add up past.
    */
    expect(counts.Everything).toBeGreaterThanOrEqual((counts.Services ?? 0) + (counts.Products ?? 0));
    expect(await headerCount(page)).toBe(counts.Everything);
    expect(counts.Suppliers).toBeGreaterThan(0);

    const list = page.getByRole("region", { name: "Results" });
    await expect(list.locator('[data-result-kind="service"]').first()).toBeVisible();
    // `1c-s` B4 — the product stays in the blended list, in goods vocabulary.
    const product = list.locator('[data-result-kind="product"]').first();
    await expect(product).toBeVisible();
    await expect(product.getByText("Price on enquiry")).toBeVisible();
    await expect(product.getByText("In stock")).toBeVisible();
    await expect(page.getByText(/products? also match/)).toBeVisible();
  });

  test("states the model rather than leaving it to be inferred", async ({ page }) => {
    await page.goto(DUBAI);
    await expect(page.getByText("These filter one list. They are not separate pages.")).toBeVisible();
    // `B2` said out loud, so 44 + 71 is never read as 96.
    await expect(page.getByText(/from \d+ supplier/).first()).toBeVisible();
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

  test("`B6` — one CTA string, both kinds", async ({ page }) => {
    await page.goto(DUBAI);
    const list = page.getByRole("region", { name: "Results" });
    await expect(list.getByRole("link", { name: /^Ask for a quote/ }).first()).toBeVisible();
    await expect(list.getByRole("link", { name: /^Enquire$/ })).toHaveCount(0);
  });

  test("a supplier row says what the firm returned on this query", async ({ page }) => {
    await page.goto(`${DUBAI}&kind=suppliers`);
    const ardent = page
      .locator('[data-result-kind="supplier"]')
      .filter({ has: page.getByRole("heading", { name: "Ardent Audit & Advisory" }) });
    await expect(ardent.getByText(/services? match/)).toBeVisible();
    await expect(ardent.getByText(/Matched on a service they offer/)).toBeVisible();
    await expect(ardent.getByText("+ 4 more")).toBeVisible();
    await expect(ardent.getByText("6 services listed.", { exact: false })).toBeVisible();
  });
});

test.describe("the three-part rail", () => {
  test("names its parts and states the rule that keeps the blend together", async ({ page }) => {
    await page.goto(DUBAI);
    const rail = await openRail(page);
    await expect(rail.getByText("Applies to everything")).toBeVisible();
    await expect(rail.getByText("Narrows to services")).toBeVisible();
    await expect(
      rail.getByText(/We switch it for you rather than returning nothing/).first(),
    ).toBeVisible();
  });

  test("has no price filter — the one field neither kind carries", async ({ page }) => {
    await page.goto(DUBAI);
    const rail = await openRail(page);
    await expect(rail.getByText("Fee basis", { exact: true })).toBeVisible();
    for (const absent of ["Price", "Price range"]) {
      await expect(rail.getByText(absent, { exact: true })).toHaveCount(0);
    }
  });

  test("`B3` — a kind-specific facet switches the tab instead of returning nothing", async ({ page }) => {
    await page.goto(`${DUBAI}&kind=services&availability=in_stock`);
    const active = page.getByLabel("Result kinds").getByRole("link", { name: /Products/ });
    await expect(active).toHaveAttribute("aria-current", "page");
    const kinds = await page.locator("[data-result-kind]").evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-result-kind")),
    );
    expect(new Set(kinds)).toEqual(new Set(["product"]));
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
    expect(after.Everything).toBeLessThanOrEqual(before.Everything!);
    expect(await headerCount(page)).toBe(after.Everything);

    // The header names the filter rather than counting it.
    await expect(page.getByText("Dubai · FTA registered tax agent")).toBeVisible();

    // A ticked credential counts the whole filtered set.
    const railAfter = await openRail(page);
    const option = railAfter.getByRole("link", { name: /^FTA registered tax agent/ });
    await expect(option).toHaveAttribute("aria-current", "true");
    expect(Number((await option.textContent())?.match(/(\d+)$/)?.[1])).toBe(after.Services);
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
});

test.describe("B9 — three zero states, and only one of them gets the ladder", () => {
  test("filters that empty the list keep the rail, price the escape and name the miss", async ({ page }) => {
    await page.goto(`${DUBAI}&credential=fta_tax_agent&delivered=on_site`);
    await expect(page.getByRole("heading", { name: /^Nothing matches/ })).toBeVisible();

    // The ladder, priced.
    const rung = page.getByRole("link", { name: /^Show \d/ }).first();
    await expect(rung).toBeVisible();
    await expect(page.getByText(/^Drop the /).first()).toBeVisible();

    // `B10` — the escape counts the trade, not the filters that returned nothing.
    await expect(page.getByText(/They match the trade and what they do/)).toBeVisible();
    // `B11` — and the miss is recorded where it becomes a recruitment target.
    await expect(page.getByText(/lands in the gap report/)).toBeVisible();

    await rung.click();
    expect(await headerCount(page)).toBeGreaterThan(0);
  });

  test("nothing in this kind shows no ladder — it offers the kinds that matched", async ({ page }) => {
    await page.goto("/search?q=statutory+audit&kind=products");
    await expect(page.getByRole("heading", { name: /^Nothing under Products/ })).toBeVisible();
    await expect(page.getByText(/^Drop the /)).toHaveCount(0);
    await expect(page.getByText(/lands in the gap report/)).toHaveCount(0);
    const switchTo = page.getByRole("link", { name: /^Show Services — \d/ });
    await expect(switchTo).toBeVisible();
    await switchTo.click();
    await expect(page).toHaveURL(/kind=services/);
    await expect(page.locator('[data-result-kind="service"]').first()).toBeVisible();
  });

  test("an option that leads nowhere is drawn with its nought and is not a link", async ({ page }) => {
    await page.goto(`${DUBAI}&credential=fta_tax_agent&delivered=on_site`);
    const rail = await openRail(page);
    const dead = rail.locator('[aria-disabled="true"]');
    expect(await dead.count()).toBeGreaterThan(0);
    await expect(dead.first()).toContainText("0");
  });
});

test.describe("coverage resolves per service", () => {
  test("a firm whose only service is narrowed to Sharjah is not a Dubai result", async ({ page }) => {
    await page.goto(`${DUBAI}&kind=suppliers`);
    await expect(page.getByRole("heading", { name: "Saqr Tax Consultants" })).toHaveCount(0);

    await page.goto("/search?q=vat+return+filing&emirate=sharjah&kind=suppliers");
    await expect(page.getByRole("heading", { name: "Saqr Tax Consultants" })).toBeVisible();
  });
});

test.describe("which page /search renders", () => {
  test("every query with words gets the one blended screen — D1", async ({ page }) => {
    await page.goto("/search?q=valve");
    await expect(page.getByLabel("Result kinds")).toBeVisible();
    await page.goto("/search?q=vat+return+filing");
    await expect(page.getByLabel("Result kinds")).toBeVisible();
  });

  test("a browse with no words keeps the map", async ({ page }) => {
    await page.goto("/search?emirate=dubai");
    await expect(page.getByLabel("Result kinds")).toHaveCount(0);
  });

  test("the RFQ prompt sits above the results and opens a brief", async ({ page }) => {
    await page.goto(DUBAI);
    const prompt = page.getByRole("link", { name: "Post a requirement" });
    await expect(prompt.first()).toBeVisible();
    await expect(prompt.first()).toHaveAttribute("href", /\/rfq\/new\?category=vat-and-tax&kind=services&emirate=dubai/);
  });
});

test.describe("`10c`'s contributions, on the blended screen", () => {
  test("states that the match is on spec fields, not only names", async ({ page }) => {
    await page.goto("/search?q=DN100");
    await expect(page.getByText(/Matched on spec fields/)).toBeVisible();
  });

  test("Q3 — one cross-kind order, and most complete specs only in the products scope", async ({ page }) => {
    await page.goto("/search?q=valve");
    const sort = page.getByRole("navigation", { name: "Order these results" });
    await expect(sort.getByRole("link", { name: "Most relevant" })).toHaveAttribute("aria-current", "true");
    await expect(sort.getByRole("link", { name: "Most complete specs" })).toHaveCount(0);

    await page.goto("/search?q=valve&kind=products");
    const inScope = page.getByRole("navigation", { name: "Order these results" });
    await expect(inScope.getByRole("link", { name: "Most complete specs" })).toBeVisible();
    await inScope.getByRole("link", { name: "Most complete specs" }).click();
    await expect(page).toHaveURL(/sort=specs/);
    await expect(page.locator('[data-result-kind="product"]').first()).toBeVisible();
  });

  test("Q5 — the pager states the window and goes both ways", async ({ page }) => {
    await page.goto("/search?q=valve&kind=products");
    const pager = page.getByRole("navigation", { name: "Result pages" });
    await expect(pager).toBeVisible();
    await expect(pager.getByText(/^Showing 1–/)).toBeVisible();
    const next = pager.getByRole("link", { name: "Next" });
    if ((await next.count()) > 0) {
      await next.click();
      await expect(page).toHaveURL(/page=2/);
      await expect(page.getByRole("navigation", { name: "Result pages" }).getByRole("link", { name: "Previous" })).toBeVisible();
    }
  });

  test("B8/Q1 — compare ticks a product, never a supplier or a service", async ({ page }) => {
    /*
       Board `10d` made the comparison products-only: the rows come from one
       spec template, and neither a supplier nor a service has one. The tray
       is a cookie now, so a tick leaves the URL as it was.
    */
    await page.goto("/search?q=valve&kind=products");
    const tick = page.locator("[data-compare-product]").first();
    await expect(tick).toBeVisible();
    await tick.click();
    await expect(tick).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("region", { name: "Comparison tray" })).toBeVisible();
    await expect(page).not.toHaveURL(/compare=/);

    await page.goto("/search?q=valve&kind=suppliers");
    await expect(page.locator("[data-compare-product]")).toHaveCount(0);

    await page.goto("/search?q=vat+return+filing&kind=services");
    await expect(page.locator("[data-compare-product]")).toHaveCount(0);
  });
});

test.describe("axe", () => {
  for (const route of [
    DUBAI,
    `${DUBAI}&credential=fta_tax_agent&kind=services`,
    `${DUBAI}&delivered=on_site&credential=fta_tax_agent`,
    "/search?q=valve&kind=products",
    "/search?q=statutory+audit&kind=products",
  ]) {
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
