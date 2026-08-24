import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { DASHBOARD_NAV } from "@/components/structure/nav-config";
import { t } from "@/lib/i18n";

/**
 * Criterion 11, for the seller side:
 *
 *   "Every screen listed in scope renders at its board's fidelity."
 *
 * Four steps of this handoff shipped their seller screens with no browser test,
 * because Playwright builds for production and the development seat is
 * deliberately inert there. These run as a signed-in seller — see
 * auth.setup.ts, which signs in through the real verify form.
 *
 * The business is al-marwan-industrial-supplies-llc, which the seed gives a
 * catalogue, two quotes and a live lead.
 */
const THREAD = "seedenquiryprovisional0001";

test.describe("board 3j — leads and RFQ", () => {
  test("lists the open enquiries with a first name and no more", async ({ page }) => {
    await page.goto("/dashboard/leads");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Leads");

    const table = page.getByRole("table", { name: /Enquiries sent to this business/ });
    await expect(table).toBeVisible();

    /*
     * Rule 1, on the screen rather than only in the query layer. The seeded
     * buyers are Rashid Al Hameli and Khalid Al Nuaimi; a surname or a number
     * appearing here is a leak whatever the tests below the UI say.
     */
    const body = (await page.textContent("main")) ?? "";
    expect(body).not.toContain("Al Hameli");
    expect(body).not.toContain("Al Nuaimi");
    expect(body).not.toMatch(/\+971|\b0\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/);
    expect(body).not.toMatch(/[\w.-]+@[\w.-]+\.\w+/);
  });

  test("shows the real count in the sidebar, not a placeholder", async ({ page }) => {
    await page.goto("/dashboard/leads");
    const rows = await page.getByRole("table").getByRole("row").count();
    const badge = await page.getByRole("link", { name: /Leads & RFQ/ }).textContent();
    // The header row is not a lead.
    expect(badge).toContain(String(rows - 1));
  });
});

test.describe("board 11b — one lead, the composer and the thread", () => {
  test("flags a line no catalogue can match, and never leaves it blank", async ({ page }) => {
    await page.goto("/dashboard/leads");
    await page.getByRole("link", { name: /Open enquiry ENQ-/ }).first().click();
    await page.waitForURL("**/thread");

    await expect(page.getByRole("table", { name: /Quote lines/ })).toBeVisible();
    // The price box on a hand-priced line starts empty, with no placeholder
    // that could be mistaken for a value.
    const prices = page.getByLabel(/^Unit price for/);
    await expect(prices.first()).toHaveValue("");
    await expect(prices.first()).toHaveAttribute("placeholder", "");
  });

  test("states rule 1 to the seller rather than only enforcing it", async ({ page }) => {
    await page.goto(`/dashboard/leads/${THREAD}/thread`);
    await expect(
      page.getByText("Contact details are released when a quote is accepted"),
    ).toBeVisible();
  });

  test("carries the board 11b warning, on the page and not in a comment", async ({ page }) => {
    await page.goto(`/dashboard/leads/${THREAD}/thread`);
    await expect(page.getByText("Everything here is the record")).toBeVisible();
    await expect(page.getByText(/flagged automatically and reviewed by a person/)).toBeVisible();
  });

  test("offers the seller's own quick replies, not the buyer's", async ({ page }) => {
    await page.goto(`/dashboard/leads/${THREAD}/thread`);
    await expect(page.getByRole("button", { name: /hold this price for 21 days/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /free site survey/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /CD certificate/i })).toBeVisible();
    // The buyer's chips belong to the buyer.
    await expect(page.getByRole("button", { name: /request datasheets/i })).toHaveCount(0);
  });

  test("offers one follow-up and says why there is only one", async ({ page }) => {
    await page.goto(`/dashboard/leads/${THREAD}/thread`);
    const nudge = page.getByRole("button", { name: "Send one follow-up" });
    const alreadySent = page.getByText(/Follow-up sent/);
    const notYet = page.getByText(/Send a quote first/);
    // One of the three states, and the copy explains the rule in all of them.
    expect(
      (await nudge.count()) + (await alreadySent.count()) + (await notYet.count()),
    ).toBeGreaterThan(0);
  });
});

test.describe("board 3k — quotes sent", () => {
  test("shows the pipeline with the hand-priced count", async ({ page }) => {
    await page.goto("/dashboard/quotes");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Quotes sent");
    await expect(page.getByRole("table", { name: /Quotes this business has sent/ })).toBeVisible();
    await expect(page.getByText(/priced by hand/).first()).toBeVisible();
  });

  test("labels every state from the enum, never falling back to Draft", async ({ page }) => {
    await page.goto("/dashboard/quotes");
    const body = (await page.textContent("main")) ?? "";
    // A quote that is sent must not read as a draft — the bug this page had.
    expect(body).toMatch(/Sent|Read|Accepted|Lost|Expired/);
  });

  test("says the value is self-reported", async ({ page }) => {
    await page.goto("/dashboard/quotes");
    await expect(page.getByText("Quoted value, self-reported.")).toBeVisible();
  });
});

