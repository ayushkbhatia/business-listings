import { expect, test } from "@playwright/test";

/**
 * Board 8e — the completion screen's guards, in a browser.
 *
 * Named `dashboard-setup-done` so the signed-in `seller` project picks it up.
 *
 * ## Why this asserts the redirects and not the render
 *
 * The screen is once-only by design: `SetupBaseline.doneSeenAt` is flipped on
 * the first render and every arrival after that is sent to the dashboard. That
 * marker is a fixture a test can spend exactly once — a spec that rendered the
 * screen would pass on a fresh database, consume the marker, and fail on every
 * later run against the same one. It is the same trap
 * `tests/integration/admin-queues.test.ts` documents for seeded review rows,
 * and the shared local database makes it worse rather than better.
 *
 * So the render is covered where it can be set up and torn down —
 * tests/integration/setup-done.test.ts, twenty-one cases including the once-only
 * marker under concurrency — and what runs here is the half that needs a real
 * request: that an unfinished seller is turned away rather than shown a partial
 * version of a completion screen.
 *
 * The seat is al-marwan-industrial-supplies-llc, which the seed gives a
 * catalogue and no photographs, so its photos task is open and this spec can
 * assert the precondition without touching anything.
 */

test.describe("board 8e — the completion screen's preconditions", () => {
  test("turns away a seller who still has a task open", async ({ page }) => {
    /*
       §5: never render a partial version of this screen. A completion screen
       over unfinished work is the same class of claim as one over a suspended
       listing — it says the job is done when it is not.
    */
    await page.goto("/dashboard/setup/done");
    await expect(page).toHaveURL(/\/dashboard\/setup$/);
  });

  test("sends them to a hub that still lists what is left", async ({ page }) => {
    // The redirect is only right if its destination is useful. Landing on a hub
    // that says "nothing left" would be the same lie one route along.
    await page.goto("/dashboard/setup/done");
    await expect(page.getByText(/things left|thing left/)).toBeVisible();
  });

  test("offers no link into the completion screen from the hub", async ({ page }) => {
    /*
       §1: the transition is the only trigger. A "view your setup summary" entry
       point is exactly what the amber card on that screen promises does not
       exist, so a link to it anywhere would make the card false.
    */
    await page.goto("/dashboard/setup");
    await expect(page.locator('a[href="/dashboard/setup/done"]')).toHaveCount(0);
  });

  test("has no site-visit task left on the hub", async ({ page }) => {
    // The board this screen replaced. Three tasks, and the fourth is gone.
    await page.goto("/dashboard/setup");
    await expect(page.getByText(/site visit/i)).toHaveCount(0);
    await expect(page.locator('a[href="/dashboard/setup/visit"]')).toHaveCount(0);
  });
});
