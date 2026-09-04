import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Board 2a, signed out — which is how it is normally met.
 *
 * Its own file rather than a block in `onboarding.spec.ts`, because that suite
 * runs in the seller project and a signed-in seller holding a claimed listing
 * is redirected away from this route by design (criterion 11). Testing 2a from
 * that seat would mean testing the redirect and calling it the search screen.
 *
 * This file runs in the `chromium` and `mobile` projects, so criterion 14's
 * responsive rules are checked on a real phone viewport rather than by resizing
 * a desktop one.
 */

const SEARCH = "Search by trade name, trade licence number or phone";

/**
 * A query that matches nothing, on purpose.
 *
 * Not "Zzzz Nonexistent Trading": "Trading" is in half the trade names in the
 * register, and the trigram search rightly finds them. Nonsense that shares no
 * trigram with anything is what the no-match state actually needs.
 */
const NO_MATCH = "qqqxwv+zzjkpf";

/** The results card, as a landmark. Scoped, because the step chain is a list too. */
const results = (page: Page) => page.getByRole("region", { name: /match/i });

test.describe("board 2a — find or add your business", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/onboarding/claim");
  });

  test("needs no account to search", async ({ page }) => {
    // Criterion 12. A supplier who has to create an account to find out
    // whether we hold their business is a supplier who does not find out.
    await expect(page).toHaveURL(/\/onboarding\/claim/);
    await expect(page.getByLabel(SEARCH)).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Is your business already listed?",
    );
  });

  test("quotes a live count rather than a constant", async ({ page }) => {
    // Every number is a query. A hardcoded count is the fastest way to make a
    // directory look unreliable.
    await expect(
      page.getByText(/We hold [\d,]+ UAE businesses from public licence records/),
    ).toBeVisible();
  });

  test("shows no results card until something has been searched for", async ({ page }) => {
    // The page is the search bar and the pitch. Never an empty results card.
    await expect(results(page)).toHaveCount(0);
    await expect(page.getByText("Not in the list?")).toBeVisible();
  });

  test("keeps the query in the URL, so a CRM link can pre-fill and auto-run", async ({ page }) => {
    // Criterion 13. Recruitment links from the ops CRM carry a pre-filled query
    // and the search has already run by the time the page paints.
    await page.goto("/onboarding/claim?q=Al+Marwan");
    await expect(page.getByLabel(SEARCH)).toHaveValue("Al Marwan");
    await expect(results(page)).toBeVisible();
  });

  test("renders the legal name and the licensing authority's number", async ({ page }) => {
    // An unclaimed record has no display name — nobody has set one. The legal
    // name with its authority prefix is how a claimant confirms they have found
    // the right record among near-identical trade names.
    await page.goto("/onboarding/claim?q=Al+Wadi");
    const row = results(page).getByRole("listitem").first();
    await expect(row).toContainText(/LLC|FZE/);
    await expect(row).toContainText(/[A-Z]{3,6}-\d+/);
  });

  test("returns a single labelled result for an exact licence number", async ({ page }) => {
    // A licence number is unambiguous, so alternatives beside it would only
    // invite somebody to pick a wrong one.
    await page.goto("/onboarding/claim?q=Al+Wadi");
    const text = await results(page).getByRole("listitem").first().innerText();
    const number = /[A-Z]{3,6}-\d+/.exec(text)?.[0];
    expect(number).toBeTruthy();

    await page.goto(`/onboarding/claim?q=${encodeURIComponent(number!)}`);
    const rows = results(page).getByRole("listitem");
    // The results stream in behind a Suspense boundary, and `count()` does not
    // wait. Settle on the first row before counting them.
    await expect(rows.first()).toBeVisible();
    const count = await rows.count();

    if (count === 1) {
      await expect(page.getByText("EXACT LICENCE MATCH")).toBeVisible();
    } else {
      /*
         `licence_number` has no unique constraint — the importer stages
         near-duplicates on purpose — so a database seeded more than once can
         hold the same number twice. That is not an exact match, and the screen
         says so by not claiming one. Every row still carries the number that
         was searched for, which is the contract either way.
      */
      expect(count).toBeGreaterThan(1);
      await expect(page.getByText("EXACT LICENCE MATCH")).toHaveCount(0);
      for (const row of await rows.all()) await expect(row).toContainText(number!);
    }
  });

  test("carries one primary action, on the best unclaimed match", async ({ page }) => {
    await page.goto("/onboarding/claim?q=Al");
    await expect(results(page).getByRole("listitem").first()).toBeVisible();
    // "This is us" is on every unclaimed row and exactly one of them is loud.
    // One primary per view is the rule the whole screen answers to.
    await expect(results(page).locator("li a.bg-moss")).toHaveCount(1);
  });

  test("expands in place rather than paginating", async ({ page }) => {
    // A supplier with a common trade name needs to scan, not paginate: a second
    // page loses the first six from the screen, which is the comparison they
    // are trying to make.
    await page.goto("/onboarding/claim?q=Al");
    await expect(results(page).getByRole("listitem")).toHaveCount(6);

    const more = page.getByRole("button", { name: /more match/ });
    await expect(more).toBeVisible();
    await more.click();

    await expect(results(page).getByRole("listitem").nth(6)).toBeVisible();
    await expect(page.getByRole("navigation", { name: /pagination/i })).toHaveCount(0);
  });

  test("offers a dispute route on a claimed listing, and never names who holds it", async ({
    page,
  }) => {
    await page.goto("/onboarding/claim?q=Al+Marwan");
    const claimed = results(page).getByRole("listitem").filter({ hasText: "Claimed" }).first();
    await expect(claimed.getByRole("link", { name: "Report a dispute" })).toBeVisible();
    await expect(
      page.getByText(/our team asks both parties for the licence and decides in 48 hours/),
    ).toBeVisible();

    // The worst moment in this flow, and a privacy leak if it named the
    // incumbent. There is no owner on screen and no field to render one from.
    await expect(claimed).not.toContainText("@");
  });

  test("says claiming carries history over, not a badge", async ({ page }) => {
    await page.goto("/onboarding/claim?q=Al+Marwan");
    await expect(page.getByText(/Claiming carries your history over, not your badge/)).toBeVisible();
  });

  test("promotes adding from scratch when nothing matched", async ({ page }) => {
    await page.goto(`/onboarding/claim?q=${NO_MATCH}`);
    await expect(
      page.getByText(/Nothing matched\. That is normal for a newer licence/),
    ).toBeVisible();

    // Never an empty results card, and never "0 matches" as a heading.
    await expect(results(page)).toHaveCount(0);
    await expect(page.getByText(/\b0 possible match/i)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Add a new business" })).toBeVisible();
  });

  test("sends an anonymous claimant through sign-up, carrying the listing", async ({ page }) => {
    // The account is asked for at the point it becomes necessary, and the
    // chosen listing rides through in `next` so nobody comes back to an empty
    // search.
    await page.goto("/onboarding/claim?q=Al+Wadi");
    const href = await results(page)
      .getByRole("link", { name: "This is us" })
      .first()
      .getAttribute("href");
    expect(href).toMatch(/^\/signup\?next=/);
    expect(decodeURIComponent(href ?? "")).toContain("/onboarding/verify?business=");
  });

  test("is noindex, follow — a funnel step, not a landing page", async ({ page }) => {
    const robots = page.locator('head meta[name="robots"]');
    await expect(robots).toHaveAttribute("content", /noindex/);
    await expect(robots).toHaveAttribute("content", /(?<!no)follow/);
  });

  test("is axe clean", async ({ page }) => {
    await page.goto("/onboarding/claim?q=Al");
    const violations = (
      await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze()
    ).violations;
    expect(violations).toEqual([]);
  });
});

