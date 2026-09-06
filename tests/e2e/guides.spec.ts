import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Board 6d — the guide article.
 *
 * Guides are sequenced first in the handoff because they are the only content
 * that works before supply density exists: an area page needs 60 listings, a
 * guide needs a writer. This one also happens to be where the verification
 * badge is defined in prose to a buyer who arrived from a search engine, which
 * makes its last section the most consequential paragraph in section 06.
 */

const GUIDE = "/guides/check-a-uae-trade-licence";
const OTHER = "/guides/what-supplier-verification-actually-proves";

async function jsonLd(page: Page) {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  return blocks.map((block) => JSON.parse(block) as Record<string, unknown>);
}

test.describe("the badge section", () => {
  test("acceptance 1 — names the steps it covers and dates the check", async ({ page }) => {
    await page.goto(GUIDE);
    const body = await page.locator("article").innerText();
    expect(body).toContain("steps 1 to 3");
    expect(body).toMatch(/carries the date/i);
  });

  test("acceptance 2 — says plainly that the TRN is not covered", async ({ page }) => {
    await page.goto(GUIDE);
    /*
       The board read "any business carrying a green badge has had **all of the
       above** done by our team", and all of the above includes step 4. The TRN
       is a separate tier and a licence-verified supplier may not be
       VAT-registered at all — so a buyer who read that and skipped step 4 was
       relying on a check we never made, on the page teaching them to make it.
    */
    const body = await page.locator("article").innerText();
    expect(body).toContain("Step 4 is not part of it");
    expect(body).not.toContain("all of the above");
  });

  test("acceptance 14 — claims no tier above licence verified", async ({ page }) => {
    for (const route of [GUIDE, OTHER]) {
      await page.goto(route);
      const body = (await page.locator("body").innerText()).toLowerCase();
      for (const claim of ["site visit", "visited", "premises", "in person", "field team"]) {
        expect(body, `${route} still says "${claim}"`).not.toContain(claim);
      }
    }
  });
});

test.describe("the contents rail", () => {
  test("acceptance 4 — is derived, and every entry resolves to a heading", async ({ page }) => {
    await page.goto(GUIDE);

    const headings = await page.locator("article h2").evaluateAll((els) => els.map((e) => e.id));
    const rail = await page
      .locator('nav[aria-labelledby="on-this-page"] a')
      .evaluateAll((els) => els.map((a) => (a.getAttribute("href") ?? "").slice(1)));

    /*
       The board carried a hand-written list of six against three headings: two
       entries pointed at nothing and one pointed at a different guide. One to
       one, in order, is the whole assertion.
    */
    expect(rail).toEqual(headings);
    expect(rail.length).toBeGreaterThanOrEqual(3);
    for (const id of rail) expect(id).not.toBe("");
  });

  test("scrolls to a real section when followed", async ({ page }) => {
    await page.goto(GUIDE);

    /*
       One locator at both widths.

       Two controls carry the same derived list and CSS picks one: the sticky
       rail from `lg` up, a disclosure closed by default below it. This followed
       `nav[aria-labelledby="on-this-page"]` at every width, which on a phone is
       the rail — `display:none`, so the click waited 30s on an element that
       never becomes visible, and the disclosure, a second copy of the list in
       the markup, was followed by nothing. `getByRole` sees only what is in the
       accessibility tree, so it resolves to whichever control this viewport
       actually shows.
    */
    const contents = page.getByRole("navigation", { name: "On this page" });
    const summary = contents.locator("summary");
    if (await summary.count()) await summary.click();

    const first = contents.getByRole("link").first();
    const href = await first.getAttribute("href");
    await first.click();

    const section = page.locator(`article ${href}`);
    await expect(section).toBeVisible();

    /*
       "Scrolls to" is the assertion, and visible is not it: a heading behind
       the sticky bar has a box and passes `toBeVisible`. The bar is 68px on one
       row and 112px once it wraps below `sm`, and the headings carried a flat
       96px `scroll-mt` — so on a phone the section a reader followed landed
       17px underneath the bar, and only this comparison catches it.
    */
    const bar = (await page.getByRole("banner").boundingBox())?.height ?? 0;
    const top = (await section.boundingBox())?.y ?? 0;
    expect(bar).toBeGreaterThan(0);
    expect(top).toBeGreaterThanOrEqual(bar);
  });
});

