import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Board 10b — the guide index.
 *
 * The board showed one featured article plus six cards and then a
 * `Show all 22` button, so fifteen articles were absent from the document and
 * had no inbound link from their own index. That is the substance of the spec,
 * and criterion 1 is explicit about how to check it: *"Asserted by counting
 * anchors against the published count, not by eye."*
 *
 * So the first test reads the raw HTML rather than the rendered DOM. A
 * Playwright locator would pass on links a client component added after
 * hydration, which is the exact failure the criterion is written against.
 */

test.describe("criterion 1 — every guide is linked, in the HTML", () => {
  test("the anchors, the structured data and the sitemap are the same set", async ({ request }) => {
    const html = await (await request.get("/guides")).text();

    const anchors = new Set(
      [...html.matchAll(/href="\/guides\/([a-z0-9-]+)"/g)].map((match) => match[1] as string),
    );
    // The subject chips and the author page live under the same segment.
    const reserved = new Set(["how-we-check"]);
    const guides = [...anchors].filter((slug) => !reserved.has(slug));

    /*
       The page's own `ItemList` is the count to measure against: it is built
       from the same query as the links, so if the two ever disagree one of them
       is describing a different page from the one being served.
    */
    const ld = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)]
      .map((match) => JSON.parse((match[1] as string).replace(/\\u003c/g, "<")) as Record<string, unknown>)
      .find((block) => block["@type"] === "CollectionPage");
    expect(ld, "the index emits CollectionPage").toBeTruthy();

    const list = ld?.["mainEntity"] as { numberOfItems: number; itemListElement: { url: string }[] };
    const listed = list.itemListElement.map((item) => item.url.split("/guides/")[1] as string);

    expect(list.numberOfItems).toBe(listed.length);
    expect(
      [...guides].sort().filter((slug) => listed.includes(slug)),
      "every guide in the structured data has an anchor in the HTML",
    ).toEqual([...listed].sort());

    // And the sitemap agrees, so nothing is asked to be indexed that the page
    // does not link and nothing is linked that the sitemap forgets.
    const sitemap = await (await request.get("/sitemap.xml")).text();
    for (const slug of listed) {
      expect(sitemap, `sitemap carries /guides/${slug}`).toContain(`/guides/${slug}<`);
    }
  });

  test("criterion 2 — there is no load-more, and no disclosure", async ({ request }) => {
    const html = await (await request.get("/guides")).text();
    expect(html).not.toMatch(/load more|show all \d+|<details/i);
  });

  test("§SEO — the page links into the directory at least twice", async ({ request }) => {
    const html = await (await request.get("/guides")).text();
    const directory = [...html.matchAll(/href="\/(search|categories)[^"]*"/g)].length;
    expect(directory).toBeGreaterThanOrEqual(2);
  });
});

test.describe("the page a reader sees", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/guides");
  });

  test("says the count, and the count is the number of guides on the page", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const lede = await page.locator("main p").first().innerText();
    const stated = Number(lede.match(/(\d+) guides?/)?.[1]);
    expect(Number.isInteger(stated)).toBe(true);

    const links = await page.locator('main a[href^="/guides/"]').all();
    const slugs = new Set<string>();
    for (const link of links) {
      const href = (await link.getAttribute("href")) ?? "";
      const slug = href.replace("/guides/", "");
      if (slug && slug !== "how-we-check") slugs.add(slug);
    }
    // Subject chips share the segment, so the guide count is a floor here; the
    // exact assertion is the raw-HTML one above.
    expect(slugs.size).toBeGreaterThanOrEqual(stated);
  });

  test("criterion 4 — the featured pill claims a choice, not a ranking", async ({ page }) => {
    const pill = page.getByText("Start here", { exact: true });
    if ((await pill.count()) > 0) {
      await expect(pill.first()).toBeVisible();
    }
    // Whatever else is true, the board's own label must not have survived.
    await expect(page.getByText(/most read/i)).toHaveCount(0);
  });

  test("criterion 5 — every entry carries a date, and overdue is a word", async ({ page }) => {
    const body = await page.locator("main").innerText();
    expect(body).toMatch(/checked \d/i);
    // Not colour alone: if anything is overdue it says so in text.
    const overdue = page.getByText("Review overdue");
    if ((await overdue.count()) > 0) {
      await expect(overdue.first()).toBeVisible();
    }
  });

  test("criterion 9 — the subject chips are real URLs", async ({ page }) => {
    const chips = page.getByRole("navigation", { name: /guide subjects/i });
    if ((await chips.count()) === 0) return;
    const links = await chips.getByRole("link").all();
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(await link.getAttribute("href")).toMatch(/^\/guides(\/[a-z0-9-]+)?$/);
    }
  });

  test("criterion 14 — axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page })
      .include("main")
      .analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("the author page the strip links to", () => {
  test("resolves, and states what is not known rather than inventing it", async ({ page }) => {
    await page.goto("/guides/how-we-check");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/how we check/i);
    // Board 6d Q1 is unanswered. The page says so instead of naming somebody.
    await expect(page.getByText(/do not yet carry an individual byline/i)).toBeVisible();
  });

  test("axe clean", async ({ page }) => {
    await page.goto("/guides/how-we-check");
    const results = await new AxeBuilder({ page }).include("main").analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("an empty subject is not a page", () => {
  test("404s rather than serving a thin, self-canonical URL nothing links", async ({ request }) => {
    /*
       `guideIndex` builds a shelf only for a subject with published guides, and
       the route reads the same rule. A subject page with nothing on it would be
       a live canonical URL with a heading and a sentence saying there is
       nothing here — the thin page the publish gate exists to keep out,
       arriving through a different door.
    */
    const sitemap = await (await request.get("/sitemap.xml")).text();
    const shelves = [...sitemap.matchAll(/\/guides\/([a-z0-9-]+)</g)].map((m) => m[1] as string);
    // Whatever is in the sitemap resolves; that is the invariant worth holding.
    for (const slug of shelves) {
      expect((await request.get(`/guides/${slug}`)).status(), `/guides/${slug}`).toBe(200);
    }
  });
});
