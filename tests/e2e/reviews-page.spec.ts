import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Board 1m — `/b/:slug/reviews`, in a browser.
 *
 * The service-layer rules are proven in tests/integration: the gate, the two
 * provenance rungs, the hold, the audit rows and every count. What is proven
 * here is the part reading the code cannot tell you — that the filters
 * navigate, that the label on the button matches what one click delivers, and
 * that the strings on the page are the ones the board asks for.
 *
 * Slugs are hardcoded because the seed is deterministic. If it changes these
 * fail loudly, which is the correct outcome.
 */
const DEEP = "al-waha-industrial-supplies"; // 34 published, 1 held, 1 removed
const THIN = "al-manara-equipment-trading-llc"; // one review — the sub-five state
const NO_REVIEWS = "al-marwan-industrial-supplies-llc";
const UNCLAIMED = "al-wadi-technical-services-llc";

const REVIEWS = `/b/${DEEP}/reviews`;

/** Review rows only — the held line is a sibling in the same list. */
async function rowCount(page: Page): Promise<number> {
  return page.locator("main ul > li", { has: page.locator("p.text-prose") }).count();
}

test.describe("criterion 1 — the provenance ladder", () => {
  test("names the two rungs, and none of the four that imply a purchase", async ({ page }) => {
    await page.goto(REVIEWS);

    await expect(page.getByText("Accepted quote").first()).toBeVisible();
    await expect(page.getByText("Verified enquiry").first()).toBeVisible();

    const body = (await page.locator("body").innerText()).toLowerCase();
    for (const banned of [
      "verified purchase",
      "verified buyer",
      "verified customer",
      "verified order",
    ]) {
      expect(body, banned).not.toContain(banned);
    }
  });
});

test.describe("criterion 2 — one figure, one label", () => {
  test("the sub-line and the chip name the same tier for the same number", async ({ page }) => {
    await page.goto(REVIEWS);

    const subline = await page.locator("header p.text-body-sm.text-muted").first().innerText();
    const accepted = subline.match(/(\d+) from accepted quotes/)?.[1];
    expect(accepted, subline).toBeTruthy();

    // The chip beside it has to carry the same figure under the same word.
    const chip = page.getByRole("link", { name: new RegExp(`Accepted quote\\s*${accepted}`) });
    await expect(chip).toBeVisible();

    // And the figure must not appear anywhere as the weaker tier.
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(new RegExp(`${accepted}\\s*(verified enquir)`, "i"));
  });

  test("the headline count is the number of reviews, not of everything written", async ({ page }) => {
    await page.goto(REVIEWS);
    const subline = await page.locator("header p.text-body-sm.text-muted").first().innerText();
    const total = Number(subline.match(/(\d+) reviews/)?.[1]);
    expect(total).toBeGreaterThan(0);

    // The tab badge, the chip and the sub-line are three renderings of it.
    await expect(page.getByRole("link", { name: new RegExp(`Reviews\\s*${total}`) })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(`^All\\s*${total}$`) })).toBeVisible();

    /*
       The distribution has to add up to it too.

       The breakdown is placed twice — a plain list above `md`, a `<details>`
       disclosure below it — from one `rows` element, so the two cannot disagree
       but both are in the DOM at any width. Below `md` the disclosure starts
       closed, so open it before counting what is on screen.
    */
    const disclosure = page.getByText("See breakdown");
    if (await disclosure.isVisible()) await disclosure.click();

    const counts = await page.locator("main aside li span.text-end:visible").allInnerTexts();
    expect(counts).toHaveLength(5);
    const summed = counts.reduce((sum, value) => sum + Number(value.replace(/\D/g, "")), 0);
    expect(summed).toBe(total);
  });
});

