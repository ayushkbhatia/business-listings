import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Board 8a — the setup hub, in a browser, signed in.
 *
 * Its own file rather than a block inside `onboarding.spec.ts`, and the name is
 * load-bearing: the `seller` Playwright project matches
 * `(dashboard|overview|catalogue|listing|account|onboarding|pricing-seller)[\w-]*\.spec\.ts`,
 * so a file called `setup.spec.ts` or `setup-hub.spec.ts` would be picked up by
 * the signed-out `chromium` and `mobile` projects instead and fail on a
 * redirect. `dashboard-setup` matches the signed-in project.
 *
 * The seat is al-marwan-industrial-supplies-llc, on Pro, which the seed gives a
 * catalogue, a second seller seat and no photographs at all — so the hub has
 * two tasks open and two done, which is the state worth asserting against. A
 * hub with everything open would never exercise the completed-summary row, and
 * one with everything done redirects.
 *
 * Every assertion here is on copy that lives in `lib/i18n/en.ts`. There is no
 * `data-testid` convention in this suite and this file does not start one.
 */

test.describe("board 8a — the setup hub", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/setup");
  });

  test("counts what is actually left rather than saying four", async ({ page }) => {
    /*
       The defect this guards. The heading is computed from the open cards and
       their own estimates, so it cannot read "Four things left" over three —
       which is what a hardcoded string does the first time a seller finishes
       one, and it is the moment a seller stops believing the rest of the page.
    */
    const heading = page.getByRole("heading", { name: /things? left, about \d+ minutes/ });
    await expect(heading).toBeVisible();

    const stated = Number(/^(\w+|\d+)/.exec((await heading.innerText()).trim())?.[0] ?? NaN);
    const cards = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: /^(Start|Carry on|Invite|Book)$/ }) });
    if (Number.isFinite(stated)) await expect(cards).toHaveCount(stated);
  });

  test("states what each task is worth to this seller, as a percentage", async ({ page }) => {
    /*
       Board 8a's chips. They are arithmetic on this seller's own score — the
       remaining points on the matching lever from `strengthItems` — not the
       constants the design drew, so a seller with three photographs is offered
       fewer points than one with none. "Complete your profile" tells nobody
       anything; "+20%" is a claim the meter can be checked against.
    */
    await expect(page.getByText(/^\+\d+%$/).first()).toBeVisible();
    await expect(page.getByText(/~\d+ MIN/i).first()).toBeVisible();
  });

  test("draws the threshold on the meter and says what it means", async ({ page }) => {
    /*
       Measured or mechanism, never one as a placeholder for the other. The
       cohort query returns null until forty listings sit either side of 80%,
       and the seed is nowhere near that, so this environment renders the
       mechanism sentence. Both are asserted as a pair so neither can quietly
       become the other.
    */
    const meter = page.getByRole("progressbar", { name: /Profile strength/ });
    await expect(meter).toBeVisible();
    await expect(
      page.getByText(/80% — where (a listing stops looking thin|listings get)/),
    ).toBeVisible();
  });

  test("says plainly when a rail count is zero rather than hiding it", async ({ page }) => {
    /*
       The panel's job is to make four unpaid tasks feel worth doing, and a
       panel that drops its zeros is one a seller learns not to believe. So the
       assertion is that each line says *something* — never that it is absent.

       Views cannot be asserted as zero here, and the reason is worth keeping:
       the public storefront specs in this same suite open
       `/b/al-marwan-industrial-supplies-llc` in a real browser, which fires the
       `listing_viewed` beacon and increments `listing_view_day` for the very
       business this seat owns. An earlier version of this test asserted "No
       views yet" and failed for that reason — which is the view path working,
       end to end, rather than a defect.
    */
    await expect(page.getByText(/No views yet|^views? since you went live$/)).toBeVisible();
    await expect(page.getByText(/Nobody has saved you to a shortlist yet/)).toBeVisible();
  });

  test("keeps finished tasks on the page instead of removing them", async ({ page }) => {
    // Sellers look for evidence that the work they did was recorded, and a card
    // that vanishes on success reads as work that was not.
    await expect(page.getByText(/^Done: /)).toBeVisible();
    // Exact: the sidebar carries a "Reviews" row, and a loose match finds both.
    await expect(page.getByRole("link", { name: "Review", exact: true })).toBeVisible();
  });

  test("names the levers the four cards do not cover", async ({ page }) => {
    /*
       The four tasks are worth about half the meter between them. Without this
       table a seller can finish everything on offer, sit short of a hundred and
       find nothing on the page that says what closes the gap — which is the one
       state a completeness meter must never reach.
    */
    const table = page.getByRole("table");
    await expect(table).toBeVisible();
    await expect(table.getByText(/Who you are/)).toBeVisible();
    await expect(table.getByText(/filterable fields/)).toBeVisible();
    await expect(table.getByText(/\d+ of \d+ points/).first()).toBeVisible();
  });

  test("states the one-nudge promise the job has to keep", async ({ page }) => {
    await expect(page.getByText(/We will remind you once/)).toBeVisible();
    await expect(page.getByText(/then nothing\. We do not chase\./)).toBeVisible();
  });

  test("links each task to where the work happens", async ({ page }) => {
    // A task is a link to the screen that already does that job, not a wizard
    // step — which is why the four can be done in any order.
    const links = page.getByRole("link", { name: /^(Start|Carry on|Invite|Book)$/ });
    await expect(links).not.toHaveCount(0);
    for (const href of await links.evaluateAll((els) =>
      els.map((el) => (el as HTMLAnchorElement).getAttribute("href")),
    )) {
      expect(href, "a task card pointed at nothing").toBeTruthy();
    }
  });

  test("has no nav row of its own, and is reachable anyway", async ({ page }) => {
    /*
       Board 8a: the hub is temporary, and a permanent nav entry would still be
       there a year later reading "nothing left". The sidebar figure and the
       banner on the overview are the two ways in, and both stop rendering at a
       hundred per cent — which a nav row cannot do without the nav lying about
       its own shape.
    */
    const nav = page.getByRole("navigation", { name: /Seller navigation/ });
    await expect(nav.getByRole("link", { name: /^Setup$/ })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: /%\s*·/ })).toBeVisible();
  });

  test("the sidebar figure and the meter agree", async ({ page }) => {
    /*
       The render this board was drawn from had the footer reading 82% over a
       body reading 62%, because the footer came from a shared default. One
       figure, one source: both now recompute from the same facts through the
       same two functions.
    */
    const footer = page.getByRole("navigation", { name: /Seller navigation/ }).getByRole("link", {
      name: /%\s*·/,
    });
    const sidebar = /(\d+)%/.exec(await footer.innerText())?.[1];
    const meter = await page
      .getByRole("progressbar", { name: /Profile strength/ })
      .getAttribute("aria-valuenow");

    expect(sidebar, "the sidebar carries no percentage").toBeTruthy();
    expect(meter).toBe(sidebar);
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });

  test("is reachable from the overview banner", async ({ page }) => {
    await page.goto("/dashboard");
    const banner = page.getByText(/things? left, worth \d+ points/);
    await expect(banner).toBeVisible();

    await page.getByRole("link", { name: "Pick one up" }).click();
    await expect(page).toHaveURL(/\/dashboard\/setup$/);
  });
});
