import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { dashboardNavFor } from "@/components/structure/nav-config";
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

/*
   Boards 3j and 11b moved to their own files when the inbox was rebuilt:
   tests/e2e/dashboard-leads-inbox.spec.ts and
   tests/e2e/dashboard-lead-thread.spec.ts.

   Both names still match the seller project's filename regex, which is what
   decides whether a spec runs signed in — `leads.spec.ts` would have run
   signed *out*, in chromium and mobile, and failed on a redirect.

   What was here asserted a seven-column table, a row link that landed on
   the thread route, and a sidebar badge equal to the table's row count minus one.
   The first two are gone by design — the rail is a list and the composer is on
   the lead — and the third encoded the badge counting delivered, opened *and*
   quoted, which is a different population from the Open tab it now sits above.
   The rule-1 assertions it carried are kept and widened in the new file.
*/

/*
   Board 3k moved to tests/e2e/dashboard-quotes-pipeline.spec.ts when the
   pipeline was rebuilt.

   What was here asserted a seven-column table of every quote row, a
   hand-priced count in the Lines column, and the footer "Quoted value,
   self-reported." All three are gone by design: the pipeline shows one row per
   lead rather than one per revision, the hand-priced signal belongs with the
   composer that produces it, and the self-reported caveat is now on the header
   strip beside the figure it qualifies rather than under a table.
*/

