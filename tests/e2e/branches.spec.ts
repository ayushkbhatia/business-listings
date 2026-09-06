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

  test("shows the number on every branch that has one", async ({ page }) => {
    /*
       This page used to hide a number unless `Location.phoneVerified` was true,
       and nothing writes that column outside the seed — so in production every
       branch number was hidden from every buyer, while the seeded 80% made the
       page look correct.

       Asserted as "every branch with a number shows it" rather than a count, so
       the test says the rule rather than pinning a fixture: a seed that adds a
       branch should not need this edited, and a gate that came back would fail
       it whatever the fixture holds.
    */
    const branches = await rows(page).count();
    expect(branches).toBeGreaterThan(0);

    // One `tel:` link per branch at least. `rows()` is the branch list rather
    // than every `listitem` on the page — the nav and the breadcrumb are lists
    // too, and counting those made the first version of this expect 33.
    const numbers = await page.locator("main a[href^='tel:']").count();
    expect(numbers).toBeGreaterThanOrEqual(branches);

    // And none of them reads as absent. Before the gate came off, every branch
    // on a production listing rendered this instead of the number.
    await expect(page.getByText("Not provided", { exact: true })).toHaveCount(0);
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
    /*
       And the number, on every branch that has one. Structured data that
       omitted a telephone the page displays is the mismatch crawlers penalise,
       and the storefront one level up has always marked its own up without a
       verification gate.
    */
    expect(blocks.every((b) => b["telephone"])).toBe(true);
  });

  test("the branch list is a list", async ({ page }) => {
    // Criterion 13. A map is an image; this is the same information, readable.
    await expect(rows(page)).toHaveCount(6);
  });

  test("is axe clean", async ({ page }) => {
    /*
       Contrast excluded, as every other axe test in this suite does, for the
       reason set out in `docs/contrast.md`: the failing pairs are token-level
       and pinned awaiting a canvas decision.

       Worth recording what it caught before the exclusion, because it was not
       this page: `DirectoryNav`'s links and the breadcrumb, `--text-muted` on
       `--paper` at 4.23:1. Shared chrome on every public route, and exactly the
       pairing that document enumerates.
    */
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
      .disableRules(["color-contrast"])
      .analyze();
    expect(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.length }))).toEqual([]);
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
    await expect(page.getByText("SORTED BY EMIRATE", { exact: true })).toBeVisible();
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
    /*
       Exact, because the fallback sentence — "Location unavailable, so branches
       are sorted by emirate." — contains the phrase too, and a substring match
       resolves to both.
    */
    await expect(page.getByText("SORTED BY EMIRATE", { exact: true })).toBeVisible();
  });
});

test.describe("the map and the list are one control", () => {
  /*
     What can and cannot be tested here.

     MapLibre needs WebGL and headless Chromium has none, so the map never
     draws — on this page or any other. No test in this suite asserts a
     `canvas` or a `.maplibregl-marker` for that reason, and the first version
     of these two did, which is why they failed rather than why the page is
     wrong.

     So this covers the wiring either side of the map: the pin data reaching
     `MapCanvas`, and the selection the pins drive once clicked. The pin click
     itself is verified by hand — see the PR — and the state it sets is the same
     state the rank button sets, which is what these assert.
  */
  test.use({ viewport: { width: 1440, height: 900 } });

  test("hands the map every pinned branch, and only those", async ({ page }) => {
    await page.goto(SELLER);
    /*
       Five of six: the Ajman counter has no coordinates. `MapCanvas` renders
       its pins as an `sr-only` list, so this is the plotted set, readable.
    */
    const plotted = page.locator("figure ul.sr-only li");
    await expect(plotted).toHaveCount(5);
    await expect(plotted.filter({ hasText: "Al Jurf" })).toHaveCount(0);
    // And the page says how many it held back rather than swallowing them.
    await expect(page.getByText(/1 branch has no map pin/)).toBeVisible();
  });

  test("selecting a branch expands it and collapses the last one", async ({ page }) => {
    // The state a pin click sets. Criterion 11's list half.
    await page.goto(SELLER);
    const first = rows(page).first();
    const depot = rows(page).filter({ hasText: "Depot" });

    /*
       "WhatsApp", not "WHATSAPP". The eyebrow is uppercased in CSS and the DOM
       keeps the sentence case the catalogue holds — asserting the rendered look
       rather than the text is how this failed the first time.

       The label only exists on the expanded card, so its presence is the
       expansion.
    */
    await expect(first).toContainText("WhatsApp");
    await expect(depot).not.toContainText("WhatsApp");

    await depot.getByRole("button").first().click();

    await expect(depot).toContainText("WhatsApp");
    await expect(first).not.toContainText("WhatsApp");
  });

  test("the radius overlay is off until asked for", async ({ page }) => {
    /*
       A shaded circle is a claim about where a supplier delivers. It appears
       when a buyer asks, not by default. The button is real without WebGL; only
       the drawing needs it.
    */
    await page.goto(SELLER);
    const toggle = page.getByRole("button", { name: "Service radius overlay" });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("when the pins are missing", () => {
  /*
     Desktop, because the panel replaces the *map column* and below 1024 there
     is no map column to replace — the page is list-only there by design, and
     every row carries its own "No map pin yet" instead. Asserting the panel on
     a phone was asserting a layout the board does not ask for.
  */
  test.use({ viewport: { width: 1440, height: 900 } });

  test("replaces the map with a sentence and keeps the delivery card", async ({ page }) => {
    // Criterion 5. Never a blank grey rectangle.
    await page.goto(UNPINNED);
    await expect(page.getByText("Map pins are being added for this supplier")).toBeVisible();
    /*
       The card is rendered twice with `display` at opposite breakpoints so that
       exactly one is ever in the accessibility tree. `.first()` is whichever
       comes first in the DOM, which at this viewport is the hidden one — so ask
       for the visible one rather than the first one.
    */
    await expect(
      page.getByText(/Delivers within \d+ km/).locator("visible=true"),
    ).toHaveCount(1);

    /*
       `MapCanvas` renders its pins as an `sr-only` list, always — a map is an
       image, and that list is the same information in a form that can be read.
       With no pins there is no list, which is what proves nothing was plotted.
       Asserting on a `canvas` would prove nothing: headless Chromium has no
       WebGL, so MapLibre never draws one on any page.
    */
    await expect(page.locator("figure ul.sr-only li")).toHaveCount(0);
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
