import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Board `7c` — the accepted quote record, in a browser.
 *
 * The rules are proven against a real database in
 * tests/integration/accepted-record-7c.test.ts, and the rendering of every state
 * in tests/unit/accepted-record-view.test.tsx. What is proven here is what
 * neither can see: that the page is reachable by the buyer it belongs to and
 * nobody else, that the total a buyer reads is the sum of the figures they read,
 * that the PDF control returns a PDF, that the two forms work with a keyboard,
 * and that axe passes at the width the acceptance shard runs.
 *
 * Both enquiries and their claim token are seeded by `seedAcceptedRecords` in
 * prisma/seed.mts. Nothing here files a report: that write is one per enquiry
 * and would consume the fixture for every later run.
 */

const TOKEN = "seed-0000-4000-8000-provisional02";
const TYPICAL = "ENQ-8846";
const REPORTED = "ENQ-8847";

const record = (ref: string) => `/enquiry/${ref}/accepted?t=${TOKEN}`;

/** "AED 7,640.00" or "7,640.00" → fils. */
const fils = (text: string | null) => Math.round(Number((text ?? "").replace(/[^\d.]/g, "")) * 100);

async function main(page: Page) {
  return page.getByRole("main");
}

test.describe("the typical state", () => {
  test("renders the record the buyer accepted", async ({ page }) => {
    await page.goto(record(TYPICAL));
    const body = await main(page);

    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(body.getByText("Contact details released")).toBeVisible();
    await expect(body.getByText("Only to this supplier. The other 3 were declined for you.")).toBeVisible();
    await expect(body.getByText("PO-2026-0418")).toBeVisible();
    await expect(body.getByText("30 days from invoice")).toBeVisible();
    await expect(body.getByText("Invoiced by them, not by us")).toBeVisible();
    await expect(body.getByText("Not in their catalogue · priced manually").first()).toBeVisible();
  });

  test("prints a total equal to the line totals on the page — criterion 2", async ({ page }) => {
    await page.goto(record(TYPICAL));
    const table = page.getByRole("table");
    const rows = table.locator("tbody tr");
    await expect(rows).toHaveCount(3);

    let sum = 0;
    for (let i = 0; i < 3; i += 1) {
      sum += fils(await rows.nth(i).getByRole("cell").nth(2).textContent());
    }
    const total = fils(await table.locator("tfoot").getByRole("cell").first().textContent());
    expect(sum).toBe(total);
    expect(total).toBe(1_460_000);
    await expect(table.locator("tfoot")).toContainText("Total excl. VAT · delivery included");
  });

  test("quotes the supplier's own dated words, and says they are unverified", async ({ page }) => {
    await page.goto(record(TYPICAL));
    await expect(page.getByText("Gaskets to follow within 2 days of the drop.")).toBeVisible();
    await expect(page.getByText(/We do not verify or track them/)).toBeVisible();
  });

  test("returns the quote as a PDF from the same link the button carries", async ({ page }) => {
    await page.goto(record(TYPICAL));
    const href = await page.getByRole("link", { name: "Download quote PDF" }).getAttribute("href");
    expect(href).toContain("/accepted/pdf");
    const response = await page.request.get(href!);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/pdf");
    expect(response.headers()["cache-control"]).toContain("no-store");
    const bytes = await response.body();
    expect(bytes.subarray(0, 8).toString("latin1")).toBe("%PDF-1.4");
    expect(bytes.toString("latin1")).toContain("(14,600.00) Tj");
  });

  test("opens the thread with this supplier from the primary action", async ({ page }) => {
    await page.goto(record(TYPICAL));
    await page.getByRole("link", { name: "Message the supplier" }).click();
    await expect(page).toHaveURL(/\/thread\//);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("implies no delivery or payment state", async ({ page }) => {
    await page.goto(record(TYPICAL));
    await expect(await main(page)).not.toContainText(/\b(delivered|in transit|shipped|paid|refund|order total)\b/i);
  });

  test("refuses a too-short report without filing it, and keeps what was typed", async ({ page }) => {
    await page.goto(record(TYPICAL));
    await page.getByRole("button", { name: "Report a problem" }).click();
    const field = page.getByRole("textbox", { name: "What went wrong" });
    await expect(field).toBeFocused();
    await field.fill("Too short");
    await page.getByRole("button", { name: "Send to the trust team" }).click();
    // Scoped to main: Next's route announcer is also an alert, and it is empty.
    await expect(page.getByRole("main").getByRole("alert")).toContainText("at least 20 characters");
    await expect(field).toHaveValue("Too short");

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("button", { name: "Report a problem" })).toBeFocused();
  });
});

