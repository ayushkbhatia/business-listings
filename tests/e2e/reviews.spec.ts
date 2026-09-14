import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Board 10f — writing a review, in a browser.
 *
 * The gate, the service rules and the database triggers are proven in
 * `tests/integration/review-write-10f.test.ts` and `reviews.test.ts`. What is
 * proven here is the screen: the job named before a question, Post disabled on
 * what is missing and saying so, the preview moving with the form, the gate's
 * refusals rendered as reasons rather than forms, and a review posted and edited
 * end to end.
 *
 * Fixtures: `prisma/seed-review-write.mts` (Marina Facilities LLC's six
 * enquiries, suppliers of their own) and the older provisional buyer's two.
 * ENQ-8892 is posted to and ENQ-8896 is edited — both once per database, on the
 * desktop project only.
 */
const TOKEN = "seed-0000-4000-8000-provisional05";
const at = (ref: string, extra = "") => `/review/new?enq=${ref}&t=${TOKEN}${extra}`;

/** The older provisional buyer: a fan-out two suppliers answered. */
const OLD_TOKEN = "seed-0000-4000-8000-provisional01";
const FANOUT = "seedenquiryprovisional0001";

test.describe("the board as drawn — a draft in progress", () => {
  test.beforeEach(async ({ page }) => {
    /*
       Read-only, and held to it. The form autosaves (B9), so a test that
       types or clicks here would rewrite the draft the next project's run
       asserts on. Server actions post to the page's own URL; refusing those
       posts keeps the fixture as seeded without changing what renders.
    */
    await page.route("**/review/new**", (route) =>
      route.request().method() === "POST" ? route.abort() : route.continue(),
    );
    await page.goto(at("ENQ-8891"));
  });

  test("names the job, the window and the provenance before any question", async ({ page }) => {
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1, name: "Review Sparkle Facilities Services" })).toBeVisible();
    await expect(main.getByText(/^Open until \d{1,2} \w{3} \d{4} — 90 days after acceptance$/)).toBeVisible();
    await expect(main.getByText(/^ENQ-8891 · Accepted .* · AED 9,600$/)).toBeVisible();
    await expect(main.getByText("Accepted quote").first()).toBeVisible();
  });

  test("asks board 1m's four dimensions, and keeps the draft it was left with", async ({ page }) => {
    for (const name of ["Quoted accurately", "Delivered on time", "Product as described", "Responsiveness"]) {
      await expect(page.getByRole("group", { name })).toBeVisible();
    }
    await expect(page.getByText("4 — would use again")).toBeVisible();
    await expect(page.getByLabel("What should another buyer know?")).toHaveValue(/^Quote matched the final invoice/);
    await expect(page.getByText("157 / 800")).toBeVisible();
    await expect(page.getByRole("button", { name: "Post review" })).toBeEnabled();
  });

  test("the preview is the listing's row, signed as chosen", async ({ page }) => {
    const preview = page.getByRole("complementary").getByText("How it will appear").locator("..");
    await expect(preview.getByText("Marina Facilities LLC")).toBeVisible();
    await expect(async () => {
      await page.getByText("Buyer, name withheld", { exact: true }).first().click();
      await expect(preview.getByText("Buyer, name withheld")).toBeVisible();
    }).toPass();
  });

  test("refuses contact details as they are typed", async ({ page }) => {
    const body = page.getByLabel("What should another buyer know?");
    await expect(async () => {
      await body.fill("Crew was on time and the quote held. Call the supervisor on 050 641 2288.");
      await expect(page.getByText("Take out the phone number. A review cannot carry contact details.")).toBeVisible();
    }).toPass();
    await expect(page.getByRole("button", { name: "Post review" })).toBeDisabled();
  });

  test("draws the gate beside it: one that qualifies, one that does not, with the reason", async ({ page }) => {
    const rail = page.getByRole("complementary");
    await expect(rail.getByRole("link", { name: /ENQ-8893 · No supplier replied.*Not eligible/ })).toBeVisible();
    // ENQ-8892 is posted to later in this file, so its row is not asserted here.
    await expect(rail.getByRole("link", { name: /ENQ-8894 · Sparkle Facilities Services.*Closed/ })).toBeVisible();
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .disableRules(["color-contrast"])
      .analyze();
    const summary = results.violations.map((v) => `${v.id}: ${v.help}`);
    expect(summary, summary.join("\n")).toEqual([]);
  });
});

