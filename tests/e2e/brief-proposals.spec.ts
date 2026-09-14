import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Boards `3j-s` and `1n-s`, the buyer's half: proposals compared in their own
 * units with one labelled row of our arithmetic, an accept that declines the
 * rest, and the accepted proposal as the record.
 *
 * Anonymous, through the claim token on `seedProposalReplies`' buyer. `…02` is
 * read-only here; `…05` is the one this file accepts.
 */

const TOKEN = "seed-0000-4000-8000-provisional03";
const COMPARE = `/enquiry/seedenquiryproposal000002/compare?t=${TOKEN}`;
const ACCEPT = `/enquiry/seedenquiryproposal000005/compare?t=${TOKEN}`;
const RECORD = `/enquiry/seedenquiryproposal000003/accepted?t=${TOKEN}`;

const row = (page: import("@playwright/test").Page, name: RegExp) =>
  page.getByRole("row").filter({ has: page.getByRole("rowheader", { name }) });

test("compares proposals in their own units, with one row of our arithmetic that shows its working — AC1–AC5", async ({ page }) => {
  await page.goto(COMPARE);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Hard FM & MEP maintenance");
  await expect(page.getByText(/3 of 3 replied/i)).toBeVisible();

  const asProposed = row(page, /As proposed/i);
  await expect(asProposed).toContainText("AED 11,200");
  await expect(asProposed).toContainText("AED 850");
  await expect(asProposed).toContainText("AED 5.40");

  const twelve = row(page, /Over 12 months/i);
  await expect(twelve).toContainText("Our arithmetic, not their proposal");
  await expect(twelve).toContainText("AED 138,400");
  await expect(twelve).toContainText("× 12 months, plus AED 4,000 mobilisation");
  await expect(twelve).toContainText("× 4 visits, from your brief's quarterly cadence");
  // B5: the per-sq-ft column gives no number until the buyer gives an area.
  await expect(twelve.getByRole("cell").nth(2)).toContainText("Not worked out");
  await expect(twelve.getByRole("cell").nth(2)).not.toContainText("AED");

  await expect(row(page, /^Term$/i)).toContainText("24 months");
  await expect(row(page, /Response time/i)).toContainText("4-hour attendance on reactive calls");

  // B7: nothing ranked.
  const text = await page.getByRole("main").innerText();
  expect(text).not.toMatch(/lowest|cheapest|best value|recommended|fastest/i);
});

test("works the per-sq-ft column on an area the buyer states, and names the words it did not read — AC6, Q2", async ({ page }) => {
  await page.goto(COMPARE);
  await expect(page.getByText(/Your brief gave the scale in words: “9 floors, about 60,000 sq ft, 2 chillers”/)).toBeVisible();
  await page.getByRole("textbox", { name: "Area of the site, in sq ft" }).fill("60,000");
  await page.getByRole("button", { name: "Work it out" }).click();
  await expect(page).toHaveURL(/area=60/);
  const cell = row(page, /Over 12 months/i).getByRole("cell").nth(2);
  await expect(cell).toContainText("AED 324,000");
  await expect(cell).toContainText("× 60,000 sq ft, the area you entered");
  await expect(cell).toContainText("Worked on the figure you entered");
});

test("keeps the exclusions above the accept controls, and a question per column opens the thread — AC10, B10", async ({ page }) => {
  await page.goto(COMPARE);
  const excluded = await row(page, /Excluded/i).boundingBox();
  const accept = await page.getByRole("button", { name: /Accept the proposal from Emirates Facilities Group/ }).boundingBox();
  expect(excluded!.y).toBeLessThan(accept!.y);
  await expect(page.getByRole("link", { name: "Ask Khansaheb Facilities a question" })).toHaveAttribute(
    "href",
    `/enquiry/seedenquiryproposal000002/thread/khansaheb-facilities?t=${TOKEN}`,
  );
});

test("accepting one proposal declines the rest and freezes the comparison as the record — AC9", async ({ page }) => {
  await page.goto(ACCEPT);
  const accept = page.getByRole("button", { name: /Accept the proposal from Emirates Facilities Group/ });
  if ((await accept.count()) > 0) {
    await accept.click();
    await page.waitForURL(/\/accepted/);
    await expect(page.getByRole("heading", { level: 1, name: "Emirates Facilities Group" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What was proposed" })).toBeVisible();
  }

  await page.goto(ACCEPT);
  await expect(page.getByRole("button", { name: /Accept/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open the accepted record" })).toBeVisible();
  await expect(page.getByText("Declined when you accepted another proposal.")).toBeVisible();
});

test("keeps the accepted proposal as the record: fee, term, turnaround, scope and exclusions", async ({ page }) => {
  await page.goto(RECORD);
  await expect(page.getByRole("heading", { level: 1, name: "Emirates Facilities Group" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What was proposed" })).toBeVisible();
  const main = page.getByRole("main");
  await expect(main.getByText("AED 18,400 · Per month").first()).toBeVisible();
  await expect(main.getByText("24 months")).toBeVisible();
  await expect(main.getByText("4-hour attendance on reactive calls")).toBeVisible();
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

test("is the brief and who it went to before anybody replies", async ({ page }) => {
  await page.goto(`/enquiry/seedenquiryproposal000001/compare?t=${TOKEN}`);
  await expect(page.getByRole("heading", { name: "No proposals yet" })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByText(/Not replied yet: /)).toBeVisible();
});

test("has no axe violations", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  for (const path of [COMPARE, RECORD, `/enquiry/seedenquiryproposal000001/compare?t=${TOKEN}`]) {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations, path).toEqual([]);
  }
});
