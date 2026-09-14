import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Board `3j-s`, the buyer's half: proposals compared as stated, and an accepted
 * proposal as the record — scope and exclusions included, the promise the
 * seller's screen makes.
 *
 * Anonymous, through the claim token on `seedProposalReplies`' buyer. Read-only:
 * accepting is proved against the database in `proposal-reply-3js.test.ts`.
 */

const TOKEN = "seed-0000-4000-8000-provisional03";
const COMPARE = `/enquiry/seedenquiryproposal000002/compare?t=${TOKEN}`;
const RECORD = `/enquiry/seedenquiryproposal000003/accepted?t=${TOKEN}`;

test("compares two proposals term by term, on the bases they were stated, with nothing added up", async ({ page }) => {
  await page.goto(COMPARE);
  await expect(page.getByRole("heading", { level: 1, name: "Compare proposals" })).toBeVisible();
  const table = page.getByRole("table", { name: "Proposals side by side, term by term" });
  await expect(table.getByRole("row", { name: /^Fee/ })).toContainText("AED 11,200 · Per month");
  await expect(table.getByRole("row", { name: /^Fee/ })).toContainText("AED 850 · Per visit");
  // A stated nil and an unstated term read differently.
  await expect(table.getByRole("row", { name: /^Mobilisation/ })).toContainText("No mobilisation charge");
  await expect(table.getByRole("row", { name: /^Term/ })).toContainText("Not stated");
  // No arithmetic across bases: no lowest, no fastest, no total row.
  await expect(page.getByText("Lowest", { exact: true })).toHaveCount(0);
  await expect(table.getByRole("rowheader", { name: "Total" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Accept r1 · AED 11,200 · Per month" })).toBeVisible();
});

test("keeps the accepted proposal as the record: fee, term, scope and exclusions", async ({ page }) => {
  await page.goto(RECORD);
  await expect(page.getByRole("heading", { level: 1, name: "Emirates Facilities Group" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What was proposed" })).toBeVisible();
  const main = page.getByRole("main");
  await expect(main.getByText("AED 18,400 · Per month").first()).toBeVisible();
  await expect(main.getByText("24 months")).toBeVisible();
  await expect(main.getByText(/Major plant replacement, refrigerant gas beyond 5 kg/)).toBeVisible();
  await expect(main.getByRole("table")).toHaveCount(0);
  // The other firm declined before the buyer chose; it was not declined for them.
  await expect(main.getByText("Only to this supplier.")).toBeVisible();

  const pdf = await page.request.get(`/enquiry/seedenquiryproposal000003/accepted/pdf?t=${TOKEN}`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
});

test("shows the supplier's own decline on the tracking page, with their reason", async ({ page }) => {
  await page.goto(`/enquiry/seedenquiryproposal000003?t=${TOKEN}`);
  await expect(page.getByText(/DECLINED · WE TAKE CALL-OUT WORK ONLY/)).toBeVisible();
});

test("has no axe violations", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  for (const path of [COMPARE, RECORD]) {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations, path).toEqual([]);
  }
});
