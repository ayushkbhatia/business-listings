import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Handoff 5, step 4 — board 6b, and criterion 4 as a reader sees it.
 *
 * `tests/integration/curated.test.ts` proves the rules are enforced. What
 * matters here is that they are *stated*: the criteria block is the only thing
 * separating this page from every other "best of" in the market, all of which
 * are sold and none of which say so.
 *
 * The seed builds the fixture that carries the point — `al-hvac-005` has the
 * top plan, a verified licence and fifteen reviews, and a median
 * reply of seven hours. It is not on the list.
 */

const LIST = "/best/hvac-suppliers-al-quoz";
const TITLE = "HVAC suppliers in Al Quoz that answer quickly";

/** The members, not the breadcrumb — which is an ordered list as well. */
function members(page: import("@playwright/test").Page) {
  return page.getByRole("list", { name: TITLE }).getByRole("listitem");
}

test.describe("the criteria are published above the names", () => {
  test("states every rule, including the one that is never a factor", async ({ page }) => {
    await page.goto(LIST);
    await expect(page.getByRole("heading", { name: "How this list is made" })).toBeVisible();

    const block = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "How this list is made" }) });

    await expect(block.getByText(/Trade licence checked against the issuing authority/)).toBeVisible();
    await expect(block.getByText(/Median first reply under 4 hours/)).toBeVisible();
    await expect(block.getByText(/At least 15 reviews/)).toBeVisible();

    // The one every competitor omits.
    await expect(block.getByText("Paid placement")).toBeVisible();
    await expect(block.getByText("Never a factor")).toBeVisible();
    await expect(block.getByText(/No supplier can pay to appear here/)).toBeVisible();
  });

  test("sits above the list, not below it", async ({ page }) => {
    /*
       A reader who has scrolled past the names has already decided whether to
       trust the page. The criteria are the reason to, so they come first.
    */
    await page.goto(LIST);
    const criteria = await page
      .getByRole("heading", { name: "How this list is made" })
      .boundingBox();
    const first = await members(page).first().boundingBox();
    expect(criteria!.y).toBeLessThan(first!.y);
  });
});

test.describe("who is on it", () => {
  test("lists the suppliers that meet every rule, in order", async ({ page }) => {
    await page.goto(LIST);
    const names = await members(page).getByRole("heading").allTextContents();
    expect(names.length).toBeGreaterThan(1);
    // The highest tier leads; the comparator reads it first.
    expect(names[0]).toContain("001");
  });

  test("the supplier with the top plan and a slow reply is not on it", async ({ page }) => {
    /*
       Criterion 4's second half, as a page. `al-hvac-005` is on Pro, is
       verified and has fifteen reviews. Its median reply is seven hours, which
       is measured and has no seller-writable field.
    */
    await page.goto(LIST);
    const names = await members(page).getByRole("heading").allTextContents();
    expect(names.join(" ")).not.toContain("005");
  });

  test("says how many were considered against how many made it", async ({ page }) => {
    await page.goto(LIST);
    await expect(page.getByText(/\d+ suppliers in this trade were checked against these rules/)).toBeVisible();
  });

  test("each entry carries what was checked and when", async ({ page }) => {
    /*
       Criterion 8 has no exceptions, including on an editorial page: the badge
       says what was checked and its date.

       Deliberately not asserting a particular rung. A tier is staff-owned and
       moves, and an earlier version of this test named "Licence verified" and
       failed the first time another suite promoted the listing a rung. What
       the criterion requires is the sentence, not the word.

       The alternation is every label the ladder can render, from
       `components/domain/verification.ts` — the compact badge shows the label
       rather than the longer "what was checked" line. It used to include
       "visited", which is what made it pass: the leading member was tier 3 and
       tier 3 was "Site visited". With that rung withdrawn the top of this list
       is "Licence verified", and a regex that still expected a visit would have
       gone red for a reason nothing to do with criterion 8.
    */
    await page.goto(LIST);
    const first = members(page).first();
    await expect(
      first.getByText(/not verified|licence on file|licence verified|audited/i).first(),
    ).toBeVisible();
    await expect(first.getByText(/^tier \d$/)).toBeVisible();
  });

  test("carries ItemList structured data matching the visible order", async ({ page }) => {
    await page.goto(LIST);
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    const list = blocks
      .map((block) => JSON.parse(block) as Record<string, unknown>)
      .find((block) => block["@type"] === "ItemList");

    expect(list, "no ItemList on the page").toBeDefined();
    const marked = ((list?.itemListElement ?? []) as { name: string }[]).map((entry) => entry.name);
    const visible = await members(page).getByRole("heading").allTextContents();
    expect(marked).toEqual(visible.map((name) => name.trim()));
  });
});

test.describe("the address", () => {
  test("is in the sitemap", async ({ request }) => {
    const xml = await (await request.get("/sitemap.xml")).text();
    expect(xml).toContain(LIST);
  });

  test("404s on a list that is not here", async ({ page }) => {
    const response = await page.goto("/best/not-a-list");
    expect(response?.status()).toBe(404);
  });
});

test.describe("accessibility", () => {
  test(`axe is clean on ${LIST}`, async ({ page }) => {
    await page.goto(LIST);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
      // docs/contrast.md — the failing pairs are token-level and pinned.
      .disableRules(["color-contrast"])
      .analyze();
    const summary = results.violations.map((v) => ({ id: v.id, nodes: v.nodes.length }));
    expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
  });
});
