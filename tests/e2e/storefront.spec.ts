import { expect, test } from "@playwright/test";

/**
 * Handoff 1, step 3. The storefront and product routes, against the seeded
 * database.
 *
 * Slugs are hardcoded because the seed is deterministic — a fixed PRNG and a
 * fixed NOW. If the seed changes these fail loudly, which is the correct
 * outcome: the fixtures below encode the states the checkpoint asks for.
 */
const CLAIMED = "al-marwan-industrial-supplies-llc"; // tier 3, themed, 3 branches
const REVIEWED = "al-manara-equipment-trading-llc"; // the one business with a review
const UNCLAIMED = "al-wadi-technical-services-llc"; // licence import, unpinned branch

async function jsonLd(page: import("@playwright/test").Page) {
  return page.$$eval('script[type="application/ld+json"]', (nodes) =>
    nodes.map((n) => JSON.parse(n.textContent ?? "{}")),
  );
}

test.describe("one route, two compositions", () => {
  test("a claimed business renders the 1d composition", async ({ page }) => {
    await page.goto(`/b/${CLAIMED}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Al Marwan");
    // Tabs, catalogue, verification ladder — none of which the unclaimed page has.
    await expect(page.getByRole("link", { name: /Products/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Verification ladder" })).toBeVisible();
    await expect(page.getByText("has not been claimed")).toHaveCount(0);
  });

  test("an unclaimed business renders the 10g composition from the same route", async ({ page }) => {
    await page.goto(`/b/${UNCLAIMED}`);
    await expect(page.getByText("This listing has not been claimed")).toBeVisible();
    await expect(page.getByRole("button", { name: "Claim this listing" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Report this listing" })).toBeVisible();
    // No tabs, no catalogue, no ladder.
    await expect(page.getByRole("heading", { name: "Verification ladder" })).toHaveCount(0);
  });

  test("an unclaimed listing invents nothing", async ({ page }) => {
    await page.goto(`/b/${UNCLAIMED}`);
    const body = (await page.textContent("body")) ?? "";

    // No hours for a business that never told us any.
    expect(body).not.toContain("Sunday");

    // No reviews section and no rating for the subject. The word "review" does
    // appear on the page — in the footer policy link, and on the cards for the
    // claimed suppliers we point at, both of which are correct. Scoping to the
    // subject is what the rule actually says.
    await expect(page.getByRole("heading", { name: /^Reviews$/ })).toHaveCount(0);
    await expect(page.locator("[data-rating], .star, [aria-label*=star i]")).toHaveCount(0);

    // Absent fields are marked absent, not dropped.
    expect(await page.getByText("Not provided").count()).toBeGreaterThan(3);
  });

  test("an unclaimed listing offers a way out", async ({ page }) => {
    await page.goto(`/b/${UNCLAIMED}`);
    const others = await page.$$eval(`a[href^="/b/"]`, (links, self) =>
      [...new Set(links.map((l) => l.getAttribute("href")))].filter(
        (h) => h && !h.includes(self),
      ),
      UNCLAIMED,
    );
    expect(others.length).toBeGreaterThanOrEqual(2);
    // And the heading says which basis the list is on, rather than claiming
    // "same trade" over a list from a different one.
    await expect(page.getByRole("heading", { name: /Verified suppliers/ })).toBeVisible();
  });

  test("the unclaimed route has no catalogue, branches or reviews tab", async ({ page }) => {
    for (const suffix of ["products", "branches", "reviews"]) {
      const response = await page.goto(`/b/${UNCLAIMED}/${suffix}`);
      expect(response?.status(), suffix).toBe(404);
    }
  });
});

test.describe("no price on a public surface", () => {
  for (const path of [
    `/b/${CLAIMED}`,
    `/b/${CLAIMED}/products`,
    `/b/${CLAIMED}/p/resilient-seated-gate-valve-dn150-0`,
    `/b/${UNCLAIMED}`,
  ]) {
    test(`${path} renders no price`, async ({ page }) => {
      await page.goto(path);
      const body = (await page.textContent("body")) ?? "";
      expect(body).not.toMatch(/AED\s*[\d,]/);
      expect(body).not.toMatch(/\bد\.إ/);
    });
  }

  test("the product offer carries availability and no price", async ({ page }) => {
    await page.goto(`/b/${CLAIMED}/p/resilient-seated-gate-valve-dn150-0`);
    const blocks = await jsonLd(page);
    const product = blocks.find((b) => b["@type"] === "Product");
    expect(product).toBeTruthy();
    expect(product.offers.availability).toMatch(/schema\.org\/(InStock|MadeToOrder|BackOrder|OutOfStock)/);
    expect(product.offers.price).toBeUndefined();
    expect(product.offers.priceCurrency).toBeUndefined();
  });

  test("no cart or checkout route exists", async ({ page }) => {
    for (const path of ["/cart", "/checkout", "/basket"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
    }
  });
});

test.describe("structured data", () => {
  test("aggregateRating appears only when reviews exist", async ({ page }) => {
    await page.goto(`/b/${CLAIMED}`);
    const withoutReviews = (await jsonLd(page)).find((b) => b["@type"] === "LocalBusiness");
    expect(withoutReviews.aggregateRating).toBeUndefined();

    await page.goto(`/b/${REVIEWED}`);
    const withReviews = (await jsonLd(page)).find((b) => b["@type"] === "LocalBusiness");
    expect(withReviews.aggregateRating.reviewCount).toBeGreaterThan(0);
    expect(withReviews.aggregateRating.ratingValue).toBeGreaterThan(0);
  });

  test("an unclaimed listing marks up only the licence record", async ({ page }) => {
    await page.goto(`/b/${UNCLAIMED}`);
    const local = (await jsonLd(page)).find((b) => b["@type"] === "LocalBusiness");
    expect(local.aggregateRating).toBeUndefined();
    expect(local.openingHours).toBeUndefined();
    expect(local.openingHoursSpecification).toBeUndefined();
    expect(local.telephone).toBeUndefined();
    expect(local.identifier).toBeTruthy();
  });

  test("every storefront page carries a breadcrumb list", async ({ page }) => {
    for (const path of [`/b/${CLAIMED}`, `/b/${CLAIMED}/p/resilient-seated-gate-valve-dn150-0`]) {
      await page.goto(path);
      const crumbs = (await jsonLd(page)).find((b) => b["@type"] === "BreadcrumbList");
      expect(crumbs, path).toBeTruthy();
      expect(crumbs.itemListElement.length).toBeGreaterThan(2);
    }
  });
});

test.describe("maps and masking", () => {
  test("a location without coordinates never reaches the map", async ({ page }) => {
    await page.goto(`/b/${CLAIMED}/branches`);
    const branchCount = await page.getByRole("heading", { level: 2 }).count();

    const pins = await page.$$eval("figure ul.sr-only li", (nodes) => nodes.length);
    const excluded = await page
      .locator("figcaption")
      .allTextContents()
      .then((texts) => texts.join(" "));

    // Either every branch is pinned, or the ones held back are declared.
    if (pins < branchCount) {
      expect(excluded).toMatch(/no map pin/);
    }
    expect(pins).toBeLessThanOrEqual(branchCount);
  });

  test("phone numbers are masked and the reveal is inert", async ({ page }) => {
    await page.goto(`/b/${CLAIMED}`);
    const body = (await page.textContent("body")) ?? "";
    expect(body).toMatch(/•/);
    await expect(page.getByRole("button", { name: "Show number" })).toBeDisabled();
  });

  test("the TRN is masked to first three and last four", async ({ page }) => {
    await page.goto(`/b/${CLAIMED}`);
    const body = (await page.textContent("body")) ?? "";
    expect(body).toMatch(/\d{3} •••• •••• \d{4}/);
  });
});

test.describe("enquiry affordances", () => {
  test("are present, styled and disabled — never hidden", async ({ page }) => {
    await page.goto(`/b/${CLAIMED}/p/resilient-seated-gate-valve-dn150-0`);
    const enquire = page.getByRole("button", { name: /Send enquiry|Notify me/ }).first();
    await expect(enquire).toBeVisible();
    await expect(enquire).toBeDisabled();
    await expect(enquire).toHaveAttribute("title", "Enquiries open in the next release");
  });

  test("there are no dead links behind them", async ({ page }) => {
    await page.goto(`/b/${CLAIMED}`);
    const hrefs = await page.$$eval("a[href]", (links) =>
      links.map((l) => l.getAttribute("href")!).filter((h) => h.startsWith("/")),
    );
    // Every internal link on a storefront must resolve, not 404.
    for (const href of [...new Set(hrefs)].filter((h) => h.startsWith("/b/"))) {
      const response = await page.request.get(href);
      expect(response.status(), href).toBeLessThan(400);
    }
  });
});
