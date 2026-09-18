import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Boards 4h and 13c — *Report a listing*, signed out.
 *
 * Board 13c puts the form in a modal over the storefront, at `/b/:slug?report=1`,
 * and `/report/:slug` stays as the page the modal degrades to. Both render one
 * component over one action, so this file drives the modal for the flows and
 * checks the page for the things only a page has: its own URL, its metadata,
 * its 404.
 *
 * Signed out on purpose: the person who has just rung a number that reaches the
 * wrong company is a buyer with no account (`B12`).
 *
 * ## One address per test
 *
 * A signed-out reporter is keyed on the digest of their forwarded address, and
 * one source may hold one open report per field (`B8`). The chromium and mobile
 * projects both run this file against one seeded database, so each test that
 * sends gives itself an address nobody else uses — otherwise the second project
 * to arrive would be told, correctly, that this has already been reported from
 * here.
 */

const LISTING = "al-wadi-technical-services-llc"; // unclaimed, the board's own case

async function asAStranger(page: Page) {
  const address = `2001:db8::${Date.now().toString(16)}:${Math.floor(Math.random() * 0xffff).toString(16)}`;
  await page.setExtraHTTPHeaders({ "x-forwarded-for": address });
}

test.describe("the modal over the storefront", () => {
  test("opens from the listing's own link, as a URL, and closes back to the listing", async ({ page }) => {
    await page.goto(`/b/${LISTING}`);
    const trigger = page.getByRole("link", { name: "Report this listing" }).first();
    // A real link, so it works with no script and is never followed by a crawler.
    await expect(trigger).toHaveAttribute("href", `/report/${LISTING}`);
    await expect(trigger).toHaveAttribute("rel", /nofollow/);

    await trigger.click();
    await expect(page).toHaveURL(new RegExp(`/b/${LISTING}\\?report=1$`));
    const dialog = page.getByRole("dialog", { name: /^Report / });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("We check every report against the licence record.")).toBeVisible();

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/b/${LISTING}$`));

    // Back and forward move through it like any other page state.
    await trigger.click();
    await expect(dialog).toBeVisible();
    await page.goBack();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/b/${LISTING}$`));
  });

  test("works from the keyboard: reached, chosen, and closed with Escape", async ({ page }) => {
    await page.goto(`/b/${LISTING}?report=1`);
    const dialog = page.getByRole("dialog", { name: /^Report / });
    await expect(dialog).toBeVisible();

    // The native dialog traps focus; the first reason is a tab or two away.
    const closed = dialog.getByRole("radio", { name: /Permanently closed/ });
    for (let press = 0; press < 4 && !(await closed.evaluate((el) => el === document.activeElement)); press += 1) {
      await page.keyboard.press("Tab");
    }
    await expect(closed).toBeFocused();
    await page.keyboard.press("Space");
    await expect(closed).toBeChecked();
    // One field under a closure, so nothing else is asked and send is ready.
    await expect(dialog.getByRole("button", { name: "Send report" })).toBeEnabled();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/b/${LISTING}$`));
  });

  test("opens on the form from a shared link, and is out of the index there", async ({ page }) => {
    await page.goto(`/b/${LISTING}?report=1`);
    await expect(page.getByRole("dialog", { name: /^Report / })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("starts with nothing chosen, and will not send until something is", async ({ page }) => {
    await page.goto(`/b/${LISTING}?report=1`);
    const dialog = page.getByRole("dialog", { name: /^Report / });
    const send = dialog.getByRole("button", { name: "Send report" });
    await expect(send).toBeDisabled();
    // The board's four reasons, closure first, and the claim door last.
    const reasons = dialog.getByRole("radio");
    await expect(reasons.first()).toHaveAccessibleName(/Permanently closed/);
    await expect(reasons.last()).toHaveAccessibleName(/Someone else claimed my business/);
    // The threshold the queue actually computes, in words.
    await expect(dialog.getByText(/Three people reporting the same detail/)).toBeVisible();
  });

  test("asks which detail, takes what it should say, and hands back a reference", async ({ page }) => {
    await asAStranger(page);
    await page.goto(`/b/${LISTING}?report=1`);
    const dialog = page.getByRole("dialog", { name: /^Report / });

    await dialog.getByRole("radio", { name: /A detail is wrong/ }).check();
    const send = dialog.getByRole("button", { name: "Send report" });
    // `B1` — a reason that names more than one field is not yet a report.
    await expect(send).toBeDisabled();
    await dialog.getByRole("radio", { name: "Company name" }).check();
    await dialog.getByLabel(/What should the company name say/).fill("Al Wadi Technical Works");
    await dialog.getByLabel(/Your email/).fill("stranger@example.ae");
    await expect(send).toBeEnabled();
    await send.click();

    // `B5` — the outcome the board did not draw.
    const reference = dialog.getByTestId("report-reference");
    await expect(reference).toHaveText(/^RP-[0-9A-HJKMNP-TV-Z]{8}$/);
    await expect(dialog.getByText(/We email stranger@example\.ae once/)).toBeVisible();
    await expect(dialog.getByText(/within 5 days/)).toBeVisible();
    await expect(dialog.getByText(/The business is never told who reported it/)).toBeVisible();

    // The reference is a key the reporter can use on their own.
    const text = (await reference.textContent())!.trim();
    await dialog.getByRole("link", { name: "report status" }).click();
    await expect(page).toHaveURL(new RegExp(`/report\\?ref=${text}$`));
    await expect(page.getByRole("heading", { name: text })).toBeVisible();
    await expect(page.getByText("With a moderator")).toBeVisible();
  });

  test("sends an ownership claim to the claim flow instead of the queue", async ({ page }) => {
    await page.goto(`/b/${LISTING}?report=1`);
    const dialog = page.getByRole("dialog", { name: /^Report / });
    await dialog.getByRole("radio", { name: /Someone else claimed my business/ }).check();
    // `B10` — nothing below the reasons is asked, and there is nothing to send.
    await expect(dialog.getByRole("button", { name: "Send report" })).toHaveCount(0);
    const claim = dialog.getByRole("link", { name: "Claim this listing" });
    await expect(claim).toHaveAttribute("href", /\/onboarding\/claim\?q=./);
    await expect(dialog.getByText(/trade licence/).first()).toBeVisible();
  });

  test("has no axe violations with the modal open", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`/b/${LISTING}?report=1`);
    await page.getByRole("dialog", { name: /^Report / }).getByRole("radio", { name: /A detail is wrong/ }).check();
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("the page the modal degrades to", () => {
  test("is the same form, out of the index", async ({ page }) => {
    await page.goto(`/report/${LISTING}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Report");
    await expect(page.getByRole("button", { name: "Send report" })).toBeDisabled();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    // Not a payment desk, on the one public surface most likely to be read as one.
    await expect(page.getByText(/This is not a payment desk/)).toBeVisible();
  });

  test("is a 404 for a listing nobody can see, and so is the modal on one (B6)", async ({ page }) => {
    expect((await page.goto("/report/not-a-listing-at-all"))?.status()).toBe(404);
    expect((await page.goto("/b/not-a-listing-at-all?report=1"))?.status()).toBe(404);
  });

  test("has no axe violations", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`/report/${LISTING}`);
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("the hub the footer opens", () => {
  test("is where the footer's report link goes, and it reads a reference", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("contentinfo").getByRole("link", { name: "Report a listing" })).toHaveAttribute(
      "href",
      "/report",
    );

    await page.goto("/report?ref=hello");
    await expect(page.getByText("That is not the shape of a report reference.")).toBeVisible();
    await page.goto("/report?ref=RP-00000000");
    await expect(page.getByText("No report has the reference RP-00000000.")).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("has no axe violations", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/report?ref=RP-00000000");
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});
