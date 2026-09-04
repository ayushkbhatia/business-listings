import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Board 8b — the photographs task, in a browser, signed in.
 *
 * Named `dashboard-setup-photos` so the signed-in `seller` project picks it up:
 * that project matches `(dashboard|overview|catalogue|listing|account|onboarding|pricing-seller)[\w-]*\.spec\.ts`,
 * and a file called `photos.spec.ts` would run signed out and fail on a redirect.
 *
 * The seat is al-marwan-industrial-supplies-llc, which the seed gives no
 * business photographs at all — so this file asserts the zero state, which board
 * 8b §6 names as its own state and which is the one a real seller arrives in.
 */

test.describe("board 8b — photos", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/setup/photos");
  });

  test("is a task surface with no dashboard sidebar", async ({ page }) => {
    /*
       §1: the nav is deliberately absent so the task is the only thing on
       screen. A seller who came to do one job should not be one click from the
       catalogue, the leads inbox and billing.
    */
    await expect(page.getByRole("navigation", { name: /Seller navigation/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Setup", exact: true })).toBeVisible();
  });

  test("the rail counts what is open, not which step this is", async ({ page }) => {
    /*
       The correction the 8b render carries. "Task 1 of 4" over a four-segment
       rail reads as a wizard index, and board 8a's premise is that the four
       tasks are independent and free-order — a rail that counts steps
       re-imposes the sequence the hub removed.
    */
    await expect(page.getByText(/tasks still open|nothing left to do/)).toBeVisible();
    await expect(page.getByText(/Task \d+ of \d+/)).toHaveCount(0);
  });

  test("exits to the hub rather than promising a next step", async ({ page }) => {
    // Every task returns to the hub. "Save & continue" would imply a step that
    // does not exist.
    const save = page.getByRole("link", { name: /Save & back to setup|Done — back to setup/ });
    await expect(save).toBeVisible();
    await expect(save).toHaveAttribute("href", "/dashboard/setup");
    await expect(page.getByRole("link", { name: "Skip for now" })).toHaveAttribute(
      "href",
      "/dashboard/setup",
    );
  });

  test("offers the suggested slots, and says they are suggestions", async ({ page }) => {
    // §3: prompts, not required fields.
    await expect(page.getByRole("button", { name: /Your team at work/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Delivery vehicle/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Anything else/ })).toBeVisible();
  });

  test("shows the bar only once there is something to count", async ({ page }) => {
    /*
       §6: at 0 uploaded it is slots only — no bar, heading unchanged. Asserted
       as the rule rather than against the fixture, because this seat's
       photograph count is ambient: the seed gives it none, and any earlier run
       of this suite or a developer clicking through leaves some behind.
    */
    await expect(page.getByRole("heading", { name: "Show buyers the actual place" })).toBeVisible();

    const counted = page.getByText(/\d+ of \d+ uploaded|that is the set/);
    const bar = page.getByRole("progressbar", { name: "Photos" });
    await expect(bar).toHaveCount((await counted.count()) > 0 ? 1 : 0);
  });

  test("makes no claim about the content of a photograph", async ({ page }) => {
    /*
       §4, the instruction the board repeats: nothing in this build looks at
       image content. The blur and darkness checks are cut with the amber tile
       they drove, so no copy on this screen may assess a picture.
    */
    const body = (await page.textContent("main")) ?? "";
    expect(body).not.toMatch(/Blurry|Very dark|replace it\?/i);
  });

  test("does not promise a WhatsApp intake that does not exist", async ({ page }) => {
    /*
       §5: the strip cannot ship as a promise that quietly does nothing, and
       "they'll appear here" is a specific claim about this screen. There is no
       inbound webhook in this phase, so the strip is cut.
    */
    const body = (await page.textContent("main")) ?? "";
    expect(body).not.toMatch(/they'll appear here|send them to our WhatsApp/i);
  });

  test("states what works, including what we remove", async ({ page }) => {
    await expect(page.getByText(/Stock on shelves/)).toBeVisible();
    await expect(page.getByText(/Stock photos or renders — we remove these/)).toBeVisible();
    await expect(page.getByText(/Your cover sits behind the logo/)).toBeVisible();
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});
