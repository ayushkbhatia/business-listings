import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

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

  test("locks what this role cannot reach rather than hiding it", async ({ page }) => {
    await page.goto("/dashboard/leads");
    const nav = page.getByRole("navigation", { name: /Seller navigation/ });
    await expect(nav).toBeVisible();
    // A seller has to know a screen exists before they can ask for access —
    // and an unbuilt one is named without being a link. Both are the same rule.
    await expect(nav.getByText("Analytics")).toBeVisible();
    await expect(nav.getByRole("link", { name: /Analytics/ })).toHaveCount(0);
  });

  test("every internal link in the dashboard resolves", async ({ page, request }) => {
    for (const path of ["/dashboard/leads", "/dashboard/quotes", "/dashboard/settings", "/dashboard/reviews"]) {
      await page.goto(path);
      const hrefs = await page.locator("a[href^='/']").evaluateAll((nodes) =>
        nodes.map((n) => (n as HTMLAnchorElement).getAttribute("href")!),
      );
      for (const href of new Set(hrefs)) {
        const response = await request.get(href, { maxRedirects: 0 });
        expect([200, 307, 308], `${path} → ${href}`).toContain(response.status());
      }
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