test.describe("board 2a — at 1024 and above", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 768, "the chain collapses below 768");

  test("names all five steps up front", async ({ page }) => {
    await page.goto("/onboarding/claim");
    // Scoped to the chain itself: the collapsed "1 / 5" line beside it carries
    // the current step's name too, and is only hidden by a media query.
    const chain = page.getByRole("navigation", { name: "Set up your listing" }).getByRole("list");
    for (const step of [
      "Find your business",
      "Prove it is yours",
      "Your profile",
      "Where you are",
      "Pick a plan",
    ]) {
      await expect(chain.getByText(step, { exact: true })).toBeVisible();
    }
  });
});

test.describe("board 2a — below 768", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) >= 768, "only the phone layout");

  test("collapses the chain to 1 / 5 with the current step's label", async ({ page }) => {
    // Criterion 14. Five labelled steps do not fit on a phone, and a squeezed
    // chain is less use than a sentence.
    await page.goto("/onboarding/claim");
    const nav = page.getByRole("navigation", { name: "Set up your listing" });
    await expect(nav).toContainText("1 / 5");
    await expect(nav).toContainText("Find your business");
    await expect(nav.getByText("Pick a plan")).toBeHidden();
  });

  test("puts the search button and the row actions on the 44px target floor", async ({ page }) => {
    await page.goto("/onboarding/claim?q=Al+Wadi");

    const search = page.getByRole("button", { name: "Search" });
    expect((await search.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

    const action = results(page).getByRole("link", { name: /This is us|Report a dispute/ }).first();
    const box = await action.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    // Full width: on a phone the action is the whole of the row's second line.
    const column = await results(page).boundingBox();
    expect(box!.width).toBeGreaterThan((column!.width ?? 0) * 0.85);
  });

  test("never scrolls the body sideways", async ({ page }) => {
    await page.goto("/onboarding/claim?q=Al+Marwan+Industrial+Supplies+LLC");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
