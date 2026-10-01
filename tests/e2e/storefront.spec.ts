import { expect, test } from "@playwright/test";

/**
 * Handoff 1, step 3. The storefront and product routes, against the seeded
 * database.
 *
 * Slugs are hardcoded because the seed is deterministic — a fixed PRNG and a
 * fixed NOW. If the seed changes these fail loudly, which is the correct
 * outcome: the fixtures below encode the states the checkpoint asks for.
 */
const CLAIMED = "al-marwan-industrial-supplies-llc"; // tier 3, 3 branches
const REVIEWED = "al-manara-equipment-trading-llc"; // the one business with a review
const UNCLAIMED = "al-wadi-technical-services-llc"; // licence import, unpinned branch
// Board 10g's drawn record and its lapsed sibling — prisma/seed-unclaimed-listing.mts.
const DRAWN = "deira-cooling-house-llc";
const LAPSED = "naif-ventilation-trading-llc";
// Two claims open on it, from the main generator.
const DISPUTED = "redstone-trading-co-llc";

async function jsonLd(page: import("@playwright/test").Page) {
  return page.$$eval('script[type="application/ld+json"]', (nodes) =>
    nodes.map((n) => JSON.parse(n.textContent ?? "{}")),
  );
}

test.describe("one route, two compositions", () => {
  test("a claimed business renders the 1d composition", async ({ page }) => {
    await page.goto(`/b/${CLAIMED}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Al Marwan");
    // Tabs, catalogue, the verification panel — none of which the unclaimed
    // page has. Scoped by its count: the top bar now carries a "Products" item
    // too, and the storefront's own tab is the one that says how many.
    await expect(page.getByRole("link", { name: /Products \d/ })).toBeVisible();
    /*
     * Board 1d replaced the four-rung ladder with the three checks it names —
     * licence, TRN, premises — each stating its own state and carrying its own
     * date. The assertion moved with it; what it is protecting has not changed.
     */
    await expect(page.getByRole("heading", { name: "What we checked" })).toBeVisible();
    await expect(page.getByText("not self-declared")).toBeVisible();
    await expect(page.getByText("has not been claimed")).toHaveCount(0);
  });

  test("renders its sections, with the licence panel outside them", async ({ page }) => {
    /*
     * The details panel and the verification panel are asserted beside a
     * section on purpose: they are chrome, not sections, because non-negotiable
     * 2 says trust signals render identically on every storefront. A test that
     * only checked the sections would not notice a rewrite quietly dropping
     * them.
     *
     * This caught exactly that when board 1d rebuilt the rail: the licence, the
     * authority and the masked TRN had moved to the left column and the ladder
     * had become the "what we checked" panel, and the test failed until both
     * were accounted for rather than lost.
     */
    await page.goto(`/b/${CLAIMED}`);

    // A section.
    await expect(page.getByRole("heading", { name: "Catalogue", exact: true })).toBeVisible();

    // Chrome.
    await expect(page.getByRole("heading", { name: "What we checked" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Business details" })).toBeVisible();
    await expect(page.getByText("Trade licence", { exact: true })).toBeVisible();
  });

  test("an unclaimed business renders the 10g composition from the same route", async ({ page }) => {
    await page.goto(`/b/${UNCLAIMED}`);
    await expect(page.getByText("This listing has not been claimed")).toBeVisible();
    // No tabs, no catalogue, no verification panel — the unclaimed composition
    // states what is unverified rather than listing checks nobody ran.
    await expect(page.getByRole("heading", { name: "What we checked" })).toHaveCount(0);
    // One h1, the display name — the owner's answer on 10g `B2`, 1 Oct 2026.
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).not.toContainText(/LLC|FZE/);
    await expect(page.getByText("Unclaimed", { exact: true })).toBeVisible();
  });

  test("the record says what the register holds, and labels what it lacks", async ({ page }) => {
    await page.goto(`/b/${DRAWN}`);
    const record = page.getByRole("region", { name: "What the public record says" });
    await expect(record).toBeVisible();
    await expect(record.getByText(/Imported Jan 2026/i)).toBeVisible();

    // `B2`: the h1 is the display name, and the legal name sits in the record.
    await expect(page.locator("h1")).toHaveText("Deira Cooling House");
    await expect(record).toContainText("Deira Cooling House LLC");
    await expect(record).toContainText("DED-118904");
    // `B4`: the expiry reaches the page, beside "not verified by us".
    await expect(record).toContainText(/Active until \d{1,2} \w{3} \d{4} · not verified by us/);
    await expect(record).toContainText("Trading in air-conditioning & ventilation equipment");

    // `B3`: absent, muted, and still there — never hidden.
    const phone = record.locator('[data-record-row="phone"]');
    await expect(phone).toContainText("Not on record");
    await expect(phone).toHaveAttribute("data-absent", "");
    await expect(record.locator('[data-record-row="provided"]')).toContainText("Not provided");
  });

  test("prints no telephone, in any form, anywhere on the page", async ({ page }) => {
    // `B5`, on the sibling whose import did carry a number.
    await page.goto(`/b/${LAPSED}`);
    await expect(page.locator('[data-record-row="phone"]')).toContainText("On record");
    const body = (await page.textContent("main")) ?? "";
    expect(body).not.toMatch(/\+?971|\b0\d[\s-]?\d{3}[\s-]?\d{4}\b|226\s?1180/);
    await expect(page.getByRole("button", { name: /reveal|show number|call/i })).toHaveCount(0);
  });

  test("both claim controls go to 2a with the licence, which answers with one exact match", async ({
    page,
  }) => {
    /*
       `B10`. Both were `<button disabled>` under a stale enquiry tooltip once,
       and then linked with the display name, which put the claimant in a list
       of lookalikes on the one screen whose job is telling them apart.
    */
    await page.goto(`/b/${DRAWN}`);
    const claims = page.getByRole("link", { name: /^Claim this listing/ });
    // Q5: the banner's and the card's on a desktop, where they serve two scroll
    // depths; on a phone the card's alone, first under the identity block.
    await expect(claims).toHaveCount((page.viewportSize()?.width ?? 1280) >= 768 ? 2 : 1);
    for (const claim of await claims.all()) {
      await expect(claim).toHaveAttribute("href", "/onboarding/claim?licence=DED-118904");
      // ~30,000 distinct query strings into a noindex funnel step.
      await expect(claim).toHaveAttribute("rel", /nofollow/);
    }
    // `B11`: the time from the one value 2a's add-new card reads.
    await expect(page.getByText(/takes about 6 minutes with your trade licence to hand/)).toBeVisible();

    await page.getByRole("link", { name: "Claim this listing", exact: true }).click();
    await expect(page).toHaveURL(/\/onboarding\/claim\?licence=DED-118904$/);
    await expect(page.getByText("EXACT LICENCE MATCH")).toBeVisible();
    await expect(page.getByRole("button", { name: "This is us" }).or(page.getByRole("link", { name: "This is us" }))).toBeVisible();
  });

  test("its report goes to 13c", async ({ page }) => {
    await page.goto(`/b/${UNCLAIMED}`);
    const report = page.getByRole("link", { name: "Report this listing" });
    await expect(report).toHaveCount(1);
    /*
       Board 4h. This opened `/verification-policy` — the page explaining how a
       licence is checked, not the one that takes a report — and this test held
       it there. On an unclaimed listing the details are the most likely thing
       on the page to be wrong, and the person who knows is standing in front of
       it. `nofollow` because the route takes a report, not a crawl.
    */
    await expect(report).toHaveAttribute("href", `/report/${UNCLAIMED}`);
    await expect(report).toHaveAttribute("rel", /nofollow/);
  });

  test("an unclaimed listing invents nothing", async ({ page }) => {
    await page.goto(`/b/${UNCLAIMED}`);
    const body = (await page.textContent("body")) ?? "";

    // No hours for a business that never told us any.
    expect(body).not.toContain("Sunday");

    // No reviews section and no rating for the subject.
    await expect(page.getByRole("heading", { name: /^Reviews$/ })).toHaveCount(0);
    await expect(page.locator("[data-rating], .star, [aria-label*=star i]")).toHaveCount(0);

    // Absent fields are marked absent, not dropped: hours, photos and products
    // always, and whatever else the import did not carry.
    await expect(page.locator("[data-record-row][data-absent]").first()).toBeVisible();
    await expect(page.getByText("Not provided")).toBeVisible();
  });

  test("an unclaimed listing offers a way out — claimed suppliers, never paid", async ({ page }) => {
    await page.goto(`/b/${DRAWN}`);
    const suggestions = page.getByRole("region", { name: "Claimed suppliers in the same trade" });
    await expect(suggestions).toBeVisible();
    const rows = suggestions.getByRole("listitem");
    await expect(rows.first()).toBeVisible();
    const count = await rows.count();
    // 13d's cap, and valid with one.
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(3);
    for (const row of await rows.all()) {
      // `B8`: the credential component's string, on every row.
      await expect(row).toContainText("Licence verified");
      await expect(row.getByRole("link", { name: /^View / })).toHaveAttribute("href", /^\/b\//);
    }
    // D-LINE: 13d's promise, printed.
    await expect(suggestions).toContainText("Nearest matches by trade and area, not paid placements.");
    await expect(suggestions).not.toContainText("published specs");
  });

  test("with nobody to suggest, the section is removed rather than drawn empty", async ({ page }) => {
    // Nobody in this listing's trade is claimed, licence-verified and measured.
    await page.goto(`/b/${UNCLAIMED}`);
    await expect(page.getByRole("heading", { name: "Claimed suppliers in the same trade" })).toHaveCount(0);
  });

  test("a lapsed licence: expired on record, no claim offered, out of the index", async ({ page }) => {
    await page.goto(`/b/${LAPSED}`);
    await expect(page.locator('[data-record-row="status"]')).toContainText(/Expired on record · \d{1,2} \w{3} \d{4}/);
    // `B4`, after 13d's rule: neither claim control.
    await expect(page.getByRole("link", { name: /^Claim this listing/ })).toHaveCount(0);
    // Q4: the owner's answer of 1 Oct 2026.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("a disputed listing renders as unclaimed, says a claim is under review, and names nobody", async ({
    page,
  }) => {
    // Board 4c `B10`. This route used to hand it the claimed storefront.
    await page.goto(`/b/${DISPUTED}`);
    await expect(page.getByText("This listing has not been claimed")).toBeVisible();
    await expect(page.getByRole("heading", { name: "What we checked" })).toHaveCount(0);
    // Q2: it says so, and still takes a claim — 2b's rule.
    await expect(page.getByText("A claim on this listing is being reviewed.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Claim this listing", exact: true })).toBeVisible();
    // Its tabs went with the composition.
    const response = await page.goto(`/b/${DISPUTED}/products`);
    expect(response?.status()).toBe(404);
  });

  test("the unclaimed route has no catalogue, branches or reviews tab", async ({ page }) => {
    for (const suffix of ["products", "branches", "reviews"]) {
      const response = await page.goto(`/b/${UNCLAIMED}/${suffix}`);
      expect(response?.status(), suffix).toBe(404);
    }
  });
});

test.describe("no price on a public surface", () => {
  for (const path of [
    `/b/${CLAIMED}`,
    `/b/${CLAIMED}/products`,
    `/b/${CLAIMED}/p/resilient-seated-gate-valve-dn150-0`,
    `/b/${UNCLAIMED}`,
  ]) {
    test(`${path} renders no price`, async ({ page }) => {
      await page.goto(path);
      const body = (await page.textContent("body")) ?? "";
      expect(body).not.toMatch(/AED\s*[\d,]/);
      expect(body).not.toMatch(/\bد\.إ/);
    });
  }

  test("the product offer carries availability and no price", async ({ page }) => {
    await page.goto(`/b/${CLAIMED}/p/resilient-seated-gate-valve-dn150-0`);
    const blocks = await jsonLd(page);
    const product = blocks.find((b) => b["@type"] === "Product");
    expect(product).toBeTruthy();
    expect(product.offers.availability).toMatch(/schema\.org\/(InStock|MadeToOrder|BackOrder|OutOfStock)/);
    expect(product.offers.price).toBeUndefined();
    expect(product.offers.priceCurrency).toBeUndefined();
  });

  test("no cart or checkout route exists", async ({ page }) => {
    for (const path of ["/cart", "/checkout", "/basket"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
    }
  });
});

test.describe("structured data", () => {
  test("aggregateRating appears only when reviews exist", async ({ page }) => {
    await page.goto(`/b/${CLAIMED}`);
    const withoutReviews = (await jsonLd(page)).find((b) => b["@type"] === "LocalBusiness");
    expect(withoutReviews.aggregateRating).toBeUndefined();

    await page.goto(`/b/${REVIEWED}`);
    const withReviews = (await jsonLd(page)).find((b) => b["@type"] === "LocalBusiness");
    expect(withReviews.aggregateRating.reviewCount).toBeGreaterThan(0);
    expect(withReviews.aggregateRating.ratingValue).toBeGreaterThan(0);
  });

  test("an unclaimed listing marks up only the licence record", async ({ page }) => {
    await page.goto(`/b/${UNCLAIMED}`);
    const local = (await jsonLd(page)).find((b) => b["@type"] === "LocalBusiness");
    expect(local.aggregateRating).toBeUndefined();
    expect(local.openingHours).toBeUndefined();
    expect(local.openingHoursSpecification).toBeUndefined();
    expect(local.telephone).toBeUndefined();
    expect(local.identifier).toBeTruthy();
  });

  test("every storefront page carries a breadcrumb list", async ({ page }) => {
    for (const path of [`/b/${CLAIMED}`, `/b/${CLAIMED}/p/resilient-seated-gate-valve-dn150-0`]) {
      await page.goto(path);
      const crumbs = (await jsonLd(page)).find((b) => b["@type"] === "BreadcrumbList");
      expect(crumbs, path).toBeTruthy();
      expect(crumbs.itemListElement.length).toBeGreaterThan(2);
    }
  });
});

test.describe("maps and masking", () => {
  test("a location without coordinates never reaches the map", async ({ page }) => {
    await page.goto(`/b/${CLAIMED}/branches`);
    const branchCount = await page.getByRole("heading", { level: 2 }).count();

    const pins = await page.$$eval("figure ul.sr-only li", (nodes) => nodes.length);
    const excluded = await page
      .locator("figcaption")
      .allTextContents()
      .then((texts) => texts.join(" "));

    // Either every branch is pinned, or the ones held back are declared.
    if (pins < branchCount) {
      expect(excluded).toMatch(/no map pin/);
    }
    expect(pins).toBeLessThanOrEqual(branchCount);
  });

  test("phone numbers are masked until the reveal is asked for", async ({ page }) => {
    await page.goto(`/b/${CLAIMED}`);
    const body = (await page.textContent("body")) ?? "";
    expect(body).toMatch(/•/);

    /*
     * Matched on behaviour, not on a label. Board 1d puts the masked number
     * itself on the control at desktop width and a "Call" button in the sticky
     * bar below `md`, so a fixed name would test one breakpoint and silently
     * skip the other.
     *
     * Since the `1d` amendment the click asks for three fields first; the whole
     * flow is `storefront-contact-reveal.spec.ts`. What stays here is that the
     * control exists, is masked, and opens the ask rather than a number.
     */
    const reveal = page.getByRole("button", { name: /•|^Call$/ });
    await expect(reveal.first()).toBeEnabled();
    await reveal.first().click();
    await expect(page.getByRole("dialog", { name: "Access phone number in 30 seconds" })).toBeVisible();
    expect(await page.locator("main a[href^='tel:']").count()).toBe(0);
  });

  test("the TRN is masked to first three and last four", async ({ page }) => {
    await page.goto(`/b/${CLAIMED}`);
    const body = (await page.textContent("body")) ?? "";
    expect(body).toMatch(/\d{3} •••• •••• \d{4}/);
  });
});

test.describe("enquiry affordances", () => {
  /*
   * Handoff 1 shipped these present, styled and disabled, and this test held
   * them to it. Handoff 2 step 3 turns them on, so it now holds them to the
   * opposite: the affordance is in the same place and it works.
   */
  test("are live, and open a composer rather than navigating away", async ({ page }) => {
    await page.goto(`/b/${CLAIMED}/p/resilient-seated-gate-valve-dn150-0`);
    const enquire = page.getByRole("button", { name: /Send enquiry|Notify me/ }).first();
    await expect(enquire).toBeVisible();
    await expect(enquire).toBeEnabled();

    await enquire.click();
    // The buyer keeps sight of the product they were looking at.
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText("Al Marwan");
  });

  test("carry the product in as a line, rather than an empty box", async ({ page }) => {
    await page.goto(`/b/${CLAIMED}/p/resilient-seated-gate-valve-dn150-0`);
    await page.getByRole("button", { name: /Send enquiry|Notify me/ }).first().click();
    await expect(page.getByLabel("Item on line 1")).toHaveValue(/gate valve/i);
  });

  test("there are no dead links behind them", async ({ page }) => {
    await page.goto(`/b/${CLAIMED}`);
    const hrefs = await page.$$eval("a[href]", (links) =>
      links.map((l) => l.getAttribute("href")!).filter((h) => h.startsWith("/")),
    );
    // Every internal link on a storefront must resolve, not 404.
    for (const href of [...new Set(hrefs)].filter((h) => h.startsWith("/b/"))) {
      const response = await page.request.get(href);
      expect(response.status(), href).toBeLessThan(400);
    }
  });
});

test.describe("criterion 8 — the storefront palette never reaches a trust signal", () => {
  /**
   * Non-negotiable 2: trust signals render identically on every storefront. The
   * seller themes are gone, so no two storefronts differ in colour — but the
   * claim this protects is narrower and still live: a verification badge and
   * board 1d's verification panel draw nothing from the storefront palette. A
   * badge given `text-brand` would pass every other test on the page.
   *
   * An A/B on one page. Taking the palette's scope off the live DOM changes
   * exactly one thing, so anything that moves moved because of the palette.
   */
  test("the badge and the verification panel are identical inside and outside the palette", async ({
    page,
  }) => {
    await page.goto(`/b/${CLAIMED}`);

    const measure = () =>
      page.evaluate(() => {
        const badge = document.querySelector("[data-verification-badge]") as HTMLElement | null;
        const panel = document.querySelector("[data-verification-panel]") as HTMLElement | null;
        // Something the palette does colour, as the control.
        const heading = document.querySelector("h1") as HTMLElement | null;

        const paint = (el: HTMLElement | null) => {
          if (!el) return null;
          const s = getComputedStyle(el);
          return `${s.color}|${s.backgroundColor}|${s.borderTopColor}`;
        };

        return {
          scoped: document.querySelector("[data-theme]") !== null,
          badge: paint(badge),
          panel: paint(panel),
          heading: paint(heading),
        };
      });

    const inside = await measure();

    expect(inside.scoped, "the storefront carries no palette scope").toBe(true);
    expect(inside.badge, "no verification badge on the page").toBeTruthy();
    expect(inside.panel, "no verification panel on the page").toBeTruthy();

    await page.evaluate(() => {
      document.querySelector("[data-theme]")?.removeAttribute("data-theme");
    });
    const outside = await measure();

    // The palette was live: the heading moved when its scope was removed.
    expect(outside.heading, "the palette changed nothing, so this proves nothing").not.toBe(
      inside.heading,
    );

    // And the two trust signals did not.
    expect(outside.badge, "the storefront palette coloured the verification badge").toBe(inside.badge);
    expect(outside.panel, "the storefront palette coloured the verification panel").toBe(inside.panel);
  });
});
