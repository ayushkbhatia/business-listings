import { expect, test } from "@playwright/test";

/**
 * No public route may pan sideways.
 *
 * A page whose document is wider than its viewport scrolls horizontally over
 * blank space, and on a touch device the offset also puts the wrong element
 * under a tap. /rfq/new did both: the line-items table's 40rem floor sits in
 * an `overflow-x-auto` wrapper, which normally clips, but the wrapper is
 * inside a `<fieldset>` and the document counted the clipped width anyway. At
 * 412px the page measured 693px and the wizard's Continue button could not be
 * pressed at all.
 *
 * Two rules came out of it — `fieldset { min-inline-size: 0 }` in globals.css
 * and `contain-paint` on that wrapper — and this is what stops the third
 * fieldset from quietly doing it again. It runs on both projects because the
 * failure only shows below the width at which the table stops fitting.
 */
const ROUTES = [
  "/",
  "/c/valves-and-fittings",
  "/search?q=valve",
  "/compare?p=al-marwan-industrial-supplies-llc",
  "/b/al-marwan-industrial-supplies-llc",
  "/b/al-marwan-industrial-supplies-llc/products",
  "/b/al-marwan-industrial-supplies-llc/reviews",
  "/rfq/new?category=valves-and-fittings",
  "/signin",
  "/signup",
  "/for-buyers",
  "/list-your-business",
  "/staff",
];

for (const route of ROUTES) {
  test(`does not scroll sideways: ${route}`, async ({ page }) => {
    await page.goto(route);
    const { documentWidth, viewportWidth } = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(documentWidth, route).toBe(viewportWidth);
  });
}
