import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Board 4c — review a submission, the conflicting-claim body, from an ops
 * lead's session.
 *
 * The fixture is the board's own conflict on its own unpublished listing
 * (`prisma/seed-claim-conflict.mts`): claim A holds the licence the listing was
 * minted from and answered on the public-record number; claim B states another
 * licence our register does not hold.
 *
 * Nothing here resolves, escalates or asks for anything. The fixture is shared
 * by every retry and every shard (`e2e-destructive-tests-eat-fixtures`), and
 * the decisions are proved against the database in
 * `tests/integration/claim-conflict.test.ts`. What only a browser can prove is
 * that the screen states the evidence honestly, names its place in the list it
 * came from, and that every award control opens the same one sheet.
 *
 * 1280 × 720, the acceptance shard's width — where the rail stacks under the cards.
 */

test.use({ viewport: { width: 1280, height: 720 } });

const LISTING = "Zephyr Cooling Technical Services";
const table = (page: Page) => page.getByRole("table", { name: /Submissions waiting for a decision/ });

/** The row's place in the table the screen shows, and the link it carries. */
async function placeOf(page: Page, query: string): Promise<{ position: number; total: number; href: string }> {
  await page.goto(`/admin/queue${query}`);
  const rows = table(page).locator("tbody tr");
  const names = await rows.allInnerTexts();
  const index = names.findIndex((text) => text.includes(LISTING));
  expect(index, `${LISTING} is not in /admin/queue${query}`).toBeGreaterThanOrEqual(0);
  const href = await rows.nth(index).getByRole("link").first().getAttribute("href");
  expect(href).toMatch(/^\/admin\/queue\/conflict\//);
  return { position: index + 1, total: names.length, href: href! };
}

test.describe("board 4c — two claims on one listing", () => {
  test("names its place in the list it came from, counted from that list (criterion 11)", async ({ page }) => {
    for (const [query, scope] of [
      ["", "every kind"],
      ["?kind=conflict", "Conflict"],
    ] as const) {
      const place = await placeOf(page, query);
      await page.goto(place.href);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(LISTING);
      await expect(page.getByRole("navigation", { name: "Where this sits in the queue" })).toContainText(
        `${place.position} of ${place.total} · ${scope}`,
      );
    }
  });

  test("scores both claims on the same rows, and leads with the source licence (criteria 5, 6)", async ({ page }) => {
    await page.goto((await placeOf(page, "?kind=conflict")).href);

    await expect(page.getByText(/Claim A holds the licence this listing was created from, ADDED-771204/)).toBeVisible();
    const claimA = page.getByRole("article").filter({ hasText: "Claim A" });
    const claimB = page.getByRole("article").filter({ hasText: "Claim B" });
    await expect(claimA.getByText("Stronger", { exact: true })).toBeVisible();
    await expect(claimA.getByText("Holds the source licence")).toBeVisible();
    await expect(claimB.getByText("Not the source licence")).toBeVisible();
    // B's licence is not in our register, and the rows say so rather than scoring an absence.
    await expect(claimB.getByText("Not in our register").first()).toBeVisible();
    await expect(claimB.getByText(/@gmail\.com — free mail/)).toBeVisible();

    const rail = page.getByRole("complementary", { name: new RegExp(LISTING) });
    await expect(rail.getByText("ADDED-771204")).toBeVisible();
    await expect(rail.getByText(/called claim A on the public-record number/)).toBeVisible();
  });

  test("measures the age and the overdue from one opening: overdue is age less 48 hours (criterion 10)", async ({ page }) => {
    await page.goto((await placeOf(page, "?kind=conflict")).href);
    // `textContent`, not `innerText`: the log's stamp is uppercased by CSS, and the words are what is measured.
    const chip = (await page.getByText(/^Conflict · \d+ d( \d+ h)?$/).textContent()) ?? "";
    const overdue = (await page.getByText(/^Overdue by \d+ (d|h)/i).textContent()) ?? "";

    const hours = (text: string) => {
      const days = /(\d+) d/i.exec(text)?.[1] ?? "0";
      const rest = /(\d+) h/i.exec(text)?.[1] ?? "0";
      return Number(days) * 24 + Number(rest);
    };
    expect(hours(chip) - hours(overdue)).toBe(48);
  });

  test("opens one final, note-gated sheet from the card and from the rail alike (B2, criterion 3)", async ({ page }) => {
    await page.goto((await placeOf(page, "?kind=conflict")).href);

    for (const control of [
      page.getByRole("article").filter({ hasText: "Claim A" }).getByRole("button", { name: "Award to A" }),
      page.getByRole("button", { name: "Award to A & notify both" }),
    ]) {
      await control.click();
      const sheet = page.getByRole("dialog", { name: "Award this listing to claim A" });
      await expect(sheet).toBeVisible();
      await expect(sheet.getByText(/This is final/)).toBeVisible();
      // What B is told is one of four fixed sentences, and never names A.
      await expect(sheet.getByText("This listing was created from a different trade licence.")).toBeVisible();
      await expect(sheet.getByText(/Faisal|Al Marzooqi/)).toHaveCount(0);
      // No note, no resolution.
      await expect(sheet.getByRole("button", { name: "Award to claim A" })).toBeDisabled();
      await sheet.getByRole("button", { name: "Cancel" }).last().click();
      await expect(sheet).toHaveCount(0);
    }
  });

  test("moves through the queue with J and K", async ({ page }) => {
    const place = await placeOf(page, "");
    await page.goto(place.href);
    await expect(page.getByText("J / K to move")).toBeVisible();
    const here = page.url();
    await page.keyboard.press(place.position < place.total ? "j" : "k");
    await expect(page).not.toHaveURL(here);
    await expect(page).toHaveURL(/\/admin\/queue\//);
  });

  test("passes axe", async ({ page }) => {
    await page.goto((await placeOf(page, "?kind=conflict")).href);
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});
