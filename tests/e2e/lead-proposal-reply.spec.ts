import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Board `3j-s` — a facilities firm replies to a brief with a proposal.
 *
 * Signed in as Emirates Facilities Group, the board's own firm. The briefs are
 * `seedProposalReplies`: `…01` waits on a proposal, `…04` is the one this file
 * declines. Serial, because both are written to, and nothing else signs in as
 * this seat — which is why it has one.
 */

test.describe.configure({ mode: "serial" });

const OPEN = "/dashboard/leads/seedenquiryproposal000001";
const DECLINE = "/dashboard/leads/seedenquiryproposal000004";
const TOKEN = "seed-0000-4000-8000-provisional03";

test("reads the brief as written, with the fee basis stated and no lines — AC1, AC2", async ({ page }) => {
  await page.goto(OPEN);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Hard FM & MEP maintenance" })).toBeVisible();
  await expect(main.getByText("Two commercial towers, 12 and 14 floors.", { exact: false })).toBeVisible();
  await expect(main.getByText("12 floors, 3 chillers, about 40,000 sq ft")).toBeVisible();

  // B1: a fact, not a control — there is no select for it, disabled or not.
  const basis = main.getByText("Fee basis", { exact: true });
  await expect(basis).toBeVisible();
  await expect(main.locator("dd").filter({ hasText: "Per month" })).toBeVisible();
  await expect(main.getByRole("combobox", { name: /fee basis/i })).toHaveCount(0);

  // AC1: nothing counts or prices a line.
  const text = (await main.innerText()).toUpperCase();
  for (const word of ["QTY", "UNIT PRICE", "LINE TOTAL"]) expect(text).not.toContain(word);

  // B4: the question comes before the walk.
  const ask = main.getByRole("link", { name: "Ask a question first" });
  const decline = main.getByRole("button", { name: "Decline" });
  await expect(ask).toHaveAttribute("href", "/dashboard/leads/seedenquiryproposal000001/thread");
  const [askBox, declineBox] = await Promise.all([ask.boundingBox(), decline.boundingBox()]);
  expect(askBox!.x).toBeLessThan(declineBox!.x);

  // B8: a first name, and the phone withheld.
  await expect(main.getByText("Phone number hidden until they choose to share it.")).toBeVisible();
});

test("refuses a send with no fee, then sends a proposal that becomes the record — AC4, AC7", async ({ page }) => {
  await page.goto(OPEN);
  const main = page.getByRole("main");
  const fee = main.getByRole("textbox", { name: /^Fee/ });
  if ((await main.getByRole("button", { name: "Send proposal" }).count()) === 0) {
    test.skip(true, "The seeded brief already has a proposal — reseed to run this again.");
  }

  await main.getByRole("button", { name: "Send proposal" }).click();
  await expect(main.getByText("Enter the fee, for example 18,400.")).toBeVisible();

  await fee.fill("18,400");
  await main.getByRole("textbox", { name: /^Term/ }).fill("24");
  await main.getByRole("textbox", { name: /^Mobilisation/ }).fill("6,000");
  await main.getByRole("textbox", { name: /^Delivered where/ }).fill("On site, both towers");
  await main.getByRole("button", { name: "Send proposal" }).click();

  const sent = main.getByRole("table", { name: /Every revision of your proposal/ });
  await expect(sent).toBeVisible();
  await expect(sent).toContainText("AED 18,400 · Per month");
  await expect(sent).toContainText("24 months");
  await expect(sent).toContainText("AED 6,000 one-off");
  // A sent proposal is immutable: the composer now writes revision 2.
  await expect(main.getByRole("button", { name: "Send revision 2" })).toBeVisible();
  await expect(main.getByRole("button", { name: "Decline" })).toHaveCount(0);
});

test("shows the proposal in the pipeline as a fee on its basis, not a total", async ({ page }) => {
  await page.goto("/dashboard/quotes");
  const row = page.getByRole("row", { name: /QT-8852-EMIR1/ });
  await expect(row).toContainText("11,200.00 · Per month");
});

test("declines with a reason the buyer then reads — §States", async ({ page, browser }) => {
  await page.goto(DECLINE);
  const main = page.getByRole("main");
  if ((await main.getByRole("button", { name: "Decline" }).count()) === 0) {
    test.skip(true, "The seeded brief is already declined — reseed to run this again.");
  }
  await main.getByRole("button", { name: "Decline" }).click();
  const dialog = page.getByRole("dialog", { name: "Decline this enquiry" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox").fill("Fire pumps are outside our scope sheet");
  await dialog.getByRole("button", { name: "Decline enquiry" }).click();

  await expect(main.getByRole("heading", { name: "You declined this enquiry" })).toBeVisible();
  await expect(main.getByRole("textbox", { name: /^Fee/ })).toHaveCount(0);

  // The buyer, in a browser with no seller session: the claim-token page reads
  // a session first, and this seat is not the buyer.
  const buyer = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const tracking = await buyer.newPage();
    await tracking.goto(`/enquiry/seedenquiryproposal000004?t=${TOKEN}`);
    await expect(tracking.getByText("DECLINED · FIRE PUMPS ARE OUTSIDE OUR SCOPE SHEET")).toBeVisible();
  } finally {
    await buyer.close();
  }
});

test("has no axe violations at the acceptance viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(OPEN);
  await expect(page.getByRole("main").getByText("Fee basis", { exact: true })).toBeVisible();
  const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
  expect(results.violations).toEqual([]);
});
