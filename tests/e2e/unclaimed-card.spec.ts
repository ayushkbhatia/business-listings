import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Build plan 4.6 — the unclaimed card, everywhere a buyer can reach it.
 *
 * The state existed and production never rendered it: it was a fifth `context`
 * word on `ListingCard` that only the gallery passed, so search, the category
 * shelves, the landing pages and the home page drew a licence import with a
 * quote button the enquiry service then refused. The card now reads
 * `claimStatus`, and the blended search's supplier row — a sixth surface the
 * card never covered — reads the same answer.
 *
 * Each surface is asserted over every unclaimed row it renders rather than one
 * pinned slug, so a reseed that moves which listings land on page one moves
 * nothing here, and each asserts that it found at least one.
 */

const UNCLAIMED_LINE = "This listing has not been claimed";

async function unclaimedRows(page: Page, rows: Locator): Promise<Locator[]> {
  await expect(rows.first()).toBeVisible();
  const found: Locator[] = [];
  for (const row of await rows.all()) {
    if ((await row.textContent())?.includes(UNCLAIMED_LINE)) found.push(row);
  }
  expect(found.length, "an unclaimed row on the page").toBeGreaterThan(0);
  return found;
}

async function expectHonestRow(row: Locator) {
  // No enquiry the service would refuse, and no contact action.
  await expect(row.getByRole("link", { name: /Ask for a quote/ })).toHaveCount(0);
  await expect(row.getByRole("button", { name: /Ask for a quote|WhatsApp/ })).toHaveCount(0);
  // It goes to the listing, which is a listing and not a storefront.
  await expect(row.getByRole("link", { name: "View listing" })).toHaveAttribute("href", /^\/b\/[^/]+$/);
  await expect(row.getByRole("link", { name: "View storefront" })).toHaveCount(0);
  // No reply band and no rating, measured or not.
  await expect(row).not.toContainText(/Typically replies|Not enough enquiries|reviews?\b/);
}

test("the category shelf draws its unclaimed rows as unclaimed", async ({ page }) => {
  await page.goto("/c/hvac-and-ventilation?sort=newest");
  for (const row of await unclaimedRows(page, page.locator("article"))) {
    await expectHonestRow(row);
    // The panel as designed: the claim, prefilled with the licence — or no
    // claim at all on a lapsed licence — and the report.
    const claim = row.getByRole("link", { name: "Claim this listing" });
    if ((await claim.count()) > 0) {
      await expect(claim).toHaveAttribute("href", /^\/onboarding\/claim\?licence=/);
      await expect(claim).toHaveAttribute("rel", /nofollow/);
    }
    await expect(row.getByRole("link", { name: "Report this listing" })).toHaveAttribute(
      "href",
      /^\/report\/[^/]+$/,
    );
  }
});

test("the map search draws its unclaimed rows as unclaimed, keeping the rank its pin pairs with", async ({
  page,
}) => {
  await page.goto("/search?emirate=abu_dhabi");
  for (const row of await unclaimedRows(page, page.locator("li[data-business-id]"))) {
    await expectHonestRow(row);
  }
});

test("the landing page ranks its unclaimed rows as unclaimed", async ({ page }) => {
  await page.goto("/dubai/jebel-ali-free-zone/hvac-and-ventilation");
  for (const row of await unclaimedRows(page, page.locator("ol > li").filter({ has: page.getByRole("article") }))) {
    await expectHonestRow(row);
  }
});

test("the blended search's supplier row says it, and opens the listing", async ({ page }) => {
  await page.goto("/search?q=Deira+Cooling+House");
  const row = page
    .locator('[data-result-kind="supplier"]')
    .filter({ has: page.getByRole("heading", { name: "Deira Cooling House" }) });
  await expect(row).toContainText(UNCLAIMED_LINE);
  await expect(row.getByRole("link", { name: /Ask for a quote/ })).toHaveCount(0);

  await row.getByRole("link", { name: "View listing" }).click();
  await expect(page).toHaveURL(/\/b\/deira-cooling-house-llc$/);
  await expect(page.getByRole("region", { name: "What the public record says" })).toBeVisible();
});
