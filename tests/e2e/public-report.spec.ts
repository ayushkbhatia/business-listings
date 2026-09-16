import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Board 4h — `/report/:slug`, signed out.
 *
 * The storefront has invited people to report a listing since it shipped, in
 * two places, and both links opened `/verification-policy` — a page of prose
 * about how a licence is checked. This is the form behind them, and the reason
 * board 4h's queue had one producer.
 *
 * Signed out on purpose: the person who has just rung a number that reaches the
 * wrong company is a buyer with no account, and requiring one is requiring an
 * account to do us a favour. What that costs them is stated on the page rather
 * than implied.
 */

const LISTING = "al-marwan-industrial-supplies-llc";

test("is reachable from the listing's own verification panel", async ({ page }) => {
  await page.goto(`/b/${LISTING}`);
  const link = page.getByRole("link", { name: "Report an issue" });
  await expect(link).toHaveAttribute("href", `/report/${LISTING}`);
  // Thirty thousand of these, nothing on them to rank.
  await expect(link).toHaveAttribute("rel", /nofollow/);
});

test("narrows the field list to the kind, and will not send without a reason", async ({ page }) => {
  await page.goto(`/report/${LISTING}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Report");

  const send = page.getByRole("button", { name: "Send the report" });
  await expect(send).toBeDisabled();

  // A closed unit is not about a photograph.
  await page.getByRole("radio", { name: "The business has closed" }).check();
  const field = page.getByLabel("Which part");
  await expect(field.getByRole("option")).toHaveCount(2);
  await expect(field.getByRole("option", { name: "Address" })).toHaveCount(1);

  await page.getByRole("radio", { name: "A photograph or a description is not theirs" }).check();
  await expect(field.getByRole("option", { name: "Address" })).toHaveCount(0);
  await expect(field.getByRole("option", { name: "A photograph" })).toHaveCount(1);

  await field.selectOption("photo");
  await expect(send).toBeDisabled();
  await page.getByLabel("What did you find").fill("It carries another supplier's watermark.");
  await expect(send).toBeEnabled();
});

test("says what happens next, and what does not", async ({ page }) => {
  await page.goto(`/report/${LISTING}`);
  await expect(page.getByText(/there is nowhere for us to send the outcome/)).toBeVisible();
  await expect(page.getByText(/We do not mark a listing as reported/)).toBeVisible();
  // Not a payment desk, on the one public surface most likely to be read as one.
  await expect(page.getByText(/This is not a payment desk/)).toBeVisible();
});

test("is out of the index", async ({ page }) => {
  await page.goto(`/report/${LISTING}`);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});

test("is a 404 for a listing nobody can see", async ({ page }) => {
  const response = await page.goto("/report/not-a-listing-at-all");
  expect(response?.status()).toBe(404);
});

test("has no axe violations", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/report/${LISTING}`);
  const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
  expect(results.violations).toEqual([]);
});
