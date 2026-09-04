import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Handoff 2, step 6 — reviews, in a browser.
 *
 * Criterion 9 is proven in tests/integration/reviews.test.ts: the gate, the
 * removal that throws without a reason, and the audit row. What is proven here
 * is the buyer's side of board 10f — that the gate is visible rather than a
 * silent refusal, and that the form is a form a person can use.
 *
 * Board 11c is on /dashboard and cannot be reached under `next start`, where
 * the development seller seat is deliberately inert. Fourth step running.
 */
const TOKEN = "seed-0000-4000-8000-provisional01";
/** Accepted and unreviewed. ENQ-8871 stays unaccepted so /compare has buttons. */
const ACCEPTED = "seedenquiryaccepted000001";
/**
 * Live, no accepted quote, and answered by two of the suppliers it went to.
 *
 * The gate admits two rungs since board 1m — an accepted quote, or a supplier
 * who received the enquiry and replied — so this fixture is no longer the
 * "nobody may review it" case. It is the ambiguous one: one review per enquiry,
 * two suppliers who could be its subject, and nobody has said which.
 */
const OPEN = "seedenquiryprovisional0001";

test.describe("the gate, seen from outside", () => {
  test("a fan-out several suppliers answered asks which one, and says why", async ({ page }) => {
    await page.goto(`/review/new?enq=${OPEN}&t=${TOKEN}`);
    await expect(page.getByText(/Several suppliers answered this enquiry/)).toBeVisible();
    // The gate is the product, so it is stated rather than implied by absence —
    // and it now states both rungs, because both are real.
    await expect(
      page.getByText(/buyers who sent an enquiry here and heard back, or who accepted a quote/),
    ).toBeVisible();
    await expect(page.getByRole("radio")).toHaveCount(0);
  });

  test("no token means no review page at all", async ({ page }) => {
    const response = await page.goto(`/review/new?enq=${ACCEPTED}`);
    expect(response?.status()).toBe(404);
  });

  test("somebody else's token does not open it", async ({ page }) => {
    const response = await page.goto(`/review/new?enq=${ACCEPTED}&t=not-a-real-token`);
    expect(response?.status()).toBe(404);
  });

  test("an enquiry that does not exist gets the same answer as one that is not yours", async ({ page }) => {
    // Not a 404: the buyer arrived from a link somebody sent them, and "this
    // is not yours to review" is more use than a blank page. The message is
    // identical either way, so it enumerates nothing.
    await page.goto(`/review/new?enq=nosuchenquiry&t=${TOKEN}`);
    await expect(page.getByText(/not yours to review/)).toBeVisible();
  });
});

test.describe("the form", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/review/new?enq=${ACCEPTED}&t=${TOKEN}`);
  });

  test("rates on radio groups, not on a star widget", async ({ page }) => {
    /*
     * A star widget is five buttons pretending to be one control: hard to
     * reach by keyboard, ambiguous to a screen reader, and five small targets
     * on a phone where one row of five would do.
     */
    // A fieldset with a legend, which is role=group — the canonical HTML
    // pattern for a set of radios, and what RadioGroup renders.
    await expect(page.getByRole("group", { name: "Overall" })).toBeVisible();
    await expect(page.getByRole("radio")).toHaveCount(25); // five scales of five

  });

  test("names every dimension the board asks for", async ({ page }) => {
    for (const dimension of [
      "The price was what they quoted",
      "It arrived when they said",
      "It was what they described",
      "They answered when I asked",
    ]) {
      await expect(page.getByText(dimension)).toBeVisible();
    }
  });

  test("says how long the review stays editable", async ({ page }) => {
    await expect(page.getByText(/change this for 14 days/)).toBeVisible();
  });
});

test.describe("accessibility", () => {
  test("the review page is axe clean", async ({ page }) => {
    await page.goto(`/review/new?enq=${ACCEPTED}&t=${TOKEN}`);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .disableRules(["color-contrast"])
      .analyze();
    const summary = results.violations.map((v) => `${v.id}: ${v.help}`);
    expect(summary, summary.join("\n")).toEqual([]);
  });
});
