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
    await expect(chain.getByText("Find your business", { exact: true })).toBeVisible();
    await expect(chain.getByText("Prove it is yours", { exact: true })).toBeVisible();
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

test.describe("criterion 3 — the plan step is not a gate", () => {
  test("says the listing is already live, and gives its address", async ({ page }) => {
    // A pricing table shown to somebody who thinks they are still blocked
    // reads as a paywall however it is worded.
    await page.goto("/onboarding/plan");
    await expect(page.getByText(/Your listing is already live at/)).toBeVisible();
    await expect(page.getByText(/Free is a real plan — you can stay on it/)).toBeVisible();
  });

  test("makes staying on Free a button, not small print", async ({ page }) => {
    await page.goto("/onboarding/plan");
    await expect(page.getByRole("button", { name: "Stay on Free" })).toBeVisible();
  });

  test("is axe clean", async ({ page }) => {
    await page.goto("/onboarding/plan");
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 8a — the setup hub", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/setup");
  });

  test("states what each task is worth and how long it takes", async ({ page }) => {
    // "Complete your profile" tells nobody anything.
    await expect(page.getByText(/WORTH 20 POINTS/i).first()).toBeVisible();
    await expect(page.getByText(/ABOUT \d+ MINUTES/i).first()).toBeVisible();
  });

  test("shows the 80% threshold the boards draw", async ({ page }) => {
    await expect(page.getByText(/80% is where a listing stops looking thin/)).toBeVisible();
  });

  test("shows progress per task, so a half-done one says so", async ({ page }) => {
    await expect(page.getByText(/\d+ OF \d+/i).first()).toBeVisible();
  });

  test("says the visit does not move the strength meter", async ({ page }) => {
    // It moves trust, not strength. Implying otherwise would be selling a
    // number the task does not touch.
    await expect(page.getByText(/DOES NOT CHANGE YOUR PROFILE STRENGTH/i)).toBeVisible();
  });

  test("links each task to where the work happens", async ({ page }) => {
    // Independent: a task is not a wizard step, it is a link to the screen
    // that already does that job.
    const links = page.getByRole("link", { name: /Start|Carry on|Done/ });
    await expect(links).not.toHaveCount(0);
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 8e — the visit", () => {
  test("asks what suits rather than offering a slot we cannot keep", async ({ page }) => {
    await page.goto("/dashboard/setup/visit");
    await expect(page.getByLabel("When suits you")).toBeVisible();
    await expect(page.getByText(/We call to arrange the actual time/)).toBeVisible();
  });

  test("has no control that sets the tier", async ({ page }) => {
    await page.goto("/dashboard/setup/visit");
    await expect(page.getByRole("combobox", { name: /tier/i })).toHaveCount(0);
  });

  test("is axe clean", async ({ page }) => {
    await page.goto("/dashboard/setup/visit");
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});
