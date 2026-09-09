import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Boards 13f, 13g and 13h — the three pages built on the shared `LegalPage`
 * template, and the acceptance criteria each board sets for it.
 *
 * The two that could only be checked in a browser are the ones worth the file:
 * the side columns are `position: sticky` and die silently if any ancestor ever
 * gains an `overflow: hidden`, and a deep link has to clear a 68px sticky site
 * nav. Neither shows up in a unit test and neither raises an error when it
 * breaks — the column simply scrolls away, and the clause lands under the bar.
 */

const PAGES = [
  { path: "/terms", title: "Terms of use", sections: 16 },
  { path: "/privacy", title: "Privacy policy", sections: 12 },
  { path: "/cookies", title: "Cookie policy", sections: 5 },
] as const;

/** Board 13f: three columns at 1200px and up. */
const WIDE = { width: 1440, height: 900 };

function measure(page: Page) {
  return page.locator("main article");
}

test.describe("the legal template", () => {
  for (const { path, title, sections } of PAGES) {
    test(`${path} renders ${sections} sections with stable anchors`, async ({ page }) => {
      await page.setViewportSize(WIDE);
      await page.goto(path);

      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);

      const headings = measure(page).getByRole("heading", { level: 2 });
      await expect(headings).toHaveCount(sections);

      const ids = await headings.evaluateAll((nodes) => nodes.map((node) => node.id));
      expect(new Set(ids).size, "anchors are unique").toBe(sections);
      for (const id of ids) expect(id).toMatch(/^\d{2}-[a-z0-9-]+$/);

      // Criterion 5 on 13f, 9 on 13g: one h1, then h2s, nothing skipped.
      const levels = await page
        .locator("main :is(h1,h2,h3,h4,h5,h6)")
        .evaluateAll((nodes) => nodes.map((node) => Number(node.tagName.slice(1))));
      expect(levels.filter((level) => level === 1)).toHaveLength(1);
      expect(new Set(levels)).toEqual(new Set([1, 2]));
    });

    test(`${path} lists every section in the nav, and nothing else`, async ({ page }) => {
      await page.setViewportSize(WIDE);
      await page.goto(path);

      const nav = page.getByRole("navigation", { name: "On this page" });
      const links = nav.getByRole("link");
      await expect(links).toHaveCount(sections);

      const targets = await links.evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLAnchorElement).getAttribute("href")),
      );
      const ids = await measure(page)
        .getByRole("heading", { level: 2 })
        .evaluateAll((nodes) => nodes.map((node) => `#${node.id}`));
      expect(targets).toEqual(ids);
    });

    test(`${path} reaches the other four`, async ({ page }) => {
      await page.setViewportSize(WIDE);
      await page.goto(path);

      const others = page.getByRole("navigation", { name: "The other four" });
      const links = others.getByRole("link");
      await expect(links).toHaveCount(4);

      // Criterion 8: no 404s. Followed rather than pattern-matched, because a
      // link that resolves is the claim being made.
      const hrefs = await links.evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLAnchorElement).getAttribute("href") ?? ""),
      );
      expect(hrefs).not.toContain(path);
      for (const href of hrefs) {
        const response = await page.goto(href);
        expect(response?.status(), href).toBe(200);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      }
    });

    test(`${path} sets no cookie before any consent answer`, async ({ page, context }) => {
      /*
         13f criterion 4 and 13h criterion 5. The page has to be readable with
         zero non-essential cookies, and the register is the list of what may be
         set at all — so a cookie appearing on a plain load of the policy that
         describes cookies is the page contradicting itself.
      */
      await context.clearCookies();
      await page.goto(path);
      const names = (await context.cookies()).map((cookie) => cookie.name);
      expect(names.filter((name) => name.startsWith("bl_"))).toEqual([]);
    });
  }

  test("both columns stay stuck while the measure scrolls", async ({ page }) => {
    /*
       13f §2, and criterion 2. `position: sticky` resolves against the nearest
       scrolling ancestor, so an `overflow: hidden` anywhere above these two
       columns silently turns them back into ordinary blocks — no error, no
       warning, the nav just scrolls off the top. This is the assertion that
       nothing has grown one.

       84px: the sticky site nav is 68 tall and the board offsets the columns by
       16 so they are not flush to the edge.
    */
    await page.setViewportSize({ width: 1440, height: 800 });
    await page.goto("/terms");

    const nav = page.getByRole("navigation", { name: "On this page" });
    const rail = page.getByRole("region", { name: "At a glance" });
    await expect(rail).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, 2400));
    await expect
      .poll(async () => Math.round((await nav.boundingBox())?.y ?? -1))
      .toBeGreaterThanOrEqual(84);
    expect(Math.round((await rail.boundingBox())?.y ?? -1)).toBeGreaterThanOrEqual(84);
    // Still on screen at all, which is the thing that breaks.
    expect((await nav.boundingBox())?.y).toBeLessThan(200);
  });

  /*
     Every anchor on these pages starts with its clause number, which is what
     13f §2 draws and what makes the id readable in a support reply. It is legal
     HTML and `getElementById` and a URL fragment both take it — but `#12-…` is
     not a valid CSS selector, because a CSS identifier may not start with a
     digit. Hence the attribute form here and `getElementById` in the nav.
  */
  const LIABILITY = '[id="12-our-liability"]';

  test("the nav follows the reader down the page", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 800 });
    await page.goto("/terms");

    const current = page.locator('[aria-current="location"]');
    await expect(current).toHaveText("Who we are");

    /*
       Put clause 12's heading just inside the band the observer treats as "the
       section being read" — 84px, under the sticky site nav. `scrollIntoView`
       is the wrong instrument: it stops as soon as the element is anywhere on
       screen, which leaves the heading near the bottom and clause 11 still the
       one the reader is in. That is the right highlight, and not what this
       test is asking about.
    */
    const target = await page
      .locator(LIABILITY)
      .evaluate((node) => node.getBoundingClientRect().top + window.scrollY - 90);
    await page.evaluate((y) => window.scrollTo(0, y), target);
    await expect(current).toHaveText("Our liability");
  });

  test("a deep link lands clear of the site nav", async ({ page }) => {
    // Criterion 3. The bar is 68px and sticky; a heading at y < 68 is under it.
    await page.setViewportSize({ width: 1440, height: 800 });
    await page.goto("/terms#12-our-liability");

    const clause = page.locator(LIABILITY);
    await expect(clause).toBeVisible();
    const box = await clause.boundingBox();
    expect(box?.y ?? 0).toBeGreaterThanOrEqual(68);
    expect(box?.y ?? 0).toBeLessThan(200);
  });

  test("the register is a real table of nine cookies under four bands", async ({ page }) => {
    // 13h criteria 2 and 3, and CLAUDE.md's fourth non-negotiable.
    await page.setViewportSize(WIDE);
    await page.goto("/cookies");

    const table = page.locator("main article table");
    await expect(table).toHaveCount(1);
    await expect(table.locator("caption")).toHaveCount(1);
    await expect(table.locator('thead th[scope="col"]')).toHaveCount(3);
    await expect(table.locator('th[scope="colgroup"]')).toHaveCount(4);

    const names = await table
      .locator("tbody tr td:first-child")
      .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ""));
    expect(names).toHaveLength(9);
    expect(new Set(names).size).toBe(9);
    for (const name of names) expect(name).toMatch(/^bl_/);
  });

  test("the privacy tables are tables, with header cells", async ({ page }) => {
    await page.setViewportSize(WIDE);
    await page.goto("/privacy");

    const tables = page.locator("main article table");
    await expect(tables).toHaveCount(2);
    await expect(tables.nth(0).locator('th[scope="col"]')).toHaveCount(2);
    await expect(tables.nth(1).locator('th[scope="col"]')).toHaveCount(3);
    await expect(tables.nth(0).locator("tbody tr")).toHaveCount(8);
    await expect(tables.nth(1).locator("tbody tr")).toHaveCount(8);
  });

  test("print drops the columns and keeps the text, the tables and the version", async ({
    page,
  }) => {
    // Criterion 6. People print terms.
    await page.setViewportSize(WIDE);
    await page.goto("/cookies");
    await page.emulateMedia({ media: "print" });

    await expect(page.getByRole("navigation", { name: "On this page" })).toBeHidden();
    await expect(page.getByRole("region", { name: "At a glance" })).toBeHidden();
    await expect(page.locator("main article table")).toBeVisible();
    await expect(page.locator("main article").getByText("/cookies —")).toBeVisible();

    await page.emulateMedia({ media: "screen" });
  });

  test("below 768px the nav collapses and the measure keeps a readable line", async ({ page }) => {
    // Criterion 9.
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto("/terms");

    const nav = page.getByRole("navigation", { name: "On this page" });
    const disclosure = nav.locator("details");
    await expect(disclosure).toHaveJSProperty("open", false);

    // The summary sits above the h1, which is what makes the collapse useful.
    const summary = nav.locator("summary");
    const h1 = page.getByRole("heading", { level: 1 });
    expect((await summary.boundingBox())?.y ?? 0).toBeLessThan((await h1.boundingBox())?.y ?? 0);

    await summary.click();
    await expect(disclosure).toHaveJSProperty("open", true);
    await expect(nav.getByRole("link", { name: "Our liability" })).toBeVisible();

    const width = (await page.locator("main article p").first().boundingBox())?.width ?? 0;
    expect(width).toBeGreaterThan(280);
    expect(width).toBeLessThanOrEqual(390);
  });

  test("between 768 and 1200 the rail moves below the measure and the nav stays", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto("/terms");

    const nav = page.getByRole("navigation", { name: "On this page" });
    const article = measure(page);
    const rail = page.getByRole("region", { name: "At a glance" });

    const navBox = await nav.boundingBox();
    const articleBox = await article.boundingBox();
    const railBox = await rail.boundingBox();

    expect(navBox?.x ?? 0).toBeLessThan(articleBox?.x ?? 0);
    expect(railBox?.y ?? 0).toBeGreaterThan((articleBox?.y ?? 0) + (articleBox?.height ?? 0) - 1);
  });

  test("is in the sitemap, canonical, and indexable", async ({ page, request }) => {
    // 13f §1: indexable, canonical, in the sitemap. Not noindex — buyers search
    // for these pages by name.
    for (const { path } of PAGES) {
      await page.goto(path);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        "href",
        new RegExp(`${path}$`),
      );
      await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
    }

    const sitemap = await (await request.get("/sitemap.xml")).text();
    for (const { path } of PAGES) expect(sitemap, path).toContain(`${path}<`);
  });

  test("is axe clean", async ({ page }) => {
    await page.setViewportSize(WIDE);
    await page.goto("/cookies");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
      .disableRules(["color-contrast"])
      .analyze();

    const summary = results.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.length,
      first: violation.nodes[0]?.html?.slice(0, 140),
    }));
    expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
  });

  test("every interactive element is reachable by keyboard, with a visible ring", async ({
    page,
  }) => {
    await page.setViewportSize(WIDE);
    await page.goto("/cookies");

    const first = page.getByRole("navigation", { name: "On this page" }).getByRole("link").first();
    await first.focus();
    await expect(first).toBeFocused();
    const shadow = await first.evaluate((node) => getComputedStyle(node).boxShadow);
    expect(shadow).not.toBe("none");
  });
});

test.describe("the lead-ins are emphasis, not asterisks", () => {
  /*
     The two policies rendered by `Prose`, and only those two.

     `/terms`, `/privacy` and `/cookies` are boards 13f-13h: they draw clauses
     from `lib/legal/documents.ts` and take only the dates from the row, so the
     `**` in their stored `body` never reaches a page. The two below render the
     stored body directly, and rendered it verbatim — publishing `**Not
     verified.**` with the asterisks in it, on the pages a reader opens when
     they want to know exactly what we promise.

     Worth writing down while it is in view: `legal_page.body` for terms and
     privacy is written by the seed and read by nothing. That is `13i`'s to
     settle (step 1.5 in docs/build-plan.md), not this test's.
  */
  for (const path of ["/verification-policy", "/review-policy"]) {
    test(`${path} publishes no raw markdown`, async ({ page }) => {
      await page.goto(path);
      const body = (await page.locator("main").innerText()) ?? "";
      expect(body).not.toContain("**");
      // And the mark became a real one, rather than being stripped.
      await expect(page.locator("main strong").first()).toBeVisible();
    });
  }
});