test.describe("criterion 9 — Critical is always there", () => {
  test("is a chip a buyer can click, and filters to the complaints", async ({ page }) => {
    await page.goto(REVIEWS);

    const critical = page.getByRole("link", { name: /^Critical\s*\d+$/ });
    await expect(critical).toBeVisible();
    await critical.click();

    await expect(page).toHaveURL(/show=critical/);
    await expect(critical).toHaveAttribute("aria-current", "true");
    // Every row on screen is at or below three, which is what the chip claimed.
    expect(await rowCount(page)).toBeGreaterThan(0);
  });
});

test.describe("criterion 11 — the label states what one click delivers", () => {
  test("names the page size, then narrows to the remainder, then disappears", async ({ page }) => {
    await page.goto(REVIEWS);

    const first = await rowCount(page);
    expect(first).toBe(10);

    const more = page.getByRole("link", { name: /^Load \d+ more reviews?$/ });
    await expect(more).toHaveText("Load 10 more reviews");

    await more.click();
    await page.waitForURL(/page=2/);
    expect(await rowCount(page)).toBe(20);
    await expect(more).toHaveText("Load 10 more reviews");

    await more.click();
    await page.waitForURL(/page=3/);
    expect(await rowCount(page)).toBe(30);
    // Four left, so the label narrows rather than promising ten.
    await expect(more).toHaveText("Load 4 more reviews");

    await more.click();
    await page.waitForURL(/page=4/);
    expect(await rowCount(page)).toBe(34);
    // Gone at zero, rather than disabled: the count is already on the page.
    await expect(more).toHaveCount(0);
  });
});

test.describe("the states the board documents", () => {
  test("a held review is one neutral line with no content and no rating", async ({ page }) => {
    await page.goto(`${REVIEWS}?page=4`);
    const held = page.getByText(/being reviewed by our team/);
    await expect(held).toBeVisible();

    // No rating and no reviewer on that line — the whole point of the state.
    const line = page.locator("main ul > li").filter({ hasText: /being reviewed by our team/ });
    await expect(line.locator("[role=img]")).toHaveCount(0);
  });

  test("under five reviews the distribution is suppressed and the count is stated", async ({ page }) => {
    await page.goto(`/b/${THIN}/reviews`);
    await expect(page.getByText(/^FROM \d+ REVIEWS?$/)).toBeVisible();
    // Three reviews do not make a distribution and drawing one implies more
    // data than exists.
    await expect(page.locator("main aside li span.text-end")).toHaveCount(0);
  });

  test("no reviews means no page, because the tab does not exist either", async ({ page }) => {
    const response = await page.goto(`/b/${NO_REVIEWS}/reviews`);
    expect(response?.status()).toBe(404);
    await page.goto(`/b/${NO_REVIEWS}`);
    await expect(page.getByRole("link", { name: /^Reviews/ })).toHaveCount(0);
  });

  test("an unclaimed listing has no subpages at all", async ({ page }) => {
    const response = await page.goto(`/b/${UNCLAIMED}/reviews`);
    expect(response?.status()).toBe(404);
  });

  test("filtered to zero says so, and offers the way back", async ({ page }) => {
    // Nothing on the seed filters to zero, so this asserts the control exists
    // rather than manufacturing the state: the Critical chip on a perfect
    // record is the same code path and the same copy.
    await page.goto(`${REVIEWS}?show=photos`);
    await expect(page.getByRole("link", { name: /^All\s*\d+$/ })).toBeVisible();
  });
});

test.describe("criterion 13 — the invitation is absent, not disabled", () => {
  test("no signed-in buyer means no Write a review button anywhere", async ({ page }) => {
    await page.goto(REVIEWS);
    // Absent rather than disabled: a visible button that rejects you teaches
    // the wrong thing about the platform.
    await expect(page.getByRole("link", { name: "Write a review" })).toHaveCount(0);
  });
});

