import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Board 1i — the buyer's home for one enquiry.
 *
 * Seeded: `ENQ-8871` has five recipients and two quotes, which is the state the
 * render depicts. The token belongs to a provisional buyer, because the page is
 * usually opened by somebody with no account.
 */

const REF = "ENQ-8871";
const TOKEN = "seed-0000-4000-8000-provisional01";
const URL = `/enquiry/${REF}?t=${TOKEN}`;

const rows = (page: import("@playwright/test").Page) =>
  page.locator("ul[aria-label] > li");

test.describe("access is the token, never the reference", () => {
  test("a valid reference with no token is a 404, not a 403", async ({ page }) => {
    /*
       Criterion 1. `ENQ-8841` is four digits in a WhatsApp message and anybody
       could walk them; a 403 would confirm which ones exist.
    */
    const response = await page.goto(`/enquiry/${REF}`);
    expect(response?.status()).toBe(404);
  });

  test("a wrong token is the same 404", async ({ page }) => {
    const response = await page.goto(`/enquiry/${REF}?t=not-the-token`);
    expect(response?.status()).toBe(404);
  });

  test("the token opens it with no session at all", async ({ page }) => {
    const response = await page.goto(URL);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});

test.describe("the header cannot disagree with the rows", () => {
  test("badge, h1 and row states all say the same number", async ({ page }) => {
    /*
       Criterion 3, and the spec names it as the defect this page is most likely
       to ship with. Asserted by parsing the rendered page rather than trusting
       one source: count the quoted rows, then read the badge and the h1 back.
    */
    await page.goto(URL);

    const states = await rows(page).evaluateAll((els) =>
      els.map((el) => el.textContent ?? ""),
    );
    const quoted = states.filter((s) => s.includes("QUOTED")).length;
    expect(quoted).toBeGreaterThan(0);

    await expect(page.getByText(`${quoted} quotes received`)).toBeVisible();

    const words = ["zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"];
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      `${words[quoted]} suppliers have quoted.`,
    );
  });
});

test.describe("the five recipient states", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(URL);
  });

  test("sorts replies to the top and endings to the bottom", async ({ page }) => {
    // Criterion 4. A buyer scanning wants the replies first, not chronology.
    const lines = await rows(page).evaluateAll((els) =>
      els.map((el) => (el.textContent ?? "").match(/QUOTED|OPENED|DELIVERED|DECLINED|NO RESPONSE/)?.[0] ?? ""),
    );
    const rank = { QUOTED: 0, OPENED: 1, DELIVERED: 2, DECLINED: 3, "NO RESPONSE": 4 } as Record<string, number>;
    const ranks = lines.map((l) => rank[l] ?? 9);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  test("gives exactly one row a primary action", async ({ page }) => {
    // One primary per view: the first quoted row and no other.
    const viewQuote = page.getByRole("link", { name: "View quote" });
    expect(await viewQuote.count()).toBeGreaterThan(1);
    const primaries = await viewQuote.evaluateAll((els) =>
      els.filter((el) => el.className.includes("bg-moss")).length,
    );
    expect(primaries).toBe(1);
  });

  test("a quote states how many lines it priced", async ({ page }) => {
    // Criterion 5: a buyer must know a line went unpriced before they compare.
    await expect(page.getByText(/QUOTED · \d+ OF \d+ LINES/).first()).toBeVisible();
  });

  test("never says no response while the window is open", async ({ page }) => {
    /*
       Criterion 6. A supplier with days left has not failed to respond; saying
       so would be unfair and wrong.
    */
    await expect(page.getByText(/CLOSES IN/)).toBeVisible();
    await expect(page.getByText("NO RESPONSE")).toHaveCount(0);
  });

  test("every seller name is a display name", async ({ page }) => {
    // Criterion 16, grepped over the rendered DOM.
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(/\bLLC\b/);
    expect(text).not.toMatch(/\bFZE\b/);
    expect(text).not.toMatch(/Trading Co\./);
  });
});

test.describe("the action row's limits", () => {
  test("compare is blocked below two quotes, with the reason on screen", async ({ page }) => {
    /*
       Criterion 11, on `ENQ-8890` — seeded for exactly this: one quote, still
       open, nothing accepted. `ENQ-8879` looked like the single-quote state and
       is not; its one quote was taken, which makes it the *accepted* state and
       a different page. The quote here still carries a primary action, because
       one quote is perfectly actionable even though it is not a comparison.
    */
    await page.goto(`/enquiry/ENQ-8890?t=${TOKEN}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("One supplier has quoted.");
    /*
       The action row renders at both breakpoints with `display` choosing one,
       so the reason line matches twice. Ask for the visible one — the same
       shape boards 1f and 1h both needed.
    */
    await expect(
      page.getByText("One more quote and you can compare side by side").locator("visible=true"),
    ).toHaveCount(1);
    await expect(page.getByRole("link", { name: "View quote" })).toBeVisible();
  });

  test("a partial quote says how many lines went unpriced", async ({ page }) => {
    // Criterion 5, on a real partial: two lines asked for, one priced.
    await page.goto(`/enquiry/ENQ-8890?t=${TOKEN}`);
    await expect(page.getByText(/QUOTED · 1 OF 2 LINES/)).toBeVisible();
  });
});

test.describe("once a quote is accepted", () => {
  test("the page reframes and stays the record", async ({ page }) => {
    /*
       Criterion 15. `ENQ-8879`'s quote was accepted, so the badge, the h1 and
       the action row all change — and the other rows say why they ended rather
       than leaving a buyer to think four suppliers went quiet.
    */
    await page.goto(`/enquiry/ENQ-8879?t=${TOKEN}`);
    await expect(page.getByText("Quote accepted")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("You accepted a quote.");
    /* Rendered at both breakpoints, so ask for the visible one. */
    await expect(
      page.getByRole("link", { name: "View the accepted quote" }).locator("visible=true"),
    ).toHaveCount(1);
    // The page is still reachable and still shows the enquiry: a permanent record.
    await expect(page.getByText("ENQ-8879")).toBeVisible();
  });
});

test.describe("privacy and indexing", () => {
  test("is noindex, nofollow and sends no referrer", async ({ page }) => {
    /*
       Criterion 17. `nofollow` as well as `noindex`, because every link on this
       page carries the token — a crawler following one would put a bearer
       secret into somebody else's logs.
    */
    await page.goto(URL);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /nofollow/);
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  });

  test("states the privacy promise the query layer keeps", async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByText(/Nobody gets your mobile until you accept a quote/)).toBeVisible();
  });
});

test.describe("accessibility and structure", () => {
  test("one h1, a real list, a polite live region, axe clean", async ({ page }) => {
    await page.goto(URL);
    await expect(page.locator("h1")).toHaveCount(1);
    // Criterion 18: the status card is a list, not a stack of divs.
    await expect(page.locator("ul[aria-label]")).toHaveCount(1);
    await expect(page.locator('[aria-live="polite"]')).toHaveCount(1);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
      .disableRules(["color-contrast"])
      .analyze();
    expect(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.length }))).toEqual([]);
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("Compare becomes a sticky bar and nothing scrolls sideways", async ({ page }) => {
    await page.goto(URL);
    const bar = page.locator("div.fixed.bottom-0");
    await expect(bar).toBeVisible();
    await expect(bar.getByRole("link", { name: "Compare the quotes" })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.body.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
