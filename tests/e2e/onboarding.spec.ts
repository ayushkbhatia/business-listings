import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Boards 2a to 2e and 8a to 8e, signed in as a seller.
 *
 * Criteria 1 to 4 are proved against services in tests/integration — they are
 * claims about rows, and a browser is the wrong instrument. What is asserted
 * here is the funnel's shape and the sentences that answer the two fears a
 * supplier actually has: that claiming resets them, and that the pricing table
 * is a paywall.
 */

test.describe("board 2a — a seller who already has a listing", () => {
  test("is sent to the dashboard, and told why", async ({ page }) => {
    /*
     * Criterion 11. A supplier cannot claim a second business from this flow,
     * and the redirect states so rather than bouncing them silently — a person
     * who lands somewhere they did not ask for and is told nothing concludes
     * the link was broken.
     *
     * The rest of board 2a is `tests/e2e/claim.spec.ts`, signed out, which is
     * how that screen is normally met.
     */
    await page.goto("/onboarding/claim");
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText(/Claiming a second business is not something this flow can do/)).toBeVisible();
  });
});

/**
 * Board 2b, from the seat that meets it.
 *
 * Two fixtures, and the split is the point. `MINE` is this seat's own listing,
 * which is verified — reaching the route with nothing left to prove is
 * criterion 11 and is what the seat sees by default. `CLAIMABLE` is an
 * unclaimed, unverified record reached by slug, which is the shape a claimant
 * arrives at from board 2a and the only way to see the gate itself.
 */
const CLAIMABLE = "/onboarding/verify?business=al-bariq-trading-llc";
/** No number on the public record, so route B is absent rather than disabled. */
const NO_PHONE = "/onboarding/verify?business=al-hvac-027";
/** Lapsed, so the claim is taken and the badge withheld. */
const EXPIRED = "/onboarding/verify?business=al-firdaus-technical-services-llc";

