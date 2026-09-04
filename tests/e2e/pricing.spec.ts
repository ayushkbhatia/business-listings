import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Board 1l — `/pricing`, signed out.
 *
 * Most of what this asserts is that the page does not claim more than the
 * product does. The board says every word here is checkable against the
 * product inside a week of signing up, which makes overstatement the failure
 * mode worth a test rather than a review comment.
 *
 * The signed-in seller states are `tests/e2e/pricing-seller.spec.ts`, which
 * needs a session and therefore its own project.
 */

/** Every price the page prints, in the order it prints them. */
async function pricesOn(page: Page): Promise<string[]> {
  return page.locator("section[aria-label] .font-serif").allInnerTexts();
}

async function structuredData(page: Page): Promise<Record<string, unknown>[]> {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  return blocks.map((block) => JSON.parse(block) as Record<string, unknown>);
}

test.describe("the pricing page", () => {
  test("has one h1, and it makes the page's whole argument", async ({ page }) => {
    await page.goto("/pricing");
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toHaveCount(1);
    await expect(h1).toHaveText("Listing is free. Being found first is the paid part.");
  });

  test("names the absence of a commission and of a per-lead charge", async ({ page }) => {
    await page.goto("/pricing");
    // The load-bearing commercial claim, and the one a competitor cannot copy.
    await expect(page.getByText(/no setup fee, no commission, no pay-per-lead/i)).toBeVisible();
  });

  test("puts the cheapest paid plan in the title, and the same figure on a card", async ({
    page,
  }) => {
    await page.goto("/pricing");
    const title = await page.title();
    const from = title.match(/AED ([\d,]+)/)?.[1];
    expect(from, title).toBeTruthy();
    expect(await pricesOn(page)).toContain(`AED ${from}`);
  });

  test("promotes exactly one plan, and not the dearest", async ({ page }) => {
    await page.goto("/pricing");
    const promoted = page.locator("section[aria-label].shadow-promoted");
    await expect(promoted).toHaveCount(1);

    const cards = page.locator("section[aria-label]").filter({ has: page.locator("h2") });
    const names = await cards.locator("h2").allInnerTexts();
    const promotedName = (await promoted.locator("h2").innerText()).trim();
    // The cards are in `sortOrder`, which is cheapest first, so the dearest is
    // the last one. A directory whose recommendation is always its dearest tier
    // is one a supplier learns to read past.
    expect(promotedName).not.toBe(names.at(-1)?.trim());
  });

  test("offers no trial and puts no expiry on the free plan", async ({ page }) => {
    await page.goto("/pricing");
    const main = page.locator("main");
    // `SubStatus.trialing` exists in the database and nothing writes it. A
    // trial offered here would be checkable and wrong on the first day.
    await expect(main).not.toContainText(/\d+[- ]day trial/i);
    await expect(main).toContainText(/Free is a plan, not a trial/i);
    await expect(main).not.toContainText(/expires in|days left|upgrade before/i);
  });

  test("uses none of the words for things that do not exist", async ({ page }) => {
    await page.goto("/pricing");
    const copy = await page.locator("main").innerText();
    for (const word of [
      "cart",
      "basket",
      "checkout",
      "purchase",
      "payout",
      "refund",
      "dispatch",
      "GMV",
      "price on request",
    ]) {
      expect(copy.toLowerCase(), word).not.toContain(word.toLowerCase());
    }
  });
});

test.describe("the monthly / annual toggle", () => {
  test("charges ten months for a year, and says so in months", async ({ page }) => {
    await page.goto("/pricing");
    const monthly = await pricesOn(page);

    await page.getByRole("radio", { name: /Annual/ }).click();
    const annual = await pricesOn(page);

    expect(annual.length).toBe(monthly.length);
    for (const [index, label] of monthly.entries()) {
      const asNumber = (value: string) => Number(value.replace(/[^\d]/g, ""));
      if (!label.includes("AED")) {
        // Free is free either way, and carries no period.
        expect(annual[index]).toBe(label);
        continue;
      }
      expect(asNumber(annual[index]!)).toBe(asNumber(label) * 10);
    }

    // The discount as months, never as a percentage.
    await expect(page.getByRole("radio", { name: /Annual/ })).toContainText("−2 months");
    await expect(page.locator("main")).not.toContainText(/16(\.\d+)?%/);
  });

  test("says annual cannot be charged yet rather than implying it can", async ({ page }) => {
    await page.goto("/pricing");
    await page.getByRole("radio", { name: /Annual/ }).click();
    // Nothing in the product can take a year's money: `Plan` has one price
    // column and every mechanism under it is monthly.
    await expect(page.getByText(/charged monthly today/i)).toBeVisible();
  });
});

