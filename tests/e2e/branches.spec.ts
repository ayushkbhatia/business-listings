import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Board 1f — branches & hours.
 *
 * The criteria that only exist in a browser: the pin that follows the cursor
 * down the list, the geolocation that must be asked for and never assumed, the
 * map that hands off to the phone's own app, and the states a buyer sees when
 * the data is incomplete.
 *
 * The rules underneath — the Dubai clock, the closure that outranks the hours,
 * the ordering fallback — are pinned in `lib/trade/branches.test.ts`, where they
 * can be tested against a fixed instant rather than whenever CI happens to run.
 */

const SELLER = "/b/al-marwan-industrial-supplies-llc/branches";
/** Seeded with every location unpinned, for the map's replacement panel. */
const UNPINNED = "/b/al-areen-industrial-supplies-llc/branches";

const rows = (page: import("@playwright/test").Page) =>
  page.locator("main ul > li").filter({ has: page.locator("h2") });

test.describe("the page a buyer opens on a Thursday afternoon", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(SELLER);
  });

  test("carries the display name and no legal suffix anywhere", async ({ page }) => {
    /*
       Criterion 1, and the one the pre-flight says keeps regressing. The header
       is shared across 1d, 1e and 1f — a buyer moving between tabs must never
       watch the supplier's name change.
    */
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Al Marwan Industrial Supplies",
    );
    const text = await page.locator("main").innerText();
    expect(text).not.toContain("LLC");
    expect(text).not.toContain("FZE");
  });

  test("names the branch count and the emirates, capped at three", async ({ page }) => {
    await expect(page.getByText(/6 branches · Dubai, Abu Dhabi, Ajman \+1 more/)).toBeVisible();
  });

  test("badges a sales office with its type rather than its hours", async ({ page }) => {
    /*
       Criterion 6. The office keeps its hours in the row — it is worth phoning
       — but the badge carries the fact that changes the plan, because a buyer
       who reads "Open now" loads a van and drives to a room with a desk in it.
    */
    const office = rows(page).filter({ hasText: "Sales office" });
    await expect(office).toContainText("Sales only");
    await expect(office).not.toContainText("Open now");
  });

  test("keeps an unpinned branch in the list, with its address, and says so", async ({ page }) => {
    // Criterion 4. Useful unpinned, and never approximated to an area centroid.
    const unpinned = rows(page).filter({ hasText: "Al Jurf Industrial 1" });
    await expect(unpinned).toBeVisible();
    await expect(unpinned).toContainText("No map pin yet");
  });

  test("a closed branch says when it opens, never a bare Closed", async ({ page }) => {
    /*
       Criterion 7. The seeded depot is shut for roof repairs, so the answer is
       a date rather than a time — a closure that reported "opens 08:00" would
       be describing a door that is not going to open at eight.
    */
    const depot = rows(page).filter({ hasText: "Depot" });
    await expect(depot).toContainText(/Closed until \d/);
    await expect(depot).toContainText("Roof repairs after the storm");
  });

  test("every phone number is a tel: link", async ({ page }) => {
    // Criterion 13. It read as a number and was not one on the compact rows.
    const numbers = page.locator("main a[href^='tel:']");
    await expect(numbers.first()).toBeVisible();
    expect(await numbers.count()).toBeGreaterThanOrEqual(5);
    for (const href of await numbers.evaluateAll((links) =>
      links.map((l) => l.getAttribute("href")),
    )) {
      // E.164 in the href, because a dialler needs the country code.
      expect(href).toMatch(/^tel:\+971\d+$/);
    }
  });

  test("emits one LocalBusiness per branch, and no geo for the unpinned one", async ({ page }) => {
    /*
       Criterion 9. This is the page Google reads for local pack eligibility, so
       a single blob covering six addresses would be the wrong markup here of
       all places. A coordinate we do not have is not one we may invent.
    */
    const blocks = await page
      .locator('script[type="application/ld+json"]')
      .evaluateAll((nodes) =>
        nodes
          .map((n) => JSON.parse(n.textContent ?? "{}") as Record<string, unknown>)
          .filter((b) => b["@type"] === "LocalBusiness"),
      );
    expect(blocks).toHaveLength(6);
    expect(blocks.every((b) => b["address"])).toBe(true);
    expect(blocks.filter((b) => !b["geo"])).toHaveLength(1);
    expect(blocks.every((b) => b["openingHoursSpecification"])).toBe(true);
  });

  test("the branch list is a list", async ({ page }) => {
    // Criterion 13. A map is an image; this is the same information, readable.
    await expect(rows(page)).toHaveCount(6);
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("nearest to me", () => {
  test("asks on click, never on load", async ({ page, context }) => {
    /*
       Criterion 8. A page that asks for a location the moment it opens trains
       people to refuse; this one only needs it when the buyer asks which branch
       is closest.
    */
    let asked = false;
    await page.addInitScript(() => {
      const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
      Object.defineProperty(navigator.geolocation, "getCurrentPosition", {
        value: (...args: unknown[]) => {
          (window as unknown as { __asked: boolean }).__asked = true;
          return (original as (...a: unknown[]) => void)(...args);
        },
      });
    });
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 25.32, longitude: 55.4 });

    await page.goto(SELLER);
    await expect(page.getByText("SORTED BY EMIRATE")).toBeVisible();
    asked = await page.evaluate(() => Boolean((window as unknown as { __asked?: boolean }).__asked));
    expect(asked).toBe(false);

    await page.getByRole("button", { name: "Nearest to me" }).click();
    // Sharjah is the origin, so the Sharjah depot leads once distance decides.
    await expect(page.getByText("NEAREST FIRST")).toBeVisible();
    await expect(rows(page).first()).toContainText("Depot");
  });

  test("falls back to emirate order and says so when declined", async ({ page, context }) => {
    // Never a silent no-op: the strip label stays honest about what it sorted by.
    await context.clearPermissions();
    await page.addInitScript(() => {
      Object.defineProperty(navigator.geolocation, "getCurrentPosition", {
        value: (_ok: unknown, fail: (e: unknown) => void) =>
          fail({ code: 1, message: "denied" }),
      });
    });
    await page.goto(SELLER);
    await page.getByRole("button", { name: "Nearest to me" }).click();
    await expect(page.getByText("Location unavailable")).toBeVisible();
    await expect(page.getByText("SORTED BY EMIRATE")).toBeVisible();
  });
});

