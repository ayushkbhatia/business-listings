import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Board `10h` — the negotiation thread, buyer side, in a browser.
 *
 * The rules are proven against a real database in
 * tests/integration/negotiation-thread-10h.test.ts and the arithmetic in
 * lib/messaging/negotiation.test.ts. What is proven here is what neither can
 * see: that the buyer reaches the thread from their enquiry, that the figures
 * on screen are the corrected ones and add up row by row, that the accept is
 * stated before it is offered and lands on `7c`, that a declined thread stops
 * taking messages, and that axe passes at the acceptance width.
 *
 * `ENQ-8881` and `ENQ-8882` are seeded by prisma/seed-negotiation.mts with
 * suppliers chosen from the seed, so nothing here names one: the rows are found
 * by their state. `ENQ-8881` is read-only here — a message sent to it adds a row
 * and moves no count asserted below. `ENQ-8882` is the one accepted, once.
 */

const TOKEN = "seed-0000-4000-8000-provisional04";
const DRAWN = "ENQ-8881";
const ACCEPTABLE = "ENQ-8882";

/** "AED 7,640.00", "7,640.00" → fils. */
const fils = (text: string | null) => Math.round(Number((text ?? "").replace(/[^\d.]/g, "")) * 100);

/**
 * Open the accept dialog. Retried, because a press that lands before the page
 * hydrates opens nothing — the button is a client control.
 */
async function openAccept(page: Page, name: string | RegExp) {
  const dialog = page.getByRole("dialog");
  await expect(async () => {
    await page.getByRole("button", { name }).click();
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  return dialog;
}

/** Into the thread from the enquiry — the path the build plan found missing. */
async function openFromEnquiry(page: Page, ref: string, state: RegExp) {
  await page.goto(`/enquiry/${ref}?t=${TOKEN}`);
  await page.getByRole("link", { name: /^Messages with / }).first().click();
  await expect(page).toHaveURL(new RegExp(`/enquiry/${ref}/thread/`));
  const rail = page.getByRole("navigation", { name: `Threads on ${ref}` });
  await rail.getByRole("link").filter({ hasText: state }).first().click();
  await expect(rail.locator("[aria-current=page]")).toContainText(state);
  return rail;
}

test.describe("as drawn", () => {
  test("the rail is the whole fan-out, silence included", async ({ page }) => {
    const rail = await openFromEnquiry(page, DRAWN, /Revised quote/);
    await expect(rail.getByRole("link")).toHaveCount(4 + 1);
    await expect(rail.getByRole("link", { name: /ENQ-8881 · 4 threads/ })).toBeVisible();
    await expect(rail.getByText("No reply yet")).toBeVisible();
    await expect(rail.getByText(/2 of 3 lines quoted/i)).toBeVisible();
    // B4: the preview is the message's own opening clause.
    await expect(rail.locator("[aria-current=page]")).toContainText("One drop makes it easier…");
  });

  test("r2 is a priced table whose rows add up to 14,600, with 198 struck through", async ({ page }) => {
    await openFromEnquiry(page, DRAWN, /Revised quote/);
    const table = page.getByRole("log").getByRole("table").last();
    const rows = table.locator("tbody tr");
    await expect(rows).toHaveCount(3);

    let sum = 0;
    for (let i = 0; i < 3; i += 1) sum += fils(await rows.nth(i).getByRole("cell").nth(1).textContent());
    const total = fils(await table.locator("tfoot td").textContent());
    expect(sum).toBe(total);
    expect(total).toBe(1_460_000);

    await expect(rows.first().locator("s")).toContainText("198.00");
    await expect(page.getByRole("log").getByText("−AED 280")).toBeVisible();
    // r1 is on the record above it, as a document, at its own corrected total.
    await expect(page.getByRole("log").getByText(/^AED 14,880 · Valid 14 days/)).toBeVisible();
    // The buyer's counter was read.
    await expect(page.getByRole("log").getByText(/· Read$/i)).toBeVisible();
  });

  test("accepting is stated in full before it is offered", async ({ page }) => {
    await openFromEnquiry(page, DRAWN, /Revised quote/);
    await expect(page.getByText(/politely declines the other three/)).toBeVisible();

    const dialog = await openAccept(page, "Accept r2 — AED 14,600");
    await expect(dialog).toContainText("AED 14,600 excl. VAT, across 3 lines");
    await expect(dialog).toContainText("are told you chose another supplier");
    await expect(dialog).toContainText("We take no payment and hold no funds.");
    await dialog.getByRole("button", { name: "Keep negotiating" }).click();
    await expect(dialog).toBeHidden();
  });

  test("a chip fills the box, and the revision PDF is a PDF", async ({ page, request }) => {
    await openFromEnquiry(page, DRAWN, /Revised quote/);
    await page.getByRole("button", { name: "Request datasheets" }).click();
    await expect(page.getByLabel("Write a message")).toHaveValue(/datasheets/i);
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();

    const href = await page.getByRole("link", { name: /PDF · QT-/ }).last().getAttribute("href");
    const response = await request.get(href!);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/pdf");
  });

  test("an unpriced line stays visible and totals nothing", async ({ page }) => {
    await openFromEnquiry(page, DRAWN, /lines quoted/i);
    const table = page.getByRole("log").getByRole("table").last();
    await expect(table.getByRole("row").filter({ hasText: "Not quoted" })).toHaveCount(1);
  });

  test("silence is a thread a message still reaches", async ({ page }) => {
    await openFromEnquiry(page, DRAWN, /No reply yet/);
    await expect(page.getByText(/has not replied yet/)).toBeVisible();
    await expect(page.getByRole("form", { name: /^Reply to / })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Accept/ })).toHaveCount(0);
  });

  test("is not reachable without the token, or for a supplier the enquiry never reached", async ({ page }) => {
    await openFromEnquiry(page, DRAWN, /Revised quote/);
    const path = new URL(page.url()).pathname;
    expect((await page.goto(path))?.status()).toBe(404);
    expect((await page.goto(`/enquiry/${DRAWN}/thread/al-marwan-industrial-supplies-llc?t=${TOKEN}`))?.status()).toBe(404);
  });

  test("does not scroll sideways on a phone", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "A phone-width check.");
    await openFromEnquiry(page, DRAWN, /Revised quote/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("is axe clean", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "Run once, at the shard's width.");
    await openFromEnquiry(page, DRAWN, /Revised quote/);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .disableRules(["color-contrast"])
      .analyze();
    const summary = results.violations.map((v) => `${v.id}: ${v.help}`);
    expect(summary, summary.join("\n")).toEqual([]);
  });
});

test.describe("accepting from the thread", () => {
  test("lands on the accepted record, and the other thread stops taking messages", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "Accepts the fixture; runs once per database.");
    const rail = await openFromEnquiry(page, ACCEPTABLE, /Quote r1/);
    const chosen = await page.getByRole("heading", { level: 1 }).textContent();

    const dialog = await openAccept(page, /^Accept r1 — AED /);
    await dialog.getByRole("button", { name: "Accept r1" }).click();
    await expect(page).toHaveURL(/\/accepted/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(chosen!.trim());

    await page.goBack();
    await page.reload();
    await rail.getByRole("link").filter({ hasText: /Declined · you chose another/ }).first().click();
    await expect(page.getByText(/this thread is now read-only/)).toBeVisible();
    await expect(page.getByRole("form", { name: /^Reply to / })).toHaveCount(0);
  });
});