test.describe("the gate, seen from outside (B1)", () => {
  test("a closed window has no form, and states the day and the rule", async ({ page }) => {
    await page.goto(at("ENQ-8894"));
    await expect(page.getByRole("heading", { name: /^Reviews closed on / })).toBeVisible();
    await expect(page.getByText(/A review stays open for 90 days after the quote is accepted/)).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await expect(page.getByRole("radio")).toHaveCount(0);
  });

  test("no reply and no acceptance is a reason and a link, never a form", async ({ page }) => {
    await page.goto(at("ENQ-8893"));
    await expect(page.getByRole("heading", { name: "No supplier has replied, and no quote was accepted" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to ENQ-8893" })).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveCount(0);
  });

  test("a fan-out several suppliers answered asks which one", async ({ page }) => {
    await page.goto(`/review/new?enq=${FANOUT}&t=${OLD_TOKEN}`);
    await expect(page.getByRole("heading", { level: 1, name: "Which supplier are you reviewing?" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Review this supplier/ })).toHaveCount(2);
    await expect(page.getByRole("radio")).toHaveCount(0);
  });

  test("somebody else's enquiry and one that does not exist get the same answer", async ({ page }) => {
    await page.goto(`/review/new?enq=${FANOUT}&t=${TOKEN}`);
    const theirs = await page.getByRole("main").locator("h2").first().textContent();
    await page.goto(at("ENQ-0000000"));
    const missing = await page.getByRole("main").locator("h2").first().textContent();
    expect(theirs).toBe("Not an enquiry on your account");
    expect(missing).toBe(theirs);
  });

  test("signed out with no token is sent to sign in and brought back — not a 404", async ({ page }) => {
    await page.goto("/review/new?enq=ENQ-8891");
    await expect(page).toHaveURL(/\/signin\?next=%2Freview%2Fnew%3Fenq%3DENQ-8891/);
  });

  test("a seller reply makes it read-only, with no counter-reply", async ({ page }) => {
    await page.goto(at("ENQ-8895"));
    await expect(page.getByRole("heading", { level: 1, name: "Your review of Fireline Ducting Works" })).toBeVisible();
    await expect(page.getByText(/replied on .*, so the review is fixed\. There is no counter-reply\./)).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit review" })).toHaveCount(0);
    // The edit link cannot be forced: the form is not offered past the window.
    await page.goto(at("ENQ-8895", "&edit=1"));
    await expect(page.getByRole("textbox")).toHaveCount(0);
  });
});

test.describe("posting and editing", () => {
  test("posts a review with a skipped dimension, and lands on the buyer's own copy", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "Posts the fixture; runs once per database.");
    await page.goto(at("ENQ-8892"));
    const post = page.getByRole("button", { name: "Post review" });
    await expect(post).toBeDisabled();
    await expect(page.getByText("To post: choose an overall score, and write at least 40 characters.")).toBeVisible();

    await expect(async () => {
      await page.getByRole("radiogroup", { name: /Overall/ }).locator("label").nth(3).click();
      await expect(page.getByText("4 — would use again")).toBeVisible();
    }).toPass();
    await page.getByRole("group", { name: "Quoted accurately" }).locator("label").nth(4).click();
    await page.getByLabel("What should another buyer know?").fill(
      "Forty valves arrived on the day quoted, priced exactly as quoted, with the certificates in the crate.",
    );
    await expect(post).toBeEnabled();
    await post.click();

    // Coastline Valve Trading is not published, so B10's listing does not exist
    // and the buyer stays on their copy, told why.
    await expect(page).toHaveURL(/posted=1/);
    await expect(page.getByRole("heading", { level: 1, name: "Your review of Coastline Valve Trading" })).toBeVisible();
    await expect(page.getByText(/kept against Coastline Valve Trading and appears when their listing is published/)).toBeVisible();
    await expect(page.getByText("Delivered on time").locator("..").getByText("Skipped")).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit review" })).toBeVisible();
  });

  test("edits a review inside its fortnight", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "Edits the fixture; runs once per database.");
    await page.goto(at("ENQ-8896"));
    await page.getByRole("link", { name: "Edit review" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Edit your review of Coastline Valve Trading" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save as draft" })).toHaveCount(0);

    const body = page.getByLabel("What should another buyer know?");
    // An invoice-style number on purpose: a long run of digits is not a phone number.
    const stamp = `Edited in the acceptance suite, invoice ${Date.now()}.`;
    await expect(async () => {
      await body.fill(`Six strainers delivered the day after acceptance, exactly as quoted. ${stamp}`);
      await expect(page.getByRole("button", { name: "Save changes" })).toBeEnabled();
    }).toPass();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(/saved=1/);
    await expect(page.getByText(stamp)).toBeVisible();
  });
});

test.describe("at phone width", () => {
  test("stacks the rail under the form without a sideways scroll", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "A phone-width check.");
    await page.goto(at("ENQ-8891"));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
