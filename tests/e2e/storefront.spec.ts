import { expect, test } from "@playwright/test";

/**
 * Handoff 1, step 3. The storefront and product routes, against the seeded
 * database.
 *
 * Slugs are hardcoded because the seed is deterministic — a fixed PRNG and a
 * fixed NOW. If the seed changes these fail loudly, which is the correct
 * outcome: the fixtures below encode the states the checkpoint asks for.
 */
const CLAIMED = "al-marwan-industrial-supplies-llc"; // tier 3, themed, 3 branches
const REVIEWED = "al-manara-equipment-trading-llc"; // the one business with a review
const UNCLAIMED = "al-wadi-technical-services-llc"; // licence import, unpinned branch

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

  test("renders its sections from its sector's template, with the licence panel outside it", async ({
    page,
  }) => {
    /*
     * The visible half of criterion 2. These sections come from
     * `StorefrontTemplate`, resolved per sector, rather than from a fixed
     * sequence of JSX in the route.
     *
     * The details panel and the verification panel are asserted in the same
     * test on purpose: they are chrome, not sections, because non-negotiable 2
     * says trust signals render identically on every storefront — so a template
     * must not be able to reorder them or switch them off. A test that only
     * checked the sections would not notice a rewrite quietly dropping them.
     *
     * This caught exactly that when board 1d rebuilt the rail: the licence, the
     * authority and the masked TRN had moved to the left column and the ladder
     * had become the "what we checked" panel, and the test failed until both
     * were accounted for rather than lost.
     */
    await page.goto(`/b/${CLAIMED}`);

    // From the template.
    await expect(page.getByRole("heading", { name: "Catalogue", exact: true })).toBeVisible();

    // Chrome, whatever the template says.
    await expect(page.getByRole("heading", { name: "What we checked" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Business details" })).toBeVisible();
    await expect(page.getByText("Trade licence", { exact: true })).toBeVisible();
  });

  test("serves the template's pages, and links them in the storefront nav", async ({ page }) => {
    /*
     * Board 5d, from the buyer's side. A page is authored once for the trade
     * and appears on every storefront in it — the route that makes the editor
     * worth having.
     */
    await page.goto(`/b/${CLAIMED}`);
    const about = page.getByRole("link", { name: "About us" });
    await expect(about).toBeVisible();

    await about.click();
    // An h2: the storefront header owns the h1, and it is the business name.
    await expect(page.getByRole("heading", { level: 2, name: "About us" })).toBeVisible();
    await expect(page.getByText(/Counter sales and site delivery/)).toBeVisible();
  });

  test("a page carries no price, like every other public surface", async ({ page }) => {
    await page.goto(`/b/${CLAIMED}/about`);
    const body = await page.locator("article").innerText();
    expect(body).not.toMatch(/AED\s*[\d,]/);
  });

  test("an unclaimed business renders the 10g composition from the same route", async ({ page }) => {
    await page.goto(`/b/${UNCLAIMED}`);
    await expect(page.getByText("This listing has not been claimed")).toBeVisible();
    // No tabs, no catalogue, no verification panel — the unclaimed composition
    // states what is unverified rather than listing checks nobody ran.
    await expect(page.getByRole("heading", { name: "What we checked" })).toHaveCount(0);
  });

  test("its two calls to action go somewhere", async ({ page }) => {
    /*
       Both were `<button disabled>` under the tooltip "Enquiries open in the
       next release" — stale, and wrong twice: this page has no enquiry action
       by design, and the claim flow shipped long ago. This test asserted the
       buttons existed, which is how a dead control on roughly 30,000 pages
       stayed green.

       Links, not buttons: they navigate, so a middle click opens a tab and a
       screen reader announces them as links.
    */
    await page.goto(`/b/${UNCLAIMED}`);

    const claim = page.getByRole("link", { name: "Claim this listing" }).first();
    await expect(claim).toBeVisible();
    await expect(claim).toBeEnabled();
    // Pre-filled, so the claimant does not retype the name they just read.
    // `2a` already reads `?q=` and names this as one of its four entry points.
    await expect(claim).toHaveAttribute("href", /\/onboarding\/claim\?q=./);
    // Roughly 30,000 of these pages, each a distinct `?q=` into a noindex
    // funnel step. That is the shape lib/seo/crawl-policy.ts exists to stop.
    await expect(claim).toHaveAttribute("rel", /nofollow/);

    const report = page.getByRole("link", { name: "Report this listing" }).first();
    await expect(report).toBeVisible();
    // Where its two siblings go — the footer's "Report a listing" and the
    // storefront rail's "Report an issue". Board 13c replaces all three.
    await expect(report).toHaveAttribute("href", "/verification-policy");

    await claim.click();
    await expect(page).toHaveURL(/\/onboarding\/claim\?q=/);
  });

  test("an unclaimed listing invents nothing", async ({ page }) => {
    await page.goto(`/b/${UNCLAIMED}`);
    const body = (await page.textContent("body")) ?? "";

    // No hours for a business that never told us any.
    expect(body).not.toContain("Sunday");

    // No reviews section and no rating for the subject. The word "review" does
    // appear on the page — in the footer policy link, and on the cards for the
    // claimed suppliers we point at, both of which are correct. Scoping to the
    // subject is what the rule actually says.
    await expect(page.getByRole("heading", { name: /^Reviews$/ })).toHaveCount(0);
    await expect(page.locator("[data-rating], .star, [aria-label*=star i]")).toHaveCount(0);

    // Absent fields are marked absent, not dropped.
    expect(await page.getByText("Not provided").count()).toBeGreaterThan(3);
  });

  test("an unclaimed listing offers a way out", async ({ page }) => {
    await page.goto(`/b/${UNCLAIMED}`);
    const others = await page.$$eval(`a[href^="/b/"]`, (links, self) =>
      [...new Set(links.map((l) => l.getAttribute("href")))].filter(
        (h) => h && !h.includes(self),
      ),
      UNCLAIMED,
    );
    expect(others.length).toBeGreaterThanOrEqual(2);
    // And the heading says which basis the list is on, rather than claiming
    // "same trade" over a list from a different one.
    await expect(page.getByRole("heading", { name: /Verified suppliers/ })).toBeVisible();
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
     * Live from handoff 2 step 3. Masking is not a growth trick — the reveal is
     * the event that proves the directory delivered the seller something, and
     * it is what their subscription is ultimately judged on. So it is a real
     * control now, and asking for it is recorded.
     */
    /*
     * Board 1d moved this into the identity block, where the control *is* the
     * masked number rather than a button beside it. The behaviour is unchanged
     * and is the part worth testing: it renders masked, a click reveals it, and
     * the reveal is recorded.
     */
    /*
     * Matched on behaviour, not on a label. Board 1d puts the masked number
     * itself on the control at desktop width and a "Call" button in the sticky
     * bar below `md`, so a fixed name would test one breakpoint and silently
     * skip the other.
     */
    const reveal = page.getByRole("button", { name: /•|^Call$/ });
    await expect(reveal.first()).toBeEnabled();
    await reveal.first().click();
    expect(await page.textContent("body")).toMatch(/\+971|^0\d/m);
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

test.describe("criterion 8 — a seller theme never reaches a trust signal", () => {
  /**
   * The gallery already proves the badge is theme-invariant across six themes,
   * on synthetic scopes. This is the same claim on a real storefront, and it
   * covers what the gallery cannot: board 1d's verification panel, which did
   * not exist when that test was written.
   *
   * An A/B on one page rather than a comparison between two businesses. Two
   * suppliers differ in tier, in dates and in how much they have filled in, and
   * a diff between them would be measuring those. Removing `data-theme` from
   * the live DOM changes exactly one thing, so anything that moves moved
   * because of the theme.
   */
  test("the badge and the verification panel are identical themed and unthemed", async ({
    page,
  }) => {
    await page.goto(`/b/${CLAIMED}`);

    const measure = () =>
      page.evaluate(() => {
        const scope = document.querySelector("[data-theme]") as HTMLElement | null;
        const badge = document.querySelector("[data-verification-badge]") as HTMLElement | null;
        const panel = document.querySelector("[data-verification-panel]") as HTMLElement | null;
        // Something the theme is supposed to recolour, as the control.
        const heading = document.querySelector("h1") as HTMLElement | null;

        const paint = (el: HTMLElement | null) => {
          if (!el) return null;
          const s = getComputedStyle(el);
          return `${s.color}|${s.backgroundColor}|${s.borderTopColor}`;
        };

        return {
          theme: scope?.getAttribute("data-theme") ?? null,
          badge: paint(badge),
          panel: paint(panel),
          heading: paint(heading),
        };
      });

    const themed = await measure();

    // The fixture has to actually carry a theme, or this test proves nothing.
    expect(themed.theme, "the fixture storefront is not themed").toBeTruthy();
    expect(themed.theme).not.toBe("default");
    expect(themed.badge, "no verification badge on the page").toBeTruthy();
    expect(themed.panel, "no verification panel on the page").toBeTruthy();

    await page.evaluate(() => {
      document.querySelector("[data-theme]")?.setAttribute("data-theme", "default");
    });
    const plain = await measure();

    // The theme was live: the heading moved when it was removed.
    expect(plain.heading, "the theme changed nothing, so this proves nothing").not.toBe(
      themed.heading,
    );

    // And the two trust signals did not.
    expect(plain.badge, "a seller theme recoloured the verification badge").toBe(themed.badge);
    expect(plain.panel, "a seller theme recoloured the verification panel").toBe(themed.panel);
  });
});