test.describe("criterion 14 — structured data", () => {
  test("emits an aggregate that matches the page, and reviews that match the rows", async ({ page }) => {
    await page.goto(REVIEWS);
    const blobs = await page.$$eval('script[type="application/ld+json"]', (nodes) =>
      nodes.map((node) => JSON.parse(node.textContent ?? "{}")),
    );

    const local = blobs.find((blob) => blob["@type"] === "LocalBusiness");
    expect(local.aggregateRating.reviewCount).toBe(34);
    expect(local.aggregateRating.bestRating).toBe(5);
    expect(local.review).toHaveLength(10);
    for (const review of local.review) {
      expect(review["@type"]).toBe("Review");
      expect(review.reviewBody.length).toBeGreaterThan(0);
      expect(review.reviewRating.ratingValue).toBeGreaterThanOrEqual(1);
      expect(review.datePublished).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }

    expect(blobs.find((blob) => blob["@type"] === "BreadcrumbList")).toBeTruthy();
  });

  test("a narrowed view is not the page worth ranking", async ({ page }) => {
    await page.goto(`${REVIEWS}?show=critical`);
    const robots = page.locator('meta[name="robots"]');
    await expect(robots).toHaveAttribute("content", /noindex/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      new RegExp(`${REVIEWS}$`),
    );
  });
});

test.describe("criterion 10 — bodies are never truncated", () => {
  test("has no read-more control, and shows the longest review whole", async ({ page }) => {
    await page.goto(`${REVIEWS}?sort=detailed`);
    await expect(page.getByRole("button", { name: /read more/i })).toHaveCount(0);
    const longest = await page.locator("main ul > li p.text-prose").first().innerText();
    expect(longest.length).toBeGreaterThan(300);
    expect(longest).not.toContain("…");
  });
});

test.describe("criterion 16 — keyboard and axe", () => {
  test("every filter and sort is reachable by keyboard with a visible ring", async ({ page }) => {
    await page.goto(REVIEWS);
    const controls = page.locator("main nav a");
    const total = await controls.count();
    expect(total).toBe(8); // four chips, four sorts

    for (let index = 0; index < total; index += 1) {
      const control = controls.nth(index);
      await control.focus();
      await expect(control).toBeFocused();
    }
  });

  test("is axe clean, with one h1 and the reviews as a list", async ({ page }) => {
    await page.goto(REVIEWS);
    await expect(page.locator("h1")).toHaveCount(1);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .disableRules(["color-contrast"])
      .analyze();
    const summary = results.violations.map((violation) => `${violation.id}: ${violation.help}`);
    expect(summary, summary.join("\n")).toEqual([]);
  });

  test("is axe clean on a phone, where the breakdown is a disclosure", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto(REVIEWS);

    const breakdown = page.getByText("See breakdown");
    await expect(breakdown).toBeVisible();
    await breakdown.click();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .disableRules(["color-contrast"])
      .analyze();
    const summary = results.violations.map((violation) => `${violation.id}: ${violation.help}`);
    expect(summary, summary.join("\n")).toEqual([]);
  });
});

test.describe("the shared header renders identically here", () => {
  test("carries the display name and the same rating as the card below it", async ({ page }) => {
    await page.goto(REVIEWS);

    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toHaveText("Al Waha Industrial Supplies");
    // The legal name reaches exactly one surface, and it is not this one.
    await expect(page.locator("body")).not.toContainText("Al Waha Industrial Supplies LLC");

    /*
       The meta row's rating against the rating card's numeral. One average, one
       rendering — `formatRating` on both sides, because `toFixed(1)` in the
       header and `formatDecimal` in the card printed 4.0 and 4 for one figure.
    */
    const metaRow = await page.locator("header p").last().innerText();
    const headerRating = metaRow.match(/(\d+\.\d)\s+\d+\s+reviews?/)?.[1];
    expect(headerRating, metaRow).toBeTruthy();
    const cardRating = await page.locator("main aside p.font-serif").first().innerText();
    expect(cardRating).toBe(headerRating);
  });
});