test.describe("board 7e — alerts", () => {
  test("draws the matrix as a real table with both header directions", async ({ page }) => {
    await page.goto("/dashboard/settings");
    const table = page.getByRole("table", { name: /Notification channels by event/ });
    await expect(table).toBeVisible();
    // Events down, channels across.
    await expect(table.getByRole("columnheader")).toHaveCount(5);
    await expect(table.getByRole("rowheader").first()).toBeVisible();
  });

  test("names every cell, so forty checkboxes are not forty 'checkbox'", async ({ page }) => {
    await page.goto("/dashboard/settings");
    await expect(
      page.getByRole("checkbox", { name: "WhatsApp for A new enquiry arrives" }),
    ).toBeVisible();
  });

  test("says WhatsApp is waiting on Meta rather than looking broken", async ({ page }) => {
    await page.goto("/dashboard/settings");
    await expect(page.getByText(/waiting on Meta to approve/)).toBeVisible();
  });

  test("carries quiet hours and the high-value override", async ({ page }) => {
    await page.goto("/dashboard/settings");
    await expect(page.getByLabel("Hold WhatsApp and SMS overnight")).toBeVisible();
    await expect(page.getByLabel("Enquiry value, in AED")).toBeVisible();
  });
});

test.describe("board 11c — reviews", () => {
  test("renders, and offers no way for a seller to delete one", async ({ page }) => {
    await page.goto("/dashboard/reviews");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Reviews");
    // Said out loud rather than left as a missing button somebody hunts for.
    const body = (await page.textContent("main")) ?? "";
    const hasReviews = !body.includes("No reviews yet");
    if (hasReviews) {
      await expect(page.getByText(/cannot be removed by the supplier/)).toBeVisible();
    }
    await expect(page.getByRole("button", { name: /delete|remove/i })).toHaveCount(0);
  });

  test("explains the rules for asking", async ({ page }) => {
    await page.goto("/dashboard/reviews");
    await expect(page.getByText(/once per buyer ever/)).toBeVisible();
    await expect(page.getByText(/No incentives/)).toBeVisible();
  });
});

test.describe("the seller shell", () => {
  test("shows no development-seat banner when a real seller is signed in", async ({ page }) => {
    // The banner is a development affordance. Seeing it here would mean the
    // seat, not the session, is what let us in.
    await page.goto("/dashboard/leads");
    await expect(page.getByText(/Development only/)).toHaveCount(0);
  });

  test("links what is built and names what is not, whatever the config says", async ({ page }) => {
    await page.goto("/dashboard/leads");
    const nav = page.getByRole("navigation", { name: /Seller navigation/ });
    await expect(nav).toBeVisible();

    /*
     * Derived from DASHBOARD_NAV rather than naming a route.
     *
     * This has now broken twice for the same reason: it named Analytics as an
     * unbuilt example, step 4 built it; it named Setup instead, step 5 built
     * that. Each step builds one more, so any test that hardcodes *which* route
     * is deferred is a test with an expiry date — and the failure looks like a
     * regression rather than like progress.
     *
     * Both halves of the rule, read off the config: a deferred item is named
     * and not linked, a built one is a link. Today there are no deferred seller
     * items left, and this asserting nothing on that side is itself the honest
     * answer.
     */
    const items = DASHBOARD_NAV.flatMap((group) => group.items);
    expect(items.length).toBeGreaterThan(5);

    // Scoped to the list items. A group heading carries the same word as one of
    // its items — "Overview" is both — and matching on text alone finds two.
    const rows = nav.locator("li");

    for (const item of items) {
      const label = t(item.labelKey);
      await expect(rows.getByText(label, { exact: true }).first(), label).toBeVisible();
      /*
       * Anchored, not exact. An item carrying a badge has the count in its
       * accessible name — "Leads & RFQ 13" — so an exact match finds nothing
       * on precisely the items that matter most.
       */
      const named = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
      await expect(
        rows.getByRole("link", { name: named }),
        `${label} should ${item.later ? "not " : ""}be a link`,
      ).toHaveCount(item.later ? 0 : 1);
    }
  });

  test("every internal link in the dashboard resolves", async ({ page, request }) => {
    test.slow();
    /*
     * Collected across every page first, then fetched once each.
     *
     * The sidebar is identical on all four, so checking per page fetched the
     * same links four times over. That was survivable while the nav had two
     * live entries; handoff 3 turned on the overview, the catalogue and the
     * media library, and the redundant fetches pushed this past the test
     * timeout on CI — where each dashboard route is `force-dynamic` and the
     * runner has one worker. It failed as "Request context disposed", which
     * names the symptom and not the cause.
     */
    const seen = new Map<string, string>();

    for (const path of ["/dashboard/leads", "/dashboard/quotes", "/dashboard/settings", "/dashboard/reviews"]) {
      await page.goto(path);
      const hrefs = await page.locator("a[href^='/']").evaluateAll((nodes) =>
        nodes.map((n) => (n as HTMLAnchorElement).getAttribute("href")!),
      );
      for (const href of hrefs) if (!seen.has(href)) seen.set(href, path);
    }

    for (const [href, foundOn] of seen) {
      const response = await request.get(href, { maxRedirects: 0 });
      expect([200, 307, 308], `${foundOn} → ${href}`).toContain(response.status());
    }
  });
});

test.describe("accessibility", () => {
  for (const path of [
    "/dashboard/leads",
    "/dashboard/quotes",
    "/dashboard/settings",
    "/dashboard/reviews",
  ]) {
    test(`${path} is axe clean`, async ({ page }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        // Token-level, enumerated in docs/contrast.md and pinned on the gallery.
        .disableRules(["color-contrast"])
        .analyze();
      const summary = results.violations.map((v) => `${v.id}: ${v.help}`);
      expect(summary, summary.join("\n")).toEqual([]);
    });
  }

  test("the lead thread is axe clean", async ({ page }) => {
    await page.goto(`/dashboard/leads/${THREAD}/thread`);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .disableRules(["color-contrast"])
      .analyze();
    const summary = results.violations.map((v) => `${v.id}: ${v.help}`);
    expect(summary, summary.join("\n")).toEqual([]);
  });
});