/*
   Board 7e's own screen moved to tests/e2e/dashboard-settings.spec.ts when it
   was rebuilt: the matrix, the reachability rail, the channel verification and
   the acknowledgement are a board's worth of assertions and they belong in one
   file with the board's number on it.

   Two of what was here are gone by design rather than untested. The matrix has
   six columns now, not five — §2 adds `GOES TO`, because a row of ticks with no
   statement of whose handset they reach is a control with an unanswered
   question in it. And quiet hours no longer name a window: §5 makes the Hours
   page the one source for them, the acknowledgement and board 7d's routing
   skip, so the label is "outside your working hours" rather than "overnight".

   What stays: the one fact about this screen that is this file's subject rather
   than 7e's — that a channel waiting on a carrier says so instead of looking
   broken.
*/
test.describe("board 7e — alerts, from the dashboard side", () => {
  test("says WhatsApp is waiting on Meta rather than looking broken", async ({ page }) => {
    await page.goto("/dashboard/settings");
    await expect(page.getByText(/waiting on Meta to approve/)).toBeVisible();
  });

  test("carries the high-value override", async ({ page }) => {
    await page.goto("/dashboard/settings");
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
    await expect(page.getByRole("button", { name: /delete/i })).toHaveCount(0);
  });

  test("explains the rules for asking, at the moment of asking", async ({ page }) => {
    await page.goto("/dashboard/reviews");
    await expect(page.getByText(/One request each, ever/)).toBeVisible();
    // The incentive prohibition belongs on the panel and not in a help article.
    await expect(page.getByText(/never offer an incentive for a review/)).toBeVisible();
    // `B2`: the channel is stated per buyer, and the fallback is real.
    await expect(page.getByText(/WhatsApp where we have a number, email otherwise/)).toBeVisible();
  });

  test("criterion 1 — the request button counts the selection", async ({ page }) => {
    /*
       The board rendered `Send 8 requests` above a chip list with two ticked,
       which means either the button ignored the selection or the selection was
       decorative. Both are wrong on a control that messages customers.
    */
    await page.goto("/dashboard/reviews");
    const boxes = page.getByRole("checkbox").and(page.locator(":not([disabled])"));
    const count = await boxes.count();
    test.skip(count === 0, "no eligible buyers on this seed");

    // Nothing starts ticked: eight buyers pre-selected is eight messages one
    // click away, under a rule that says one request per buyer ever.
    await expect(page.getByRole("button", { name: /^Send requests$/ })).toBeDisabled();

    await boxes.first().check();
    await expect(page.getByRole("button", { name: "Send 1 request" })).toBeEnabled();
    if (count > 1) {
      await boxes.nth(1).check();
      await expect(page.getByRole("button", { name: "Send 2 requests" })).toBeEnabled();
    }
  });

  test("criterion 6 and 7 — the rail lists the grounds and starts nothing", async ({ page }) => {
    await page.goto("/dashboard/reviews");
    const rail = page.getByRole("heading", { name: "Disputing a review" });
    await expect(rail).toBeVisible();

    // Four grounds, four rows. The board's own render counted four in the prose
    // above and showed three below, having merged abuse and private
    // information into one line.
    for (const ground of [
      /No traceable enquiry/,
      /Abusive language/,
      /Private information about a person/,
      /A factual claim you can prove is false/,
    ]) {
      await expect(page.getByText(ground).first()).toBeVisible();
    }
    await expect(page.getByText(/“It is unfair” is not a ground/)).toBeVisible();

    /*
       Criterion 7: no dispute can be started from the rail. The board drew a
       radio pre-selected on the first ground, for a dispute nobody had started
       against a review nobody had chosen — so the rail carries no form control
       at all, and the flow begins at a review.
    */
    const railCard = page.locator("section, div").filter({ has: rail }).last();
    await expect(railCard.getByRole("radio")).toHaveCount(0);
  });

  test("criterion 11 — with no reviews, a page about earning them", async ({ page }) => {
    /*
       This seat is the no-reviews fixture on purpose: `reviews-page.spec.ts`
       names `al-marwan-industrial-supplies-llc` as `NO_REVIEWS` and board 1m
       asserts the storefront state that follows from it. So this is the state
       the acceptance suite can reach from a seller session, and it is the one
       §States calls *"the most common state on this board"* — almost every
       supplier opens this page with nothing on it.

       The header's arithmetic is asserted in tests/integration/reviews-11c,
       against a business that has reviews. Adding some here to reach it would
       break four assertions on a board this one does not own.
    */
    await page.goto("/dashboard/reviews");
    await expect(page.getByRole("heading", { name: "No reviews yet" })).toBeVisible();
    await expect(page.getByText(/enquired and heard back from you/)).toBeVisible();
    // Not an empty table, and not a dead button either: the panel above says
    // who becomes eligible and when.
    await expect(page.locator("table")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Ask for a review" })).toBeVisible();
  });

  test("the request panel is reachable and operable from the keyboard", async ({ page }) => {
    /*
       The one control on this page that sends messages to customers, driven
       without a mouse. Space toggles a buyer and the button's label follows —
       criterion 1 holds on the keyboard too, or the count is a mouse-only
       promise.
    */
    await page.goto("/dashboard/reviews");
    const boxes = page.getByRole("checkbox").and(page.locator(":not([disabled])"));
    test.skip((await boxes.count()) === 0, "no eligible buyers on this seed");

    await boxes.first().focus();
    await expect(boxes.first()).toBeFocused();
    await page.keyboard.press("Space");
    await expect(boxes.first()).toBeChecked();

    const send = page.getByRole("button", { name: "Send 1 request" });
    await expect(send).toBeEnabled();
    await page.keyboard.press("Tab");
    // The next stop is the button, not a decorative element between them.
    await expect(send).toBeFocused();
  });

  test("the rated-on rail says what it has rather than drawing empty bars", async ({ page }) => {
    /*
       Cold start again, and the honest version of it: no reviews means no
       dimension averages, and a rail of four zeroed bars would read as four
       scores of nothing rather than as no data.

       Criterion 4 — that the weakest line says so in words rather than in an
       amber bar alone — is asserted in tests/integration/reviews-11c against a
       business with reviews, for the reason the test above gives.
    */
    await page.goto("/dashboard/reviews");
    await expect(page.getByRole("heading", { name: "Rated on" })).toBeVisible();
    await expect(page.getByText(/Dimension scores appear once a buyer has written/)).toBeVisible();
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
    /*
     * `dashboardNavFor`, not `DASHBOARD_NAV` — board `3f-s` B1.
     *
     * The rail is filtered by what the seller sells: a firm that sells work has
     * no products, and one that sells goods has no services. This seat is a
     * goods seller, so reading the static config would assert a *Services* row
     * that is correctly absent. The filtering is the thing under test on the
     * services seat's own spec; here the point is still that every row the rail
     * offers is either a link or named-and-deferred.
     */
    const items = dashboardNavFor("unset").flatMap((group) => group.items);
    expect(items.length).toBeGreaterThan(5);
    expect(items.some((item) => item.key === "services")).toBe(false);

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
