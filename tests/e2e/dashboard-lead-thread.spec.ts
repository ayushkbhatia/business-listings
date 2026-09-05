import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Board 11b — the seller's message thread, in a browser.
 *
 * Named `dashboard-lead-thread` so the seller project owns it. Note that
 * `tests/e2e/thread.spec.ts` already exists and is the BUYER's anonymous spec;
 * this is the other side of the same conversation, signed in.
 *
 * `ENQ-8871` has a fixed id in the seed so a browser test can reach one enquiry
 * without an API route that exists only for tests.
 */

const LEAD = "seedenquiryprovisional0001";

test.describe("board 11b — the conversation", () => {
  test("carries the warning that this is the record, before anybody tries", async ({ page }) => {
    await page.goto(`/dashboard/leads/${LEAD}/thread`);
    await expect(page.getByText("Everything here is the record")).toBeVisible();
    await expect(page.getByText(/flagged automatically and reviewed by a person/)).toBeVisible();
  });

  test("says the read receipt works both ways", async ({ page }) => {
    /*
       §6: a one-way receipt is surveillance, and the buyer finds out the first
       time a seller mentions it. The buyer has seen `openedAt` since board 1i,
       so this restores a balance rather than tipping one.

       Until this handoff `Quote.readAt` had no writer at all, so whichever half
       of this sentence renders, it renders from a column something now sets.
    */
    await page.goto(`/dashboard/leads/${LEAD}/thread`);
    await expect(page.getByText(/They see when you open theirs/)).toBeVisible();
  });

  test("suggests the act and never the number", async ({ page }) => {
    /*
       The board shipped three chips that each made a commitment, one of them to
       a 21-day price hold on a screen whose validity field said fourteen and
       whose picker offers seven values. §3's correction: the label names the
       act, the text it drops in is a question the seller finishes.
    */
    await page.goto(`/dashboard/leads/${LEAD}/thread`);
    await expect(page.getByRole("button", { name: "Extend the price hold" })).toBeVisible();
    await expect(page.getByRole("button", { name: /21 days/ })).toHaveCount(0);

    await page.getByRole("button", { name: "Extend the price hold" }).click();
    const composed = await page.getByLabel(/Write a message/).inputValue();
    // Whatever it inserted, it committed no figure.
    expect(composed).not.toMatch(/\d+\s*(day|days|%|AED)/i);
  });

  test("offers one follow-up and says why there is only one", async ({ page }) => {
    await page.goto(`/dashboard/leads/${LEAD}/thread`);
    await expect(
      page.getByText(/A second follow-up loses more deals than it wins/),
    ).toBeVisible();
  });

  test("writes no follow-up draft on the seller's behalf", async ({ page }) => {
    /*
       §4: the draft carries no price, discount or deadline the seller did not
       type. The board pre-wrote one promising "the 191 holds until Thursday",
       which was a third live validity claim on a screen that already had two.
    */
    await page.goto(`/dashboard/leads/${LEAD}/thread`);
    const field = page.getByLabel("What the follow-up will say");
    if ((await field.count()) === 0) return; // Already sent, or nothing quoted yet.
    await expect(field).toHaveValue("");
    // And it will not arm without words.
    await expect(page.getByRole("button", { name: "Send it automatically" })).toBeDisabled();
  });

  test("shows this seller's own history and disclaims the rest", async ({ page }) => {
    /*
       §5 cut two claims: "Pays on 30-day terms, on time" — we take no payment
       and never see an invoice — and "Accepts quotes 62% of the time", which
       aggregated the buyer across other suppliers inside a card whose own
       footer promised not to. The footer is load-bearing copy.
    */
    await page.goto(`/dashboard/leads/${LEAD}/thread`);
    await expect(page.getByText("Quotes you marked won")).toBeVisible();
    await expect(
      page.getByText(/we do not aggregate their behaviour with other suppliers/),
    ).toBeVisible();

    /*
       The two cut claims, as claims rather than as words. An earlier version of
       this matched /on time/ and caught the disclaimer — "we cannot tell you
       whether they pay on time" — which is the sentence the rule exists to
       keep. What must not appear is a payment habit or a cross-supplier rate
       asserted as fact.
    */
    const body = (await page.textContent("main")) ?? "";
    expect(body).not.toMatch(/pays (on|in) \w+/i);
    expect(body).not.toMatch(/\d+\s?% of the time/i);
    expect(body).not.toMatch(/accepts quotes/i);
  });

  test("carries the exit back to the composer", async ({ page }) => {
    // §2 in the other direction: a seller who came here to answer a question
    // must be able to go back and price it.
    await page.goto(`/dashboard/leads/${LEAD}/thread`);
    const back = page.getByRole("link", { name: /Revise the quote|Send a quote/ });
    await expect(back).toBeVisible();
    await back.click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/leads/${LEAD}$`));
  });

  test("names the buyer by first name only, before acceptance", async ({ page }) => {
    await page.goto(`/dashboard/leads/${LEAD}/thread`);
    const body = (await page.textContent("main")) ?? "";
    expect(body).not.toContain("Al Hameli");
    expect(body).not.toContain("Al Nuaimi");
  });

  test("keeps the off-platform notice on screen", async ({ page }) => {
    // The detector behind it is real — lib/messaging/off-platform.ts raises a
    // report on an IBAN or a "transfer to" — which is why the sentence is not
    // a bluff.
    await page.goto(`/dashboard/leads/${LEAD}/thread`);
    await expect(page.getByText("Do not ask for payment here")).toBeVisible();
  });
});

test.describe("board 11b — accessibility", () => {
  test("passes axe", async ({ page }) => {
    await page.goto(`/dashboard/leads/${LEAD}/thread`);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      // Token-level and pinned. See the note in dashboard-leads-inbox.spec.ts.
      .disableRules(["color-contrast"])
      .analyze();
    const summary = results.violations.map((v) => `${v.id}: ${v.help}`);
    expect(summary, summary.join("\n")).toEqual([]);
  });

  test("has one h1 and names both side panels", async ({ page }) => {
    await page.goto(`/dashboard/leads/${LEAD}/thread`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("region", { name: "Follow-up" })).toBeVisible();
    await expect(page.getByRole("region", { name: "This buyer" })).toBeVisible();
  });
});