test.describe("the comparison table", () => {
  test("is a real table with scoped headers", async ({ page, isMobile }) => {
    test.skip(isMobile, "below 768 the table is replaced by per-plan blocks");
    await page.goto("/pricing");

    const table = page.locator("table");
    await expect(table).toHaveCount(1);
    await expect(table.locator("caption")).toHaveCount(1);

    const heads = table.locator("th");
    expect(await heads.count()).toBeGreaterThan(0);
    for (const th of await heads.all()) {
      expect(["col", "row"]).toContain(await th.getAttribute("scope"));
    }
  });

  test("qualifies the ranking row where the number is, not in a footnote", async ({ page }) => {
    await page.goto("/pricing");
    const main = page.locator("main");

    // The multiplier comes from `Plan.rankingMultiplier` and never reads 3×.
    await expect(main).toContainText(/1\.35×/);
    await expect(main).not.toContainText(/\b3× ?\+? ?(top slot)?/);

    // And it is bounded in place: the plan tier is one of six components and
    // deliberately the smallest.
    await expect(main).toContainText(/plan-tier component of the ranking only/i);
    await expect(main).toContainText(/of \d+ points/);
  });

  test("says a sponsored slot is not something a plan includes", async ({ page }) => {
    await page.goto("/pricing");
    // The board draws "top placement in your subcategory" as a Pro feature. It
    // is a `PlacementSlot`, taken at its own price by a seller on any plan.
    await expect(page.locator("main")).toContainText(/No plan includes one/i);
  });
});

test.describe("the shape of the page", () => {
  test("emits an Offer per plan, priced in AED", async ({ page }) => {
    await page.goto("/pricing");
    const blocks = await structuredData(page);

    const products = blocks.filter((block) => block["@type"] === "Product");
    const cards = await page.locator("section[aria-label] h2").count();
    expect(products.length).toBe(cards);

    for (const product of products) {
      const offer = product["offers"] as Record<string, unknown>;
      expect(offer["@type"]).toBe("Offer");
      expect(offer["priceCurrency"]).toBe("AED");
      expect(typeof offer["price"]).toBe("number");
    }

    expect(blocks.some((block) => block["@type"] === "BreadcrumbList")).toBe(true);
  });

  test("is linked from the nav, and marked as the current page", async ({ page, isMobile }) => {
    test.skip(isMobile, "the nav links are hidden below lg");
    await page.goto("/pricing");
    const link = page.getByRole("navigation").getByRole("link", { name: "Pricing" }).first();
    await expect(link).toHaveAttribute("aria-current", "page");
  });

  test("is in the sitemap", async ({ request }) => {
    const xml = await (await request.get("/sitemap.xml")).text();
    expect(xml).toMatch(/<loc>https?:\/\/[^<]+\/pricing<\/loc>/);
  });

  test("has no axe violations", async ({ page }) => {
    await page.goto("/pricing");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      // Token-level, enumerated in docs/contrast.md and pinned on the gallery.
      .disableRules(["color-contrast"])
      .analyze();
    const summary = results.violations.map((v) => `${v.id}: ${v.help}`);
    expect(summary, summary.join("\n")).toEqual([]);
  });

  test("is reachable and operable by keyboard alone", async ({ page, isMobile }) => {
    test.skip(isMobile, "there is no keyboard on the mobile project");
    await page.goto("/pricing");

    // Into the toggle, then across it with an arrow: it is a radiogroup, so it
    // is one tab stop and the arrows move inside it.
    await page.getByRole("radio", { name: "Monthly" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: /Annual/ })).toBeFocused();
    await expect(page.getByRole("radio", { name: /Annual/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});

test.describe("on a phone", () => {
  test.skip(({ isMobile }) => !isMobile, "the mobile project owns these");

  test("never scrolls sideways", async ({ page }) => {
    await page.goto("/pricing");
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });

  test("replaces the table with per-plan blocks rather than a sideways scroll", async ({
    page,
  }) => {
    await page.goto("/pricing");
    // A four-column table on a phone puts the column being sold off the right
    // edge, so below 768 there is no table at all.
    await expect(page.locator("table")).toBeHidden();
    await expect(page.locator("dl")).not.toHaveCount(0);
  });

  test("puts the promoted plan first, because order is the only hierarchy left", async ({
    page,
  }) => {
    await page.goto("/pricing");
    const cards = page.locator("section[aria-label]").filter({ has: page.locator("h2") });
    const boxes = await Promise.all((await cards.all()).map((card) => card.boundingBox()));
    const promotedBox = await page.locator("section[aria-label].shadow-promoted").boundingBox();

    expect(promotedBox).not.toBeNull();
    const tops = boxes.map((box) => box?.y ?? Infinity);
    expect(promotedBox!.y).toBe(Math.min(...tops));
  });
});
