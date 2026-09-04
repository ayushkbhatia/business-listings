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
  /*
     The reviews page, on the one seller that has one.

     This route pointed at `al-marwan`, which has no published review and
     therefore 404s — so the check has been measuring the width of an error page
     since the zero-count rule landed. Board 1m's page is the one with a filter
     row that scrolls horizontally inside a negative margin, which is exactly
     the shape this file exists to catch.
  */
  "/b/al-waha-industrial-supplies/reviews",
  "/b/al-waha-industrial-supplies/reviews?show=critical",
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

/**
 * The public bar at phone width.
 *
 * Not scrolling sideways was never enough on its own. The bar was one flex row
 * of brand, search, links and actions, and below `lg` the links hide but the
 * other three do not: at 375px the 168px wordmark and the 123px action button
 * left the search field 12px of a 335px content box, so a 46px input rendered
 * out of its own container and under the button. The document still measured
 * 375px throughout — nothing overflowed, the primary control of the site was
 * simply unusable — which is why these assert boxes rather than widths.
 *
 * Every public surface takes this bar from one `DirectoryNav`, so the routes
 * below are chosen for the shapes around it: the bleed home page, a category
 * page whose field carries a scope pill, a results page, a storefront, and the
 * RFQ wizard, whose fieldset is what the sideways-scroll rule above was for.
 */
const BAR_ROUTES = [
  "/",
  "/categories",
  "/c/valves-and-fittings",
  "/search?q=valve",
  "/b/al-marwan-industrial-supplies-llc",
  "/rfq/new?category=valves-and-fittings",
];

/** §09's floor: 44px on mobile, 32px on desktop. */
const MOBILE_TARGET = 44;

async function barBoxes(page: import("@playwright/test").Page) {
  const header = page.locator("header").first();
  const field = header.getByRole("searchbox");
  const cta = header.getByRole("link", { name: "List your business" });
  return {
    field: await field.boundingBox(),
    cta: await cta.boundingBox(),
    nav: await header.locator("nav").first().boundingBox(),
  };
}

test.describe("the public bar at 375px", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  for (const route of BAR_ROUTES) {
    test(`keeps the search field usable and clear of the actions: ${route}`, async ({ page }) => {
      await page.goto(route);
      const { field, cta } = await barBoxes(page);

      if (!field || !cta) throw new Error(`${route} has no public bar to measure`);

      // Wide enough to type a part number into. The regression rendered 46px.
      expect(field.width, `${route} search width`).toBeGreaterThan(240);

      // The two controls may not share any pixel. Before the fix the input ran
      // from x=204 to x=250 and the button began at x=232.
      const overlaps =
        field.x < cta.x + cta.width &&
        cta.x < field.x + field.width &&
        field.y < cta.y + cta.height &&
        cta.y < field.y + field.height;
      expect(overlaps, `${route} search overlaps the action`).toBe(false);

      expect(field.height, `${route} search height`).toBeGreaterThanOrEqual(MOBILE_TARGET);
      expect(cta.height, `${route} action height`).toBeGreaterThanOrEqual(MOBILE_TARGET);
    });
  }

  test("still submits the search on Enter", async ({ page }) => {
    await page.goto("/categories");
    const field = page.locator("header").first().getByRole("searchbox");
    await field.fill("gate valve");
    await field.press("Enter");
    await expect(page).toHaveURL(/\/search\?q=gate\+valve/);
  });

  test("reaches the action by keyboard, with a ring", async ({ page }) => {
    /*
       The action was a `<Link className="contents">` around a `tabIndex={-1}`
       button, and an anchor with `display: contents` generates no box, so Blink
       would not focus it at all — Tab went from the search field straight past
       it. It is the site's primary seller call to action and it was keyboard-
       dead on every public page, which no screenshot would have shown.
    */
    await page.goto("/categories");
    const header = page.locator("header").first();
    await header.getByRole("searchbox").focus();
    await page.keyboard.press("Tab");

    const cta = header.getByRole("link", { name: "List your business" });
    await expect(cta).toBeFocused();
    expect(
      await cta.evaluate((el) => el.matches(":focus-visible") && getComputedStyle(el).boxShadow),
    ).not.toBe("none");
  });
});

test.describe("the public bar above the wrap", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("is one 68px row, with the field between the brand and the actions", async ({ page }) => {
    await page.goto("/categories");
    const { field, cta, nav } = await barBoxes(page);

    if (!field || !cta || !nav) throw new Error("no public bar to measure");

    expect(Math.round(nav.height)).toBe(68);
    // Same row: the field's centre line falls inside the action's box.
    const centre = field.y + field.height / 2;
    expect(centre).toBeGreaterThan(cta.y);
    expect(centre).toBeLessThan(cta.y + cta.height);
    expect(field.x + field.width).toBeLessThanOrEqual(cta.x);
  });
});
