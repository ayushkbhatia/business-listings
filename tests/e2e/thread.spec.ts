import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Handoff 2, step 4 — the thread, in a browser.
 *
 * The rules are proven in tests/integration/thread.test.ts: the detector's two
 * directions, the report it raises, the revision round-trip and the single
 * nudge. What is proven here is what a test in node cannot see — the buyer's
 * side rendering, its chips, and its accessibility.
 *
 * The seller's side is absent, and not by choice. Playwright builds for
 * production, and the development seller seat is deliberately inert there
 * (lib/auth/dev-seller.ts), so /dashboard 404s under `next start`. Signing in
 * for real needs an OTP, which needs the Supabase admin API, which CI has no
 * key for. Until a seller can sign in here, the seller thread is covered by the
 * integration tests and by hand — the board 11b warning and the single nudge
 * were both checked in a browser against the dev server.
 */
const TOKEN = "seed-0000-4000-8000-provisional01";
const ENQUIRY_ID = "seedenquiryprovisional0001";
/** Seeded as a recipient who has quoted. See prisma/seed.mts. */
const SELLER = "al-marwan-industrial-supplies-llc";

const buyerThread = `/enquiry/${ENQUIRY_ID}/thread/${SELLER}?t=${TOKEN}`;

test.describe("the buyer's side", () => {
  test("names the supplier and offers the chips board 10h draws", async ({ page }) => {
    await page.goto(buyerThread);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Al Marwan");
    /*
       The chip's label names the act; the text it drops in is the question.
       They stopped being the same string with board 11b, whose §3 needed a
       seller's chip to say "Extend the price hold" and insert wording that
       commits to no number — and `Thread` is one component for both sides, so
       the buyer's chips took the same shape.
    */
    await expect(page.getByRole("button", { name: "Ask about the price hold" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ask for datasheets" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ask about credit terms" })).toBeVisible();
  });

  test("a chip fills the box rather than sending on its own", async ({ page }) => {
    // A chip that sends immediately is a chip somebody presses by accident.
    await page.goto(buyerThread);
    await page.getByRole("button", { name: "Ask for datasheets" }).click();
    // What lands is the question, not the label.
    await expect(page.getByLabel("Write a message")).toHaveValue(/datasheets/i);
  });

  test("the message log is a log, so a new message is announced", async ({ page }) => {
    await page.goto(buyerThread);
    const log = page.getByRole("log");
    await expect(log).toHaveAttribute("aria-live", "polite");
  });

  test("send is off until there is something to send", async ({ page }) => {
    await page.goto(buyerThread);
    // exact: a quick-reply chip also contains the word "send".
    const send = page.getByRole("button", { name: "Send", exact: true });
    await expect(send).toBeDisabled();
    await page.getByLabel("Write a message").fill("Is the DN200 in stock today?");
    await expect(send).toBeEnabled();
  });

  test("is not reachable without the token", async ({ page }) => {
    const response = await page.goto(`/enquiry/${ENQUIRY_ID}/thread/${SELLER}`);
    expect(response?.status()).toBe(404);
  });

  test("is not reachable for a supplier the enquiry never went to", async ({ page }) => {
    const response = await page.goto(
      `/enquiry/${ENQUIRY_ID}/thread/al-wadi-technical-services-llc?t=${TOKEN}`,
    );
    expect(response?.status()).toBe(404);
  });
});

test.describe("accessibility", () => {
  test("the buyer's thread is axe clean", async ({ page }) => {
    await page.goto(buyerThread);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .disableRules(["color-contrast"])
      .analyze();
    const summary = results.violations.map((v) => `${v.id}: ${v.help}`);
    expect(summary, summary.join("\n")).toEqual([]);
  });
});