test.describe("the map and the list are one control", () => {
  test("clicking a pin expands that branch", async ({ page }) => {
    // Criterion 11. Without it, clicking pin 5 expands a card nobody can see.
    await page.goto(SELLER);
    const pin = page.locator(".maplibregl-marker button, button.maplibregl-marker");
    await expect(pin.first()).toBeVisible({ timeout: 20_000 });

    const depotPin = page.locator("button[aria-label*='Depot']");
    await depotPin.click();
    await expect(rows(page).filter({ hasText: "Depot" })).toContainText("WHATSAPP");
  });

  test("the radius overlay is off until asked for", async ({ page }) => {
    /*
       A shaded circle is a claim about where a supplier delivers. It appears
       when a buyer asks, not by default.
    */
    await page.goto(SELLER);
    const toggle = page.getByRole("button", { name: "Service radius overlay" });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("when the pins are missing", () => {
  test("replaces the map with a sentence and keeps the delivery card", async ({ page }) => {
    // Criterion 5. Never a blank grey rectangle.
    await page.goto(UNPINNED);
    await expect(page.getByText("Map pins are being added for this supplier")).toBeVisible();
    await expect(page.getByText(/Delivers within \d+ km/).first()).toBeVisible();
    await expect(page.locator("canvas")).toHaveCount(0);
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("is a list, with 44px actions that hand off to the maps app", async ({ page }) => {
    // Criterion 12. Turn-by-turn directions, not a pannable map in a browser tab.
    await page.goto(SELLER);

    const directions = page.getByRole("link", { name: "Directions" }).first();
    await expect(directions).toHaveAttribute("href", /google\.com\/maps/);
    expect((await directions.boundingBox())?.height).toBeGreaterThanOrEqual(44);

    // No in-page map at all below 768.
    await expect(page.locator("canvas")).toHaveCount(0);

    const overflow = await page.evaluate(
      () => document.body.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
