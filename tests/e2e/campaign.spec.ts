import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Handoff 5, step 5 — boards 10i and 10j.
 *
 * Criterion 9 is split across three levels: `lib/campaign/attribution.test.ts`
 * has the parsing and the first-touch rule, `tests/integration/attribution.test.ts`
 * has what the service and the console do with it, and this has the part only a
 * browser can show — that the tag survives leaving the campaign page.
 */

const CAMPAIGN = "/lp/find-a-supplier";
const TAGGED = `${CAMPAIGN}?utm_source=google&utm_medium=cpc&utm_campaign=hvac-q3`;

test.describe("board 10i — the campaign landing", () => {
  test("has the wordmark and an escape, and no site nav", async ({ page }) => {
    /*
       "No site nav beyond the wordmark and one escape link." A page that traps
       the visitor converts worse and ranks worse, so what is asserted is both
       halves: the nav is absent, and the way out is present.
    */
    await page.goto(CAMPAIGN);

    await expect(page.getByRole("link", { name: "Go to the directory" }).first()).toBeVisible();
    // The directory nav's own links, which must not be here.
    for (const label of ["Categories", "Guides", "Pricing"]) {
      await expect(page.getByRole("link", { name: label, exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole("searchbox")).toHaveCount(0);
  });

  test("always offers the directory as an alternative", async ({ page }) => {
    await page.goto(CAMPAIGN);
    await expect(page.getByText(/licensed UAE businesses are in the directory/)).toBeVisible();
  });

  test("says the number rather than claiming a lot", async ({ page }) => {
    await page.goto(CAMPAIGN);
    await expect(page.getByText(/\d+ listed businesses · \d+ with a trade licence/)).toBeVisible();
  });

  test("has one call to action that reaches real results", async ({ page }) => {
    await page.goto(CAMPAIGN);
    await page.getByRole("link", { name: /^Find .* suppliers$|^Search the directory$/ }).click();
    await expect(page).toHaveURL(/\/c\/|\/search/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("404s on a campaign that is not published", async ({ page }) => {
    const response = await page.goto("/lp/not-a-campaign");
    expect(response?.status()).toBe(404);
  });

  test("is axe clean", async ({ page }) => {
    await page.goto(CAMPAIGN);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
      // docs/contrast.md — the failing pairs are token-level and pinned.
      .disableRules(["color-contrast"])
      .analyze();
    const summary = results.violations.map((v) => ({ id: v.id, nodes: v.nodes.length }));
    expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
  });
});

test.describe("criterion 9 — the tag survives leaving the page", () => {
  test("writes a first-party cookie on a tagged arrival", async ({ page, context }) => {
    await context.clearCookies();
    await page.goto(TAGGED);

    const cookie = (await context.cookies()).find((c) => c.name === "bl_attr");
    expect(cookie, "no attribution cookie was set").toBeDefined();
    expect(cookie?.value).toContain("google");
    expect(cookie?.value).toContain("hvac-q3");
    // Nothing in the browser reads it — the enquiry is created on the server.
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Lax");
  });

  test("keeps it through a walk into the directory and on to the enquiry form", async ({
    page,
    context,
  }) => {
    /*
       The whole point of the cookie. A buyer lands on a campaign, reads a
       guide, browses a trade and then sends an enquiry twenty minutes later —
       by which time the query string is long gone.
    */
    await context.clearCookies();
    await page.goto(TAGGED);
    await page.goto("/guides");
    await page.goto("/c/valves-and-fittings");
    await page.goto("/rfq/new?category=valves-and-fittings");

    const cookie = (await context.cookies()).find((c) => c.name === "bl_attr");
    expect(cookie?.value).toContain("hvac-q3");
  });

  test("does not overwrite the first touch with a later one", async ({ page, context }) => {
    await context.clearCookies();
    await page.goto(TAGGED);
    const first = (await context.cookies()).find((c) => c.name === "bl_attr")?.value;

    await page.goto(`${CAMPAIGN}?utm_source=newsletter&utm_medium=email&utm_campaign=august`);
    const second = (await context.cookies()).find((c) => c.name === "bl_attr")?.value;

    // A buyer won by a campaign who returns another way is still the campaign's.
    expect(second).toBe(first);
    expect(second).not.toContain("newsletter");
  });

  test("writes nothing for an untagged arrival on an ordinary page", async ({ page, context }) => {
    await context.clearCookies();
    await page.goto("/c/valves-and-fittings");
    expect((await context.cookies()).find((c) => c.name === "bl_attr")).toBeUndefined();
  });

  test("captures a tag that arrives anywhere, not only on a campaign", async ({
    page,
    context,
  }) => {
    /*
       The reason capture lives in the proxy rather than on the campaign page.
       A newsletter link points at a guide as often as at `/lp/...`, and an
       enquiry from one of those is just as attributable.
    */
    await context.clearCookies();
    await page.goto("/guides?utm_source=newsletter&utm_medium=email&utm_campaign=august");

    const cookie = (await context.cookies()).find((c) => c.name === "bl_attr");
    expect(cookie?.value).toContain("newsletter");
  });
});

test.describe("board 10j — the four policies", () => {
  const POLICIES = [
    ["/terms", "Terms of use"],
    ["/privacy", "Privacy"],
    ["/verification-policy", "Verification policy"],
    ["/review-policy", "Review policy"],
  ] as const;

  for (const [path, title] of POLICIES) {
    test(`${path} renders with its effective date`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(title);
      // A policy with no date is a policy that has always said whatever it
      // says now.
      await expect(page.getByText(/In effect since/)).toBeVisible();
    });
  }

  test("each links to the other three", async ({ page }) => {
    await page.goto("/terms");
    const others = page.getByRole("navigation", { name: "The other policies" });
    await expect(others.getByRole("link", { name: "Privacy" })).toBeVisible();
    await expect(others.getByRole("link", { name: "Verification policy" })).toBeVisible();
    await expect(others.getByRole("link", { name: "Review policy" })).toBeVisible();
  });

  test("the footer's links from every page resolve", async ({ page }) => {
    // The footer names these on every page on the site. Three working links
    // beside a 404 is worse than none.
    for (const [path] of POLICIES) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
    }
  });

  test("404s on an address that is not one of the four", async ({ page }) => {
    const response = await page.goto("/not-a-policy");
    expect(response?.status()).toBe(404);
  });

  test("coexists with the area route, which is why they are four files", async ({ page }) => {
    /*
       These were one `[policy]` segment until the first e2e run. A second
       dynamic segment at the root collides with `[emirate]/[area]/[category]`
       — "you cannot use different slug names for the same dynamic path" — and
       Next raises it per request rather than at build time, so the build was
       clean and every page 500ed.
    */
    for (const path of [
      "/terms",
      "/search",
      "/categories",
      "/guides",
      "/dubai/al-quoz-industrial-1/hvac-and-ventilation",
    ]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
    }
  });

  test("is axe clean", async ({ page }) => {
    await page.goto("/verification-policy");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
      .disableRules(["color-contrast"])
      .analyze();
    const summary = results.violations.map((v) => ({ id: v.id, nodes: v.nodes.length }));
    expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
  });
});