test.describe("the other end: one supplier, the window ended, a report open", () => {
  test("says each of those rather than hiding them", async ({ page }) => {
    await page.goto(record(REPORTED));
    const body = await main(page);
    await expect(body.getByText("Only to this supplier.", { exact: true })).toBeVisible();
    await expect(body.getByText(/The price window has ended/)).toBeVisible();
    await expect(body.getByText("Not stated on the quote").first()).toBeVisible();
    await expect(body.getByText(/You reported this on .* It is with the trust team/)).toBeVisible();
    // The case, and no second control.
    await expect(body.getByRole("button", { name: "Report a problem" })).toHaveCount(0);
  });

  test("adds and removes the buyer's own reference with the keyboard", async ({ page }, testInfo) => {
    // A write to one seeded row: two projects running it at once would race.
    test.skip(testInfo.project.name === "mobile", "Writes the shared fixture; runs once.");
    await page.goto(record(REPORTED));
    await page.getByRole("button", { name: "Add your PO or reference" }).click();
    const field = page.getByRole("textbox", { name: "PO number or job code" });
    await expect(field).toBeFocused();
    await field.fill("JOB-7C-E2E");
    await field.press("Enter");
    await expect(page.getByRole("status").filter({ hasText: "Reference saved." })).toBeVisible();
    await expect(page.getByText("JOB-7C-E2E")).toBeVisible();

    // Put the fixture back as it was: no reference.
    await page.getByRole("button", { name: "Change" }).click();
    await page.getByRole("textbox", { name: "PO number or job code" }).fill("");
    await page.getByRole("button", { name: "Save reference" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Reference removed." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add your PO or reference" })).toBeVisible();
  });
});

test.describe("who can reach it", () => {
  test("is the same 404 without the token, and for a reference that is not theirs", async ({ page }) => {
    const missing = await page.goto(`/enquiry/${TYPICAL}/accepted`);
    expect(missing?.status()).toBe(404);
    const other = await page.goto(`/enquiry/ENQ-8879/accepted?t=${TOKEN}`);
    expect(other?.status()).toBe(404);
    const pdf = await page.request.get(`/enquiry/${TYPICAL}/accepted/pdf`);
    expect(pdf.status()).toBe(404);
  });
});

test.describe("accessibility", () => {
  test("reaches every control from the keyboard, in order", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "A keyboard walk is a desktop pass.");
    await page.goto(record(TYPICAL));
    const wanted = ["Download quote PDF", "Message the supplier", "Open the thread", "Write a review", "Report a problem"];
    const seen: string[] = [];
    for (let i = 0; i < 80 && seen.length < wanted.length; i += 1) {
      await page.keyboard.press("Tab");
      const name = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.innerText?.trim() ?? "");
      if (wanted.includes(name) && !seen.includes(name)) seen.push(name);
    }
    expect(seen).toEqual(wanted);
  });

  test("has no axe violations at the acceptance viewport", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "Run once, at the shard's width.");
    await page.setViewportSize({ width: 1280, height: 720 });
    for (const ref of [TYPICAL, REPORTED]) {
      await page.goto(record(ref));
      const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
      expect(results.violations, ref).toEqual([]);
    }
  });
});
