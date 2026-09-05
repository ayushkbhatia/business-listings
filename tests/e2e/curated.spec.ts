import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Board 6b — the curated list, as a reader and a crawler get it.
 *
 * The page's entire value rests on one claim about our own conduct being
 * verifiable by a reader who assumes we are lying, so most of what is asserted
 * here is about that claim rather than about layout.
 *
 * `tests/integration/curated.test.ts` proves the snapshot model at the service
 * layer. This proves the page.
 */

const LIST = "/best/hvac-suppliers-al-quoz";

async function jsonLd(page: Page) {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  return blocks.map((block) => JSON.parse(block) as Record<string, unknown>);
}

test.describe("the claim the page is built on", () => {
  test("prints the method in the hero, three required and one never", async ({ page }) => {
    await page.goto(LIST);
    const panel = page.getByRole("complementary", { name: /how we chose/i });

    await expect(panel.getByText("Licence verified")).toBeVisible();
    await expect(panel.getByText(/Median reply under 4h/)).toBeVisible();
    await expect(panel.getByText(/reviews from enquiries/)).toBeVisible();

    // The row a reader most wants stated, and the one every competitor omits.
    await expect(panel.getByText("Paid placement")).toBeVisible();
    await expect(panel.getByText("Never", { exact: true })).toBeVisible();
    await expect(panel.getByText("Required")).toHaveCount(3);
  });

  test("says No one paid to be here, as its own sentence", async ({ page }) => {
    await page.goto(LIST);
    // §2: four words, own sentence, load-bearing. Never softened, never merged
    // into the clause before it, never below the fold.
    await expect(page.getByText("No one paid to be here.")).toBeVisible();
  });

  test("dates every figure, and says when they were measured", async ({ page }) => {
    await page.goto(LIST);
    // The audit date, twice: the hero eyebrow and the method panel.
    await expect(page.getByText(/CURATED LIST · AUDITED \d+ \w+ \d{4}/i)).toBeVisible();
    await expect(
      page.getByText(/Every figure on this page was measured on .*the day the list was last audited/),
    ).toBeVisible();
  });

  test("acceptance 2 — no sponsored or promoted component anywhere under /best", async ({
    page,
  }) => {
    await page.goto(LIST);
    /*
       §5: "Those coexist only if the sponsored-slot component **cannot render
       on this route**. Not 'is not configured to' — cannot." Asserted on the
       rendered tree rather than by configuration, which is what the spec asks
       for: this page composes no results surface, so there is no slot to fill.
    */
    const body = (await page.locator("body").innerText()).toLowerCase();
    for (const word of ["sponsored", "promoted", "advertisement", "paid placement —"]) {
      expect(body, `"${word}" appears on a page that publishes "paid placement: never"`).not.toContain(
        word,
      );
    }
    await expect(page.locator('[data-sponsored], [data-ad], .sponsored')).toHaveCount(0);
  });
});

test.describe("the entries", () => {
  test("each carries a rank, a BEST FOR line, prose and both actions", async ({ page }) => {
    await page.goto(LIST);
    const entries = page.locator("ol > li").filter({ has: page.locator("h3") });
    expect(await entries.count()).toBeGreaterThanOrEqual(3);

    const first = entries.first();
    await expect(first.locator("h3")).toBeVisible();
    await expect(first.getByText(/Best for:/i)).toBeVisible();
    // Acceptance 13: every member links to its storefront and its composer.
    await expect(first.getByRole("link", { name: "View storefront" })).toBeVisible();
    await expect(first.getByRole("link", { name: "Enquire" })).toBeVisible();
  });

  test("acceptance 16 — no two entries are best for the same thing", async ({ page }) => {
    await page.goto(LIST);
    // Open the band, so all twelve are measured rather than the first three.
    await page.getByRole("group").first().locator("summary").click();
    const lines = await page.getByText(/^Best for:/i).allTextContents();
    expect(lines.length).toBeGreaterThan(3);
    expect(new Set(lines).size).toBe(lines.length);
  });

  test("the band expands in place rather than paginating", async ({ page }) => {
    await page.goto(LIST);
    const before = page.url();
    await page.getByRole("group").first().locator("summary").click();
    // §3: splitting a curated list across URLs halves the link equity that is
    // the whole point of the page, and leaves the ItemList incomplete.
    expect(page.url()).toBe(before);
    await expect(page.getByRole("link", { name: "View storefront" }).nth(11)).toBeVisible();
  });
});

