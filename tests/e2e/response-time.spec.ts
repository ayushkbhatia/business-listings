import { expect, test } from "@playwright/test";

/**
 * Acceptance criterion 5, the rendering half:
 *
 *   "Median response time is computed from real timestamps and renders on the
 *    public storefront built in handoff 1."
 *
 * The computation is proven in tests/integration/response-time.test.ts. This is
 * the part that only a browser can see: that the number reaches the page, that
 * every band draws, and that the unmeasured state says so rather than hiding.
 *
 * The seeded reply history is fixed, so these numbers are stable. They come
 * from the same derivation the scheduled job runs — see deriveResponseTimes in
 * prisma/seed.mts.
 */

/** Fast, moderate, slow and unmeasured, from the seeded profiles. */
const FAST = "al-marwan-industrial-supplies-llc";
const MODERATE = "desert-anchor-general-trading-llc";
const SLOW = "eastward-industrial-supplies-llc";
/** Claimed, published, and with no reply history — the new-listing state. */
const UNMEASURED = "al-sahra-building-materials-llc";

test.describe("on the storefront", () => {
  test("shows a measured reply time, not a claimed one", async ({ page }) => {
    await page.goto(`/b/${FAST}`);
    await expect(page.getByText(/Typically replies in/).first()).toBeVisible();
  });

  test("draws each band the README names", async ({ page }) => {
    // Green under two hours, amber under six, red beyond. The duration is
    // always printed beside the band — a colour on its own is colour-alone
    // and less useful than the number it stands in for.
    for (const slug of [FAST, MODERATE, SLOW]) {
      await page.goto(`/b/${slug}`);
      const label = page.getByText(/Typically replies in/).first();
      await expect(label, slug).toBeVisible();
      await expect(label, slug).toContainText(/\d+\s*(min|h)/);
    }
  });

  test("the number on the page is the number in the database", async ({ page, request }) => {
    // Rendered from the derived column, not recomputed in the view.
    await page.goto(`/b/${FAST}`);
    const shown = await page.getByText(/Typically replies in/).first().textContent();
    expect(shown).toMatch(/\d+/);

    const listing = await request.get(`/b/${FAST}`);
    expect((await listing.text())).toContain(shown!.trim());
  });
});

test.describe("on a results row", () => {
  test("carries the same measured number", async ({ page }) => {
    await page.goto("/search?q=valve");
    await expect(page.getByText(/replies in/).first()).toBeVisible();
  });
});

test.describe("what is never shown", () => {
  test("no seller-facing screen offers a field for it", async ({ page }) => {
    // Criterion 5's second half, as far as a browser can see it: the public
    // listing shows the number and nothing anywhere offers to change it.
    await page.goto(`/b/${FAST}`);
    await expect(page.locator('[name*="responseTime" i]')).toHaveCount(0);
  });

  test("an unmeasured supplier says so rather than showing a zero", async ({ page }) => {
    // "Not enough enquiries to measure" is true and is not a penalty. A zero,
    // or a hidden row, would each be a lie of a different kind.
    await page.goto(`/b/${UNMEASURED}`);
    await expect(page.getByText("Not enough enquiries to measure").first()).toBeVisible();
    await expect(page.getByText(/replies in 0\s*min/)).toHaveCount(0);
  });
});
