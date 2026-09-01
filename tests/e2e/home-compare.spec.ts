import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/** Handoff 1, step 5. Home and the comparison tray. */

const A = "al-marwan-industrial-supplies-llc";
const B = "al-manara-equipment-trading-llc";

test.describe("home", () => {
  test("says the number rather than describing it", async ({ page }) => {
    await page.goto("/");
    const body = (await page.textContent("body")) ?? "";
    // Voice rule: "218 suppliers in Al Quoz", never "many suppliers".
    expect(body).not.toMatch(/\b(many|lots of|hundreds of|thousands of) (suppliers|businesses)\b/i);
    expect(body).toMatch(/[\d,]+ licensed businesses across \d+ sectors/);
  });

  test("search works as a plain GET form, before any JavaScript", async ({ page }) => {
    await page.goto("/");
    /*
       Two on the home page now, and that is the fix rather than a regression:
       the hero's, which has always worked, and the header's, which for a long
       time was a bare input in no form and did nothing on all ~30 public
       pages. Both are real GET forms with a `q`.
    */
    const form = page.locator('form[action="/search"][method="get"]');
    await expect(form).toHaveCount(2);
    await expect(form.locator('input[name="q"]')).toHaveCount(2);
  });

  test("the header search submits from a page that is not the home page", async ({ page }) => {
    // The half that was broken. The hero form only exists on `/`.
    await page.goto("/c/valves-and-fittings");
    const header = page.locator('form[action="/search"][method="get"]');
    await expect(header).toHaveCount(1);

    await header.locator('input[name="q"]').fill("gate valve");
    await header.locator('input[name="q"]').press("Enter");
    await expect(page).toHaveURL(/\/search\?.*q=gate\+valve/);
  });

  test("carries every home category through to a real category page", async ({ page }) => {
    await page.goto("/");
    const hrefs = await page.$$eval('a[href^="/c/"]', (links) =>
      [...new Set(links.map((l) => l.getAttribute("href")!))],
    );
    expect(hrefs.length).toBeGreaterThan(3);
    for (const href of hrefs) {
      const response = await page.request.get(href);
      expect(response.status(), href).toBe(200);
    }
  });

  test("renders no product price", async ({ page }) => {
    await page.goto("/");

    /*
       The rule is that `Product` has no price and no public surface renders
       one. It is not "the string AED never appears": the supplier band shows
       what a *subscription* costs, read from the `Plan` table, and board 1a
       draws those three tiles. Asserting on the whole body conflated the two
       and would have failed the moment the band shipped.

       So: every product card says what goes where a price would, and no money
       appears outside the one band that is allowed it.
    */
    const cards = page.locator("article").filter({ hasText: "Price on enquiry" });
    if ((await cards.count()) > 0) {
      for (const card of await cards.all()) {
        expect((await card.textContent()) ?? "").not.toMatch(/AED\s*[\d,]/);
      }
    }

    const money = await page.$$eval("body *", (nodes) =>
      nodes
        .filter((node) => node.children.length === 0 && /AED\s*[\d,]/.test(node.textContent ?? ""))
        .map((node) => (node.closest("section a[href='/onboarding/claim']") ? "plan" : "leak")),
    );
    expect(money.filter((where) => where === "leak")).toEqual([]);
  });

  test("shows the plan prices the Plan table holds, not a number of its own", async ({ page }) => {
    // Criterion 6. The band must not drift from /pricing, and the only way
    // that holds is if it carries no constant. The seed's rows are 0/349/899;
    // the mock was drawn with 99/299 and the table wins.
    await page.goto("/");
    const band = page.getByRole("link", { name: /Your storefront, live this afternoon/ });
    await expect(band).toContainText("AED 0");
    await expect(band).toContainText("AED 349");
    await expect(band).toContainText("AED 899");
  });

  test("the open-requests panel names no buyer, and no area below an emirate", async ({ page }) => {
    /*
       Board 1a calls this "the most sensitive thing on the page". The rows are
       written by buyers who have no idea they will be published, on the most
       crawled surface the platform has.

       The unit tests cover the detector and the integration tests cover the
       query's shape. What is left for a browser is the thing neither can see:
       what actually reached the HTML.
    */
    await page.goto("/");
    const panel = page.getByRole("region", { name: /Open requests|Why suppliers/ });
    await expect(panel).toBeVisible();
    const text = (await panel.textContent()) ?? "";

    expect(text, "a phone number").not.toMatch(/(?:\+|00)?\d[\d\s().-]{7,}/);
    expect(text, "an email").not.toMatch(/[^\s@]+@[^\s@]+\.[a-z]{2,}/i);
    expect(text, "a company form").not.toMatch(/\b(?:L\.?L\.?C|F\.?Z\.?E|FZCO|W\.?L\.?L)\b/i);

    /*
       The place rule bites on the meta line, not on the buyer's prose.

       `deliverToArea` is free text and may be an address, so the panel resolves
       it to an emirate and never echoes it — that is what "no granularity finer
       than an emirate" constrains. The requirement itself is shown as written,
       which the board is explicit about: its own specimen row reads "Sea
       freight, 2× 40HQ Jebel Ali → Dammam". A buyer naming a district in their
       own sentence is describing the job, and censoring it would leave a
       requirement no supplier could quote against.
    */
    const metas = await page.locator("section[aria-label] li p:last-child").allTextContents();
    expect(metas.length).toBeGreaterThan(0);
    for (const meta of metas) {
      for (const area of ["Al Quoz", "Mussafah", "Deira", "Jebel Ali", "KIZAD", "ICAD"]) {
        expect(meta, area).not.toContain(area);
      }
      // Category · place · N quotes · age. Four fields, and place is one of
      // the seven emirates or "UAE".
      const place = meta.split("·")[1]?.trim() ?? "";
      expect(
        [
          "Dubai",
          "Abu Dhabi",
          "Sharjah",
          "Ajman",
          "Ras Al Khaimah",
          "Fujairah",
          "Umm Al Quwain",
          "UAE",
        ],
        meta,
      ).toContain(place);
    }
  });

  test("every count on the page is a number, not an adjective", async ({ page }) => {
    await page.goto("/");
    // Criterion 1, from the outside: the sector grid and the emirate row both
    // carry live counts, and a missing query renders an empty chip rather than
    // a wrong one.
    const sectors = page.locator("ul li a[href^='/c/']");
    expect(await sectors.count()).toBeGreaterThan(0);
    for (const card of await sectors.all()) {
      expect((await card.textContent()) ?? "", "a sector card with no count").toMatch(/\d/);
    }

    const emirates = page.locator("a[href^='/search?emirate=']");
    // All seven, including the ones at zero — a country does not lose an
    // emirate because nobody has signed up there yet.
    expect(await emirates.count()).toBe(7);
  });

  test("the hero search is a GET form that works with JavaScript disabled", async ({ browser }) => {
    // The buyer this page is for is on a warehouse floor with one bar. The
    // search bar ships no client JavaScript and this is the assertion that
    // keeps it that way.
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/");

    const hero = page.locator("form[action='/search']").last();
    await hero.locator("input[name='q']").fill("gate valve");
    await hero.locator("select[name='emirate']").selectOption("dubai");
    await hero.getByRole("button", { name: "Search" }).click();

    await expect(page).toHaveURL(/\/search\?.*q=gate\+valve.*emirate=dubai/);
    await context.close();
  });

  test("has no dead links anywhere in the chrome", async ({ page }) => {
    await page.goto("/");
    const hrefs = await page.$$eval("a[href^='/']", (links) =>
      [...new Set(links.map((l) => l.getAttribute("href")!))],
    );
    for (const href of hrefs) {
      const response = await page.request.get(href);
      expect(response.status(), href).toBeLessThan(400);
    }
  });

  test("names unbuilt routes without linking to them", async ({ page }) => {
    await page.goto("/");
    // docs/routes.md says a later route is named so the nav is shaped right.
    // Named, not linked — a dead link is worse than an honest greyed one.
    //
    // The footer names its four on every width. The nav's own three live in a
    // `hidden lg:flex` list, so below 1024 they are not shown at all — which is
    // the design, not a regression. Asserting visibility on both projects made
    // this test fail on mobile for doing exactly what it should.
    // "Guides" left this list in handoff 5 step 1 — it is a built route now,
    // and the assertion below is that a `later` one is never a link.
    //
    // The footer's four left it here, for the same reason: the policy pages
    // have been live since handoff 5 and the footer was still greying them
    // out, so nothing on the site linked to the terms. `Pricing` is the only
    // genuinely unbuilt route left.
    const footer: string[] = [];
    const nav = ["Pricing"];
    const width = page.viewportSize()?.width ?? 0;
    const shown = width >= 1024 ? [...footer, ...nav] : footer;

    for (const label of shown) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    // Never a link, at any width — that part does not depend on the viewport.
    for (const label of [...footer, ...nav]) {
      await expect(page.getByRole("link", { name: label, exact: true })).toHaveCount(0);
    }
  });

  test("the footer links to all four policies, and they are reachable by clicking", async ({
    page,
  }) => {
    /*
       The other half of the test above, and the one that was missing while the
       footer rendered four greyed spans. campaign.spec.ts asserts these four
       paths resolve, but it fetches them directly — it would have gone on
       passing however unreachable they were.
    */
    const policies = [
      ["Terms", "/terms"],
      ["Privacy", "/privacy"],
      ["How we verify", "/verification-policy"],
      ["Review policy", "/review-policy"],
    ] as const;

    for (const [label, href] of policies) {
      await page.goto("/");
      const link = page.getByRole("link", { name: label, exact: true });
      await expect(link, label).toHaveCount(1);
      await link.click();
      await expect(page).toHaveURL(new RegExp(`${href}$`));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
  });
});

test.describe("compare", () => {
  test("is a real feature, and the enquire-all action reaches the fan-out", async ({ page }) => {
    await page.goto(`/compare?p=${A},${B}`);
    const table = page.getByRole("table", { name: /compared side by side/ });
    await expect(table).toBeVisible();

    // Board 10d's "Enquire with all 4", live from handoff 2 step 3. Every
    // compared supplier is pinned so the fan-out keeps them.
    const enquire = page.getByRole("link", { name: /Send one enquiry/ });
    await expect(enquire).toBeVisible();
    await expect(enquire).toHaveAttribute("href", new RegExp(`/rfq/new\\?to=.*${A}`));
  });

  test("is real table markup, transposed", async ({ page }) => {
    await page.goto(`/compare?p=${A},${B}`);
    const table = page.locator("table").first();
    // Suppliers are columns, attributes are rows — so both scopes are used.
    expect(await table.locator('th[scope="col"]').count()).toBe(3);
    expect(await table.locator('th[scope="row"]').count()).toBeGreaterThan(6);
    await expect(table.locator("caption")).toHaveCount(1);
  });

  test("compares no prices, because none exist", async ({ page }) => {
    await page.goto(`/compare?p=${A},${B}`);
    const body = (await page.textContent("body")) ?? "";
    expect(body).not.toMatch(/AED\s*[\d,]/);
    expect(body).toMatch(/quotes you privately/);
  });

  test("removing a supplier keeps the rest", async ({ page }) => {
    await page.goto(`/compare?p=${A},${B}`);
    await page.getByLabel(/Remove Al Marwan.*from the comparison/).click();
    await expect(page).toHaveURL(new RegExp(`p=${B}`));
    await expect(page.getByRole("link", { name: "Al Marwan Industrial Supplies" })).toHaveCount(0);
  });

  test("caps the tray rather than rendering an unreadable table", async ({ page }) => {
    await page.goto(`/compare?p=a,b,c,d,e,f`);
    // Six requested, at most four columns plus the attribute head.
    const cols = await page.locator('th[scope="col"]').count();
    expect(cols).toBeLessThanOrEqual(5);
  });

  test("has a designed empty state", async ({ page }) => {
    await page.goto("/compare");
    await expect(page.getByRole("heading", { name: "Nothing to compare yet" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Browse the directory" })).toBeVisible();
  });
});

test.describe("the tray accumulates in the URL", () => {
  test("adding from results keeps the buyer on the results page", async ({ page }) => {
    await page.goto("/c/valves-and-fittings");
    await page.getByRole("link", { name: "Compare", exact: true }).first().click();
    await expect(page).toHaveURL(/compare=/);
    await expect(page).toHaveURL(/\/c\/valves-and-fittings/);
    await expect(page.getByText(/supplier selected/)).toBeVisible();
  });

  test("adding a second supplier preserves the first and every facet", async ({ page }) => {
    await page.goto("/c/valves-and-fittings?tier=2");
    await page.getByRole("link", { name: "Compare", exact: true }).first().click();
    await page.getByRole("link", { name: "Compare", exact: true }).first().click();
    await expect(page.getByText(/2 suppliers selected/)).toBeVisible();
    await expect(page).toHaveURL(/tier=2/);
  });

  test("the tray opens the comparison", async ({ page }) => {
    await page.goto(`/c/valves-and-fittings?compare=${A}`);
    await page.getByRole("link", { name: "Compare them" }).click();
    await expect(page).toHaveURL(/\/compare\?p=/);
    await expect(page.getByRole("table")).toBeVisible();
  });
});

test.describe("axe", () => {
  for (const route of ["/", `/compare?p=${A},${B}`, "/compare"]) {
    test(`is clean on ${route}`, async ({ page }) => {
      await page.goto(route);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
        .disableRules(["color-contrast"])
        .analyze();
      const summary = results.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.length,
        first: v.nodes[0]?.html?.slice(0, 130),
      }));
      expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
    });
  }
});
