import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Task T9.7 — the money path, in a browser, on a seller whose card failed.
 *
 * The plan's finding was that billing had "no coverage today beyond page
 * loads". The jobs — renew, retry, notify, drop — are proven in
 * `tests/integration/commercials.test.ts` and `renewal.test.ts` against a real
 * database, because a browser cannot wait nine days. What only a browser can
 * prove is that the three screens a past-due seller walks through state **one
 * date** and say what was actually sent: board 3m's rail (T9.2), board 11h and
 * 11j's past-due state (T9.3), and 3m again afterwards with one banner, not two.
 *
 * Serial, on a seat of its own (`seedPastDueSeller`): it cancels and resumes,
 * and ends where it started so a second run finds the same fixture.
 */

test.describe.configure({ mode: "serial" });

/** The drop date 3m states, read from the page rather than computed again here. */
async function dropDate(page: Page): Promise<string> {
  await page.goto("/dashboard/billing");
  const promise = page.getByText(/Your plan and your listing do not change before /);
  await expect(promise).toBeVisible();
  const text = (await promise.textContent()) ?? "";
  const match = /do not change before (.+)\.$/.exec(text.trim());
  expect(match, text).not.toBeNull();
  return match![1]!;
}

test.describe("T9 — a payment failed, and the seller sees what happens", () => {
  test("3m shows the five steps, and what each one did", async ({ page }) => {
    await page.goto("/dashboard/billing");
    await expect(page.getByText("What happens, and when")).toBeVisible();

    // Day 0: the card, honestly — no gateway in CI, so no retry is claimed.
    await expect(page.getByText("Day 0 · Card")).toBeVisible();
    // Day 3 and day 7 went out, by the channels the delivery log records.
    await expect(page.getByText(/Sent by email and in-app on/).first()).toBeVisible();
    // Day 14 and 15 are still to come.
    await expect(page.getByText(/We send the final notice on/)).toBeVisible();
    await expect(page.getByText(/Your plan changes to Free on/).first()).toBeVisible();

    // The fix names an email that has a delivery row, by date — never one that does not.
    await expect(page.getByText(/Reply to the email we sent on \d/)).toBeVisible();
    // A plan change, never a suspension.
    const body = (await page.textContent("main")) ?? "";
    expect(body).not.toMatch(/suspend|unpublish|removed/i);
  });

  test("11h dates Free from the drop, not from the renewal that failed", async ({ page }) => {
    const drop = await dropDate(page);
    await page.goto("/dashboard/billing/cancel");
    await expect(page.getByText(/A payment did not go through on/)).toBeVisible();
    await expect(page.getByText(new RegExp(`Your plan already changes to Free on ${drop}`))).toBeVisible();
    // The consequence table's third column is the same date.
    await expect(page.locator("main")).toContainText(drop);
    await expect(page.locator("main")).toContainText(/stops the card retries and the reminders/);
  });

  test("11j confirms on the same date", async ({ page }) => {
    const drop = await dropDate(page);
    await page.goto("/dashboard/billing/cancel/confirm");
    await page.getByRole("radio", { name: "Too expensive for what we use" }).check();
    await expect(page.getByRole("button", { name: `Cancel from ${drop}` })).toBeEnabled();
  });

  test("after cancelling, 3m carries one banner with both facts, and resuming takes it back", async ({ page }) => {
    const drop = await dropDate(page);
    await page.goto("/dashboard/billing/cancel/confirm");
    await page.getByRole("radio", { name: "Too expensive for what we use" }).check();
    await page.getByRole("button", { name: `Cancel from ${drop}` }).click();
    await page.waitForURL("**/dashboard/billing**");

    await expect(page.getByText(new RegExp(`You cancelled, so your plan changes to Free on ${drop}`))).toBeVisible();
    await expect(page.getByText("Not sent. You cancelled before this step.").first()).toBeVisible();

    // Back to where it started, so the fixture is the same on the next run.
    await page.getByRole("button", { name: /^Resume / }).click();
    await expect(page.getByText(/You cancelled, so your plan changes/)).toHaveCount(0);
    await expect(page.getByText(/Your plan and your listing do not change before /)).toBeVisible();
  });

  test("is axe clean on the banner", async ({ page }) => {
    await page.goto("/dashboard/billing");
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});