test.describe("the article", () => {
  test("acceptance 5 — the read time is computed", async ({ page }) => {
    await page.goto(GUIDE);
    // 1,200-plus words at 220 a minute is six, not a number somebody typed.
    await expect(page.getByText(/GUIDE · VERIFICATION · \d+ MIN READ/i)).toBeVisible();
  });

  test("acceptance 15 — body text is at least 15px in the article column", async ({ page }) => {
    await page.goto(GUIDE);
    /*
       Reading prose, which is what the floor is about — "this is a reading
       page; the minimum applies to the article column even where it does not
       apply elsewhere". The one exclusion is the supporting count under the
       closing button, which is marked a caption in the markup rather than
       excluded by hand here.
    */
    const sizes = await page
      .locator("article p:not([data-caption])")
      .evaluateAll((els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
    expect(sizes.length).toBeGreaterThan(5);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(15);
  });

  test("renders prose links rather than their markup", async ({ page }) => {
    await page.goto(GUIDE);
    const body = await page.locator("article").innerText();
    expect(body).not.toContain("](/");
    expect(body).not.toContain("**");
  });

  test("acceptance 10 — links into the directory from the body, not only the footer", async ({
    page,
  }) => {
    await page.goto(GUIDE);
    const hrefs = await page
      .locator("article a")
      .evaluateAll((els) => els.map((a) => a.getAttribute("href") ?? ""));
    const directory = hrefs.filter((href) => /^\/(c\/|categories|[a-z-]+\/[a-z0-9-]+)/.test(href));
    // Two at least, and one of them from a paragraph — a guide that keeps its
    // authority in its own footer passes much less of it on.
    expect(directory.length).toBeGreaterThanOrEqual(2);
  });

  test("Q5 — carries no RFQ composer", async ({ page }) => {
    await page.goto(GUIDE);
    /*
       `6a` and `6b` both carry the prompt because their readers have chosen a
       trade. A reader of this article has not, and a fan-out composer on a page
       about due diligence would contradict the article.
    */
    const hrefs = await page
      .locator("article a")
      .evaluateAll((els) => els.map((a) => a.getAttribute("href") ?? ""));
    expect(hrefs.filter((href) => href.startsWith("/rfq"))).toEqual([]);
  });

  test("acceptance 9 — the CTA count is a query and says what it counts", async ({ page }) => {
    await page.goto(GUIDE);
    // Never a bare number beside the nav's, which counts something else.
    await expect(
      page.getByText(/\d+ suppliers? with a trade licence we have checked and found current/),
    ).toBeVisible();
  });
});

test.describe("SEO", () => {
  test("acceptance 7 — dateModified is the regulatory check, not the row's updatedAt", async ({
    page,
  }) => {
    await page.goto(GUIDE);
    const article = (await jsonLd(page)).find((block) => block["@type"] === "Article");
    expect(article).toBeDefined();

    // The byline prints the same date the markup claims. A typo fix moves
    // `updatedAt`; only an editor re-reading the facts moves this one.
    const shown = await page.locator("article").innerText();
    const modified = new Date(String(article?.dateModified));
    expect(shown).toContain(String(modified.getUTCFullYear()));
    expect(article?.datePublished).not.toBe(article?.dateModified);
  });

  test("acceptance 12 — Article and BreadcrumbList, and no FAQPage", async ({ page }) => {
    await page.goto(GUIDE);
    const types = (await jsonLd(page)).map((block) => block["@type"]);
    expect(types).toContain("Article");
    expect(types).toContain("BreadcrumbList");
    // The red-flag card is a callout, not a FAQ. Marking it up as one to chase
    // a rich result is what `6b` exists to distinguish us from.
    expect(types).not.toContain("FAQPage");
  });

  test("names an author rather than nobody", async ({ page }) => {
    await page.goto(GUIDE);
    const article = (await jsonLd(page)).find((block) => block["@type"] === "Article");
    const author = article?.author as { "@type": string; name: string };
    expect(author.name).toBeTruthy();
  });

  test("the title carries no year, and the canonical is self", async ({ page }) => {
    await page.goto(GUIDE);
    // §SEO: appending a year to an evergreen guide dates it the moment it turns
    // over; `regulatoryCheckedAt` is how freshness is communicated instead.
    await expect(page).not.toHaveTitle(/20\d\d/);
    expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toContain(GUIDE);
  });

  test("is in the sitemap", async ({ request }) => {
    const xml = await (await request.get("/sitemap.xml")).text();
    expect(xml).toContain(GUIDE);
  });
});

test.describe("the rail", () => {
  test("acceptance 11 — points at the guide that covers what this one does not", async ({
    page,
  }) => {
    await page.goto(GUIDE);
    const related = page.getByRole("navigation", { name: /related guides/i });
    await expect(related.getByRole("link")).toHaveCount(1);
    expect(await related.getByRole("link").first().getAttribute("href")).toBe(OTHER);
  });

  test("an unpublished guide is a 404, not a thin page", async ({ page }) => {
    const response = await page.goto("/guides/not-a-guide");
    expect(response?.status()).toBe(404);
  });
});

test.describe("accessibility", () => {
  test("axe is clean, and there is one h1", async ({ page }) => {
    await page.goto(GUIDE);
    await expect(page.locator("h1")).toHaveCount(1);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
      // docs/contrast.md — the failing pairs are token-level and pinned.
      .disableRules(["color-contrast"])
      .analyze();
    const summary = results.violations.map((v) => ({ id: v.id, nodes: v.nodes.length }));
    expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
  });

  test("the step numerals are not headings", async ({ page }) => {
    await page.goto(GUIDE);
    // §SEO: four `h3`s named "Ask for the licence…" would compete with the
    // article's `h2`s in the outline, and the contents rail is built on those.
    await expect(page.locator("article h3")).toHaveCount(0);
  });
});