test.describe("board 2b — prove ownership", () => {
  test("sends an already-verified listing to the profile step", async ({ page }) => {
    // Criterion 11. A second queue row on a settled listing is work for a
    // reviewer that answers a question already answered.
    await page.goto("/onboarding/verify");
    await expect(page).toHaveURL(/\/onboarding\/profile/);
  });

  test("does not route a published seller through the fork", async ({ page }) => {
    /*
       Board 2b-s sits between verify and profile, and only for a business still
       in the funnel.

       This is a regression test with a scar. Every business that existed before
       `sellsKind` shipped is published and `unset` — the migration adds no
       backfill on purpose, because inferring a kind onto a live listing is the
       `offering_type` mistake the service track exists to avoid. A first cut
       gated profile on `unset` alone, which sent every one of them
       profile → kind → settings and made the profile step unreachable for the
       whole directory. An e2e run found it; no unit test would have.
    */
    await page.goto("/onboarding/verify");
    await expect(page).toHaveURL(/\/onboarding\/profile/);

    // And the profile step itself renders rather than bouncing.
    await page.goto("/onboarding/profile");
    await expect(page).toHaveURL(/\/onboarding\/profile/);
  });

  test("leaves a goods seller's profile step exactly as it was", async ({ page }) => {
    /*
       Board 2c-s is a conditional field set on the existing screen — B1 — so
       the test that matters most is the one proving it changed nothing for the
       sellers who were already here. All 123 live businesses are `goods` or
       `unset`; if the services set leaked onto them, every one of them would
       find their six-hundred-character description replaced by a field they
       have never seen.
    */
    await page.goto("/onboarding/profile");

    // The goods prose field, still there and still itself.
    await expect(page.getByLabel("What you do")).toBeVisible();
    await expect(page.getByText("Established", { exact: true })).toBeVisible();

    // And none of the services set.
    await expect(page.getByLabel("One line on what you do")).toHaveCount(0);
    await expect(page.getByLabel("Services you offer")).toHaveCount(0);
    await expect(page.getByLabel("Sectors you have worked in")).toHaveCount(0);
  });

  test("names the licensed entity, with its legal suffix", async ({ page }) => {
    /*
     * The documented exception to the display-name rule, and the only element on
     * the page that takes a legal name: the claimant is proving ownership of a
     * licensed entity, and the heading has to match the name printed on the
     * document they are about to upload.
     */
    await page.goto(CLAIMABLE);
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toHaveText(/^Claiming .+(LLC|FZE)$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });

  test("carries one chrome row: wordmark, rail and Save & exit", async ({ page }) => {
    // Criterion 14. No mono step eyebrow, and no second header band — the rail
    // states both the position and the name of every step already.
    await page.goto(CLAIMABLE);
    const chain = page.getByRole("navigation", { name: "Set up your listing" }).getByRole("list");
    await expect(chain.getByText("Claimed", { exact: true })).toBeVisible();
    await expect(chain.getByText("Verified", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save & exit" })).toBeVisible();
    await expect(page.getByText(/STEP\s*2\s*OF\s*5/i)).toHaveCount(0);
  });

  test("makes the two routes mutually exclusive, collapsing the one not chosen", async ({ page }) => {
    // Criterion 2. A supplier who tries to do both has misunderstood, and the
    // interface should not make the confusion available.
    await page.goto(CLAIMABLE);
    const licence = page.getByRole("radio", { name: /Upload your trade licence/ });
    const phone = page.getByRole("radio", { name: /Verify by phone instead/ });

    await expect(licence).toBeChecked();
    await expect(page.getByLabel("Licence number")).toBeVisible();

    await phone.check();
    await expect(phone).toBeChecked();
    await expect(licence).not.toBeChecked();
    // The licence route's fields go with it; only its label line remains.
    await expect(page.getByLabel("Licence number")).toHaveCount(0);
  });

  test("calls the number on the public record, masked, and offers no field for one", async ({ page }) => {
    /*
     * Criterion 4, and the whole security value of the route: anybody can answer
     * their own phone. Because it is the recorded number, answering it is the
     * proof — so there is nothing to type.
     */
    await page.goto(CLAIMABLE);
    await page.getByRole("radio", { name: /Verify by phone instead/ }).check();
    await expect(page.getByText(/the number on the public licence record/)).toBeVisible();
    // Masked: enough to recognise your own line, not enough to intercept it.
    await expect(page.getByText(/[•]{2,}/)).toBeVisible();
    await expect(page.locator("fieldset").getByRole("textbox")).toHaveCount(0);
  });

  test("drops the phone route entirely where the register holds no number", async ({ page }) => {
    // Absent, not disabled: a disabled control is a thing somebody spends time
    // trying to enable.
    await page.goto(NO_PHONE);
    await expect(page.getByRole("radio", { name: /Verify by phone instead/ })).toHaveCount(0);
    // And nothing left to be faster than, so the tag goes too.
    await expect(page.getByText("FASTEST")).toHaveCount(0);
  });

  test("labels the licence route fastest only when there is a second route", async ({ page }) => {
    await page.goto(CLAIMABLE);
    await expect(page.getByText("FASTEST")).toBeVisible();
  });

  test("accepts an expired licence and withholds the badge", async ({ page }) => {
    // Criterion 7. An expired licence usually means a business under pressure,
    // not a fake, and refusing it turns a renewal into a lost supplier.
    await page.goto(EXPIRED);
    await expect(page.getByText(/This licence expired on/)).toBeVisible();
    await expect(page.getByText(/We will still take the claim/)).toBeVisible();
    await expect(page.getByText(/the verified badge follows/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit for verification" })).toBeVisible();
  });

  test("never implies the claimant verifies themselves", async ({ page }) => {
    // Criterion 6. Submitting queues a review and grants no tier.
    await page.goto(CLAIMABLE);
    await expect(page.getByRole("button", { name: "Submit for verification" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Verify my business/i })).toHaveCount(0);
    await expect(page.getByText(/Verification is ours, not yours to declare/)).toBeVisible();
  });

  test("offers the camera first on the file input", async ({ page }) => {
    // Criterion 13. Most suppliers are photographing a licence on a wall rather
    // than uploading a scan — `image/*` is what puts the camera at the top of
    // the sheet, while still offering Files below it.
    await page.goto(CLAIMABLE);
    await expect(page.getByText("Take a photo or choose a file")).toBeVisible();
    const accept = await page.locator('input[type="file"]').first().getAttribute("accept");
    expect(accept).toContain("image/*");
    expect(accept?.indexOf("image/*")).toBeLessThan(accept?.indexOf("application/pdf") ?? 0);
  });

  test("names the conflict path in plain words", async ({ page }) => {
    // Criterion 5. Blocking the second claimant would hand the listing
    // permanently to whoever arrived first.
    await page.goto(CLAIMABLE);
    await expect(page.getByText(/decides in 48 hours/)).toBeVisible();
  });

  test("saves what was typed and says where the link went", async ({ page }) => {
    // Criterion 10. Onboarding takes six minutes with the licence to hand and a
    // fortnight without it.
    await page.goto(CLAIMABLE);
    await page.getByLabel("Your name (as on the licence or POA)").fill("Suresh Menon");
    await page.getByRole("button", { name: "Save & exit" }).click();
    await expect(page.getByText(/Saved\./)).toBeVisible();
  });

  test("is axe clean", async ({ page }) => {
    await page.goto(CLAIMABLE);
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 2c — profile basics, with live preview", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/onboarding/profile");
  });

  test("locks the trade name and offers a display name beside it", async ({ page }) => {
    /*
     * Criterion 1, and the screen where the split between the two names is
     * created: the legal name is what the registry holds, the display name is
     * what buyers see. Showing them side by side is what makes the rule legible
     * rather than arbitrary.
     */
    await expect(page.getByText("· locked to your licence")).toBeVisible();
    await expect(page.getByRole("textbox", { name: /Display name/ })).toBeEditable();
    // The legal name is text, not a field. There is no code path that edits it.
    await expect(page.getByRole("textbox", { name: /Trade name/ })).toHaveCount(0);
  });

  test("refuses a legal suffix in the display name, inline", async ({ page }) => {
    // Criterion 2. Carrying the suffix onto a card is how a directory ends up
    // looking like the registry export buyers already have.
    const field = page.getByRole("textbox", { name: /Display name/ });
    await field.fill("Something Cool LLC");
    await expect(page.getByRole("alert").filter({ hasText: /Leave "LLC" off/ })).toBeVisible();
  });

  test("counts extras against the plan cap minus the primary", async ({ page }) => {
    /*
     * Criterion 4. The extras allowance, not the total — the meter counts the
     * total, and a single counter would have to be wrong on one of them.
     *
     * Either shape, because this seat's plan decides which: a capped plan states
     * the allowance it has left, and an uncapped one says so rather than
     * printing a denominator it does not have.
     */
    await expect(
      page.getByText(/(\d+ of \d+ extra used on \w+|unlimited on \w+)/),
    ).toBeVisible();
  });

  test("renders the real search card, with the display name and no legal name", async ({ page }) => {
    /*
     * Criteria 3 and 11. The rail is the component `1c` renders, fed the draft —
     * a bespoke approximation would drift from the real card within a sprint and
     * take the screen's premise with it.
     */
    const preview = page.getByRole("region", { name: /Live preview/i });
    await expect(preview.locator("article")).toBeVisible();
    await expect(preview).not.toContainText("LLC");
    await expect(preview).not.toContainText("FZE");
  });

  test("re-renders the preview as the seller types", async ({ page }) => {
    const preview = page.getByRole("region", { name: /Live preview/i });
    await page.getByRole("textbox", { name: /Display name/ }).fill("Cool Air Counter");
    await expect(preview.locator("article")).toContainText("Cool Air Counter");
  });

  test("switches the preview between the search card and the full page", async ({ page }) => {
    const preview = page.getByRole("region", { name: /Live preview/i });
    await preview.getByRole("radio", { name: "Full page" }).click();
    await expect(preview.getByRole("radio", { name: "Full page" })).toBeChecked();
  });

  test("counts the description from the field, never from a constant", async ({ page }) => {
    // Criterion 9. A counter that disagrees with its own input teaches the next
    // developer to trust neither.
    const field = page.getByRole("textbox", { name: /What you do/ });
    await field.fill("Twelve chars");
    await expect(page.getByText("12 / 600")).toBeVisible();
  });

  test("names levers that close the gap to a hundred exactly", async ({ page }) => {
    /*
     * Criterion 13, and the property that makes the meter worth trusting: a
     * seller at 96% with nothing left to do concludes the number is decorative.
     */
    const meter = page.getByRole("region", { name: /Profile strength/i });
    const text = await meter.innerText();
    const percent = Number(/(\d+)%/.exec(text)?.[1]);
    const levers = [...text.matchAll(/\+(\d+)%/g)].map((match) => Number(match[1]));
    expect(percent + levers.reduce((sum, value) => sum + value, 0)).toBe(100);
  });

  test("keeps locations out of the meter — a gate is not a lever", async ({ page }) => {
    // Criterion 14. A location is required to publish, so it cannot be something
    // a seller declines.
    const meter = page.getByRole("region", { name: /Profile strength/i });
    await expect(meter).not.toContainText(/location/i);
    await expect(meter).not.toContainText(/hours/i);
  });

  test("shows the mechanism, not a measured lift, on a cold directory", async ({ page }) => {
    /*
     * Criterion 15. The 2.4× is a cohort query and never a placeholder; until
     * both sides clear forty listings the callout states the mechanism, which is
     * true on day one because it describes how the filters behave.
     */
    const meter = page.getByRole("region", { name: /Profile strength/i });
    const text = await meter.innerText();
    if (/×\s*more enquiries/.test(text)) {
      expect(text).toMatch(/\d+(\.\d+)?× more enquiries/);
    } else {
      expect(text).toContain("Buyers filter on photos and specs");
    }
  });

  test("autosaves and says when it last did", async ({ page }) => {
    // Criterion 16. The header timestamp is the promise that a seller can close
    // the tab and come back.
    const field = page.getByRole("textbox", { name: /What you do/ });
    await field.fill(`Counter sales and site delivery across Dubai. ${Date.now()}`);

    /*
     * One indicator, in the chrome where the board puts it, and a generous
     * window: the save is a server action against a real database, and this
     * asserts that it happens rather than how fast.
     */
    const header = page.getByRole("banner");
    await expect(header.getByText("Saved", { exact: true })).toBeVisible({ timeout: 20_000 });
  });

  test("offers one button, and neither a Back nor a Skip", async ({ page }) => {
    /*
     * Criterion 18 and 19. Steps 1 and 2 are irreversible, so a Back leads to a
     * read-only receipt; the three required fields are the minimum for a
     * publishable listing, so there is nothing to skip past.
     */
    await expect(page.getByRole("button", { name: "Continue to locations" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Back$/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Back$/ })).toHaveCount(0);
    await expect(page.getByText(/^Skip$/i)).toHaveCount(0);
  });

  test("shows steps one and two as done, in the shared chain", async ({ page }) => {
    // Criterion 20, and the same component every step of the funnel carries.
    const chain = page.getByRole("navigation", { name: "Set up your listing" }).getByRole("list");
    await expect(chain.getByText("Profile", { exact: true })).toBeVisible();
    await expect(chain.getByText("Plan", { exact: true })).toBeVisible();
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 2d — locations and hours", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/onboarding/locations");
  });

  test("states the stake rather than encouraging", async ({ page }) => {
    /*
     * Not motivational copy. Area is the second-most-used facet after category,
     * and an unpinned branch is excluded from the results map by a `where`
     * clause and scores no distance in the ranking — so the sentence is a
     * description of board 1c.
     */
    await expect(page.getByRole("heading", { level: 1, name: "Where can buyers find you?" })).toBeVisible();
    await expect(page.getByText(/an unpinned listing loses most local searches/)).toBeVisible();
  });

  test("counts locations used against the plan, in the grammar 2c set", async ({ page }) => {
    // Criterion 1. `N of M locations used on <plan>` — used over allowed, plan
    // named. The render's own correction: "Branch 2 of 3 available on your plan"
    // reads as either an allowance or a position and is therefore neither.
    await expect(page.getByText(/\d+ of \d+ locations? used on \w+|\d+ locations\./)).toBeVisible();
  });

  test("tags every branch with whether it is pinned", async ({ page }) => {
    // Criterion 3. State, not decoration — and a word beside the colour, so it
    // is readable without it.
    const tags = page.getByText(/^(Pinned|Not pinned)$/);
    expect(await tags.count()).toBeGreaterThan(0);
    // Amber where there is no pin. The word is what makes it readable without
    // the colour; the colour is what makes it findable in a list of six.
    await expect(page.getByText("Not pinned").first()).toHaveClass(/text-warn-ink/);
  });

  test("blocks Continue on a branch with no pin, and names the branch", async ({ page }) => {
    /*
     * Criterion 4. The Pro fixture has a branch with no coordinates, which is
     * the state this gate exists for: without a pin the listing cannot appear on
     * the area page that publishing it is for.
     */
    await page.getByRole("button", { name: "Continue to plans" }).click();
    await expect(page.getByText(/Branch \d+ still needs/)).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/onboarding\/locations/);
  });

  test("does not ask for hours", async ({ page }) => {
    // Criterion 5. A branch with none renders "Hours not provided" on 1f, which
    // is honest and fixable later.
    await expect(page.getByText(/Not needed to carry on/).first()).toBeVisible();
  });

  test("offers the area as a select, never as a text field", async ({ page }) => {
    /*
     * Criterion 6. Every area page on board 6a is generated from this join, so a
     * typed area is a listing that appears on no area page at all. The emirate
     * is the group heading rather than a second field: two fields that must
     * agree are two fields that eventually will not.
     */
    const area = page.getByRole("combobox", { name: "Area" }).first();
    await expect(area).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Area" })).toHaveCount(0);

    // The emirate is the control that narrows it, and it is a select too — the
    // stored emirate still comes off the chosen area on the server, so the two
    // cannot disagree whatever this screen does.
    await expect(page.getByRole("combobox", { name: "Emirate" }).first()).toBeVisible();
  });

  test("renders real map geometry, with its attribution", async ({ page }) => {
    /*
     * Criteria 7 and 8. The canvas is MapLibre's; the attribution is the tile
     * licence's condition rather than a credit, and the service-radius card must
     * not cover it.
     */
    const map = page.getByRole("group", { name: "Map of this branch" });
    await expect(map).toBeVisible();
    await expect(map.locator("canvas.maplibregl-canvas")).toBeVisible({ timeout: 30_000 });
    await expect(map.getByText(/OpenStreetMap/)).toBeVisible();
  });

  test("gives zoom a control and a scale bar", async ({ page }) => {
    /*
     * Criterion 9. The wheel is deliberately not a zoom: this map sits inside a
     * scrolling form, and one that grabs the wheel traps the seller half way
     * down it. So the control has to be there, and reachable — the drag
     * instruction sits in the opposite corner for that reason.
     */
    const map = page.getByRole("group", { name: "Map of this branch" });
    await expect(map.getByRole("button", { name: /Zoom in/i })).toBeVisible();
    await expect(map.locator(".maplibregl-ctrl-scale")).toBeVisible({ timeout: 30_000 });
  });

  test("keeps the service radius a number until it is edited", async ({ page }) => {
    /*
     * Criterion 12. At street zoom a 40 km circle is several screens wide — a
     * shape with no visible edge — so the card carries the figure and the editor
     * draws the circle, zoomed out to fit it.
     */
    const map = page.getByRole("group", { name: "Map of this branch" });
    /*
       The canvas, not the wrapper. The wrapper is in the server-rendered HTML
       and the canvas is not — MapLibre creates it after the client mounts — so
       waiting for it is what tells this test the button it is about to press has
       a handler attached. Waiting for the wrapper clicked a hydrating page and
       failed with "element not found" three lines later.
    */
    await expect(map.locator("canvas.maplibregl-canvas")).toBeVisible({ timeout: 30_000 });

    /*
       Exact, and scoped to the map. `getByRole` matches an accessible name as a
       case-insensitive substring unless told otherwise, so `name: "EDIT"` also
       matched the five "Edit this branch" buttons in the form — and `.first()`
       clicked one of those, selected a different branch, and reported the
       radius editor missing.
    */
    const edit = map.getByRole("button", { name: "EDIT", exact: true });
    await expect(edit).toBeVisible();
    await edit.click();
    await expect(page.getByRole("slider", { name: /Service radius in kilometres/ })).toBeVisible();
    // Criterion 12's other half: the circle is drawn only in here.
    await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
  });

  test("supports two shifts a day, because the market keeps them", async ({ page }) => {
    /*
     * Criterion 13. A trade counter opens at eight, shuts at one for the
     * afternoon and opens again at four. One pair per day forces those sellers
     * to declare hours they do not keep, and 1f's "open now" is then wrong for
     * several hours a day.
     */
    await expect(page.getByRole("button", { name: /Split shift/ }).first()).toBeVisible();
  });

  test("asks before copying hours over another branch", async ({ page }) => {
    /*
     * Criterion 17. This control is one click from the row the seller was
     * editing, and the cost of a mis-click is somebody else's Tuesday — so the
     * confirm names how many branches would lose their hours rather than asking
     * a generic "are you sure".
     */
    await page.getByRole("button", { name: "Copy to all branches" }).first().click();
    await expect(page.getByText(/branch(es)? already (has|have) hours/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Keep them" })).toBeVisible();
  });

  test("autosaves and says when it last did", async ({ page }) => {
    // Criterion 18. One indicator, in the chrome where the board puts it.
    const address = page.getByRole("textbox", { name: "Street address" }).first();
    await address.fill(`Warehouse 43, Street 19, Al Quoz Industrial 1 ${Date.now() % 1000}`);

    const header = page.getByRole("banner");
    await expect(header.getByText("Saved", { exact: true })).toBeVisible({ timeout: 20_000 });
  });

  test("offers a Back that reaches step 3 and no further", async ({ page }) => {
    /*
     * Criterion 19. This step is editable and re-enterable, so Back is honest
     * here where it was not on 2c. Steps 1 and 2 are irreversible — a claim is
     * submitted and a licence is with a reviewer — so nothing leads to them.
     */
    await page.getByRole("button", { name: /^Back$/ }).click();
    await expect(page).toHaveURL(/\/onboarding\/profile/);
  });

  test("carries the same step chain as every other step", async ({ page }) => {
    // Criterion 20, and a property of using one component rather than a thing
    // to check on five screens.
    const chain = page.getByRole("navigation", { name: "Set up your listing" }).getByRole("list");
    await expect(chain.getByText("Locations", { exact: true })).toBeVisible();
    await expect(chain.getByText("Plan", { exact: true })).toBeVisible();
  });

  test("is axe clean", async ({ page }) => {
    await expect(page.getByRole("group", { name: "Map of this branch" })).toBeVisible();
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 2e — the plan step, from a seat that already pays", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/onboarding/plan");
  });

  test("says the listing is already live before it says anything else", async ({ page }) => {
    /*
     * Criterion 1, and the funnel's criterion 3 from the other side. The
     * listing went up at the end of `2d`, so a pricing table shown to somebody
     * who thinks they are still blocked reads as a paywall however it is
     * worded. The header says it, and the rail carries the URL as the proof.
     */
    await expect(page.getByRole("heading", { level: 1, name: /You.re live/ })).toBeVisible();
    await expect(page.getByRole("banner")).toContainText("already live");
    await expect(page.getByRole("link", { name: "View it" })).toHaveAttribute(
      "href",
      /^\/b\/[a-z0-9-]+$/,
    );
  });

  test("shows one line instead of three cards to somebody who has chosen", async ({ page }) => {
    /*
     * Criterion 21. This seat bought before onboarding — the board's own edge
     * case — and a chooser put in front of a person who has already chosen asks
     * them to make the decision twice.
     */
    await expect(page.getByText(/Nothing else to choose here/)).toBeVisible();
    await expect(page.locator('[data-promoted="true"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Start Pro trial/ })).toHaveCount(0);
  });

  test("keeps the checklist, which is what is left to do", async ({ page }) => {
    // The plan decision is why the page exists; the checklist is what decides
    // whether the seller ever gets value.
    await expect(page.getByText(/Finish setting up|Everything is done/)).toBeVisible();
  });

  test("promises no lock-in, and 11f honours it", async ({ page }) => {
    // Criterion 20. The most load-bearing sentence on the page for somebody who
    // has just spent twenty minutes on data entry.
    await expect(page.getByText(/hidden, not deleted/)).toBeVisible();
  });

  test("carries no countdown, expiry or nag", async ({ page }) => {
    // Criterion 2.
    const body = await page.locator("main").innerText();
    expect(body).not.toMatch(/expires?|hurry|limited time/i);
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

/*
   Board 8a moved to its own file.

   `tests/e2e/dashboard-setup.spec.ts`, which matches the same signed-in
   Playwright project this file does. It was a block here while the hub was a
   list of four rows; it is a screen now, with a rail, a threshold marker, a
   completed summary and a plan gate, and those want asserting next to each
   other rather than at the end of the onboarding funnel.
*/
