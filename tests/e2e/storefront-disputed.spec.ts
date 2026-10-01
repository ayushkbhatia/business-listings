import { expect, test } from "@playwright/test";

/**
 * Board 4c `B10`, signed out: while two claims wait on a listing and nobody has
 * decided between them, the public listing renders exactly as unclaimed —
 * neither claimant's name, badge, number or composer appears.
 *
 * `redstone-trading-co-llc` is the seed's published race: two claims, no owner,
 * `claimStatus = disputed`. Before board 4c only `unclaimed` chose the
 * unclaimed composition, so a disputed listing rendered as claimed by nobody.
 */
test("a disputed listing renders as unclaimed, naming no claimant", async ({ page }) => {
  const response = await page.goto("/b/redstone-trading-co-llc");
  expect(response?.status()).toBe(200);
  await expect(page.getByText("This listing has not been claimed")).toBeVisible();
  await expect(page.getByRole("link", { name: "Claim this listing" }).first()).toBeVisible();
  await expect(page.getByText(/Bilal Haque|Yusuf Rahman/)).toHaveCount(0);
});