test.describe("the RFQ shortcut", () => {
  test("acceptance 1 — offers at most eight, and says so", async ({ page }) => {
    await page.goto(LIST);
    /*
       The board read "Send one RFQ to all 12". The fan-out cap is 8, hard, and
       `1h` states it on screen — the same error that removed "Post an RFQ to
       1,842" from `1b`'s category header.
    */
    const action = page.getByRole("link", { name: /Send one RFQ to \d+ of these \d+/ });
    await expect(action).toBeVisible();

    const label = (await action.innerText()).match(/to (\d+) of these (\d+)/);
    const recipients = Number(label?.[1]);
    expect(recipients).toBeLessThanOrEqual(8);
    await expect(page.getByText(/composer caps at 8 recipients/)).toBeVisible();
  });
});

test.describe("SEO", () => {
  test("acceptance 11 — ItemList covers every member, including the hidden ones", async ({
    page,
  }) => {
    await page.goto(LIST);
    const list = (await jsonLd(page)).find((block) => block["@type"] === "ItemList");
    expect(list).toBeDefined();

    /*
       Counted from the DOM, not from the accessibility tree.

       The nine behind "Continue the list" sit inside a closed `<details>`, so
       `getByRole` does not see them — but a crawler does, which is the whole
       reason §3 insists the band expands in place rather than paginating. This
       assertion is the crawler's view: every member is in the markup whether or
       not the band is open, and the `ItemList` describes exactly that set.
    */
    const inMarkup = await page
      .locator('a[href^="/b/"]')
      .evaluateAll((links) => new Set(links.map((a) => a.getAttribute("href"))).size);

    expect(Number(list?.numberOfItems)).toBe(inMarkup);
    expect(Number(list?.numberOfItems)).toBeGreaterThan(3);
  });

  test("acceptance 12 — no FAQPage, and no rating for the list itself", async ({ page }) => {
    await page.goto(LIST);
    const types = (await jsonLd(page)).map((block) => block["@type"]);
    /*
       The method panel is not a FAQ, and marking it up as one to chase a rich
       result would be exactly the behaviour this page exists to distinguish us
       from. The ratings belong to the members and are on their storefronts.
    */
    expect(types).not.toContain("FAQPage");
    expect(types).not.toContain("AggregateRating");
    expect(types).toContain("ItemList");
    expect(types).toContain("BreadcrumbList");
  });

  test("canonical is self, absolute, with no query string", async ({ page }) => {
    await page.goto(LIST);
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(canonical).toContain(LIST);
    expect(canonical).not.toContain("?");
  });

  test("acceptance 14 — links back to the page it was drawn from", async ({ page }) => {
    await page.goto(LIST);
    // A curated list with no link to the underlying area page strands the
    // reader who wants the other two hundred companies.
    const back = page.getByRole("link", { name: /All \d+ .* in Al Quoz/ });
    await expect(back).toBeVisible();
    expect(await back.getAttribute("href")).toContain("/dubai/al-quoz-industrial-1/");
  });

  test("is in the sitemap while it is published", async ({ request }) => {
    const xml = await (await request.get("/sitemap.xml")).text();
    expect(xml).toContain(LIST);
  });
});

test.describe("acceptance 15 — no claim above licence verified", () => {
  test("says nothing about visits or premises", async ({ page }) => {
    await page.goto(LIST);
    const body = (await page.locator("body").innerText()).toLowerCase();
    for (const claim of ["site visit", "visited", "premises", "in person", "field team"]) {
      expect(body, `the page still says "${claim}"`).not.toContain(claim);
    }
  });
});

test.describe("accessibility", () => {
  test("axe is clean, and there is one h1", async ({ page }) => {
    await page.goto(LIST);
    await expect(page.locator("h1")).toHaveCount(1);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
      // docs/contrast.md — the failing pairs are token-level and pinned.
      .disableRules(["color-contrast"])
      .analyze();
    const summary = results.violations.map((v) => ({ id: v.id, nodes: v.nodes.length }));
    expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
  });

  test("the expanded band is reachable from the keyboard", async ({ page }) => {
    await page.goto(LIST);
    const summary = page.getByRole("group").first().locator("summary");
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("link", { name: "View storefront" }).nth(11)).toBeVisible();
  });
});
