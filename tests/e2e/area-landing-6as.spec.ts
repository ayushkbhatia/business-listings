import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Board `6a-s` — the services landing page, as a buyer and a crawler get it.
 *
 * Seeded by `prisma/seed-services-landing.mts`: VAT in Business Bay and in
 * Downtown, audit in Business Bay, VAT across Dubai, and Deira written but
 * never published. The fixtures are built around the board's premise — a VAT
 * practice is on the Business Bay page because it COVERS Business Bay, and
 * most of them sit somewhere else.
 *
 * The file name keeps it out of the `services` seller project's pattern: this
 * is a public page, read signed out on a desktop and a phone.
 *
 * `tests/integration/services-landing-6as.test.ts` proves the rules on its own
 * fixtures. This proves the page — including the membership rules, by walking
 * every page of the list rather than trusting the first ten rows.
 */

const BB = "/dubai/business-bay/vat-and-tax";
const DOWNTOWN = "/dubai/downtown-dubai/vat-and-tax";
const BB_AUDIT = "/dubai/business-bay/audit-and-assurance";
const DUBAI = "/dubai/vat-and-tax";
const DEIRA = "/dubai/deira/vat-and-tax";

const LIGHTHOUSE = "svc6as-lighthouse-tax-consultancy";
const STERLING = "svc6as-sterling-fiscal-advisors";
const CANAL = "svc6as-canal-tax-partners";
const GULF_LEDGER = "svc6as-gulf-ledger-advisory";
const QUAYSIDE = "svc6as-quayside-tax-services";
const MARINA = "svc6as-marina-tax-house";
const BAYSIDE = "svc6as-bayside-vat-desk";

const toNumber = (text: string) => Number(text.replace(/[^\d]/g, ""));

async function jsonLd(page: Page) {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  return blocks.map((block) => JSON.parse(block) as Record<string, unknown>);
}

function row(page: Page, slug: string) {
  return page.locator(`[data-landing-firm="${slug}"]`);
}

/** The stated firm count, off the stat line the page leads with. */
async function statedFirms(page: Page, place: string): Promise<number> {
  const line = await page.getByText(new RegExp(`^[\\d,]+ firms? covering ${place}$`)).innerText();
  return toNumber(line);
}

/** Walks the pager until the firm's row is on screen, and returns it. */
async function openRow(page: Page, path: string, slug: string) {
  for (let n = 1; n <= 20; n += 1) {
    const response = await page.goto(n === 1 ? path : `${path}?page=${n}`);
    if (response?.status() !== 200) break;
    if ((await row(page, slug).count()) > 0) return row(page, slug);
  }
  throw new Error(`${slug} is on no page of ${path}`);
}

/** Every firm on the list, by walking the pager to its end. */
async function everyFirm(page: Page, path: string): Promise<string[]> {
  const slugs: string[] = [];
  let next: string | null = path;
  while (next) {
    const response = await page.goto(next);
    expect(response?.status(), next).toBe(200);
    slugs.push(
      ...(await page
        .locator("[data-landing-firm]")
        .evaluateAll((rows) => rows.map((element) => element.getAttribute("data-landing-firm") ?? ""))),
    );
    const onward = page
      .getByRole("navigation", { name: "More firms" })
      .getByRole("link", { name: /^(Show all [\d,]+ firms?|Next)$/ });
    next = (await onward.count()) > 0 ? await onward.getAttribute("href") : null;
  }
  return slugs;
}

test.describe("the page a VAT buyer lands on", () => {
  test("opens with the trade's own noun, the place, and counts that are queries", async ({ page }) => {
    await page.goto(BB);
    // Correction 3: the noun a buyer types, from the trade's record, not "companies".
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("VAT consultants in Business Bay, Dubai");
    await expect(page.locator("h1")).toHaveCount(1);

    const firms = await statedFirms(page, "Business Bay");
    expect(firms).toBeGreaterThan(10);
    await expect(page.getByText(/^[\d,]+ licence-verified · [\d,]+ registered FTA tax agents · median reply .+$/)).toBeVisible();

    // The title, the pager and the stat line state one number.
    await expect(page).toHaveTitle(new RegExp(`^VAT consultants in Business Bay, Dubai — ${firms} firms`));
    await expect(
      page.getByRole("navigation", { name: "More firms" }).getByRole("link", { name: `Show all ${firms} firms` }),
    ).toBeVisible();
  });

  test("lists by coverage: every page of the list adds up to the stated count", async ({ page }) => {
    await page.goto(BB);
    const stated = await statedFirms(page, "Business Bay");
    const listed = await everyFirm(page, BB);

    expect(listed).toHaveLength(stated);
    expect(new Set(listed).size).toBe(listed.length);

    // B1: on the page because it covers the district, from an office in Deira.
    expect(listed).toContain(LIGHTHOUSE);
    // Its VAT service is narrowed to Business Bay itself.
    expect(listed).toContain(CANAL);
    // An office in the district and nothing else — presence counts.
    expect(listed).toContain(QUAYSIDE);
    // A Dubai-wide default, and a VAT service narrowed to Abu Dhabi: the union
    // would list it, the service does not.
    expect(listed).not.toContain(GULF_LEDGER);
    // The unclaimed import ranks last.
    expect(listed.at(-1)).toBe(QUAYSIDE);
  });

  test("leaves out of Downtown the firms that reach only Business Bay", async ({ page }) => {
    await page.goto(DOWNTOWN);
    const stated = await statedFirms(page, "Downtown Dubai");
    const listed = await everyFirm(page, DOWNTOWN);
    expect(listed).toHaveLength(stated);
    expect(listed).toContain(LIGHTHOUSE);
    expect(listed).not.toContain(CANAL);
    expect(listed).not.toContain(QUAYSIDE);
    expect(listed).not.toContain(GULF_LEDGER);
  });

  test("says where a firm sits and that it covers the place, separately", async ({ page }) => {
    await page.goto(BB);
    const lighthouse = row(page, LIGHTHOUSE);
    await expect(lighthouse.getByText("Office in Deira, Dubai")).toBeVisible();
    await expect(lighthouse.getByText("Covers Business Bay")).toBeVisible();
    await expect(lighthouse.getByText("Their services in this trade")).toBeVisible();
    await expect(lighthouse.getByRole("link", { name: "VAT registration and quarterly compliance" })).toBeVisible();
  });
});

test.describe("B4 — a credential is a checked number or nothing", () => {
  test("badges the checked FTA agent number, and names what was checked", async ({ page }) => {
    await page.goto(BB);
    const lighthouse = row(page, LIGHTHOUSE);
    await expect(lighthouse.getByText("FTA registered tax agent 20034512", { exact: true })).toBeVisible();
    // The accessible sentence says where the number was checked.
    await expect(
      lighthouse.getByText("FTA registered tax agent 20034512, checked against the issuing register"),
    ).toHaveCount(1);
  });

  test("gives no badge to a practice with none, or one whose number has lapsed", async ({ page }) => {
    // Sterling has never had a number checked; Marina's was confirmed to a
    // date that passed last month. Neither is a negative finding, and neither
    // renders as a badge.
    for (const slug of [STERLING, MARINA]) {
      const found = await openRow(page, BB, slug);
      await expect(found.getByText(/FTA registered tax agent/)).toHaveCount(0);
    }
  });

  test("shows a lapsed licence at the rung the sweep will write, before the sweep runs", async ({ page }) => {
    const bayside = await openRow(page, BB, BAYSIDE);
    await expect(bayside.getByText("Licence verified")).toHaveCount(0);
  });
});

test.describe("nothing on it is priced or bought", () => {
  for (const route of [BB, DUBAI]) {
    test(`${route} carries no price and no banned verb`, async ({ page }) => {
      await page.goto(route);
      const main = await page.locator("main").innerText();
      expect(main).not.toMatch(/\bAED\b/);
      for (const banned of ["Get a quote", "Get quote", "Add to cart", "Buy now", "Price on request", "Checkout"]) {
        expect(main, banned).not.toContain(banned);
      }
      await expect(page.getByRole("link", { name: "Ask for a quote" }).first()).toBeVisible();
    });
  }

  test("an unclaimed import has no enquiry button", async ({ page }) => {
    const listed = await everyFirm(page, BB);
    expect(listed.at(-1)).toBe(QUAYSIDE);
    // everyFirm ends on the last page, where the unclaimed row sits.
    const quayside = row(page, QUAYSIDE);
    await expect(quayside.getByText("Office in Business Bay, Dubai")).toBeVisible();
    await expect(quayside.getByRole("link", { name: "Ask for a quote" })).toHaveCount(0);
  });
});

test.describe("B3 — one brief to the firms that can take it", () => {
  test("states the matcher's count, capped at eight, and opens the brief for this place", async ({ page }) => {
    await page.goto(BB);
    const card = page.locator("a:visible", { hasText: "Post a requirement" });
    await expect(card).toHaveCount(1);
    await expect(card).toHaveAttribute("href", "/rfq/new?category=vat-and-tax&kind=services&area=business-bay");
    await expect(page.getByRole("heading", { name: "Ask 8 firms that cover Business Bay" }).filter({ visible: true })).toHaveCount(1);
  });

  test("on a phone, the brief comes before the list", async ({ page, isMobile }) => {
    test.skip(!isMobile, "the one-column layout");
    await page.goto(BB);
    const card = page.locator("a:visible", { hasText: "Post a requirement" });
    const first = page.locator("[data-landing-firm]").first();
    const [cardBox, rowBox] = await Promise.all([card.boundingBox(), first.boundingBox()]);
    expect(cardBox!.y).toBeLessThan(rowBox!.y);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("the two ways off the page end in a sent brief", () => {
  /*
     Build phase 5's journeys, from the landing page to `/enquiry/:id`. The
     composer is `1h-s`'s and `rfq-brief.spec.ts` covers its rules; what is
     asserted here is what this page hands it — the trade, the place, the firm,
     and a count that was the matcher's before the buyer clicked.
  */
  async function sendBrief(page: Page, send: Locator) {
    await page
      .getByRole("textbox", { name: "What needs doing?" })
      .fill("Quarterly VAT returns for a trading company registered in 2019, and one voluntary disclosure.");
    await page.getByRole("radio", { name: "One-off job" }).check();
    await page.getByRole("radio", { name: "As soon as possible" }).check();
    await page.getByLabel("Your name").fill("Rania Haddad");
    await page.getByLabel("Your mobile").fill(`05${Date.now().toString().slice(-8)}`);
    await send.click();
    await page.waitForURL(/\/enquiry\/[^/?]+\?.*sent=1/);
  }

  test("a row's Ask for a quote opens a brief to that firm alone, already placed", async ({ page }) => {
    await page.goto(BB);
    await row(page, LIGHTHOUSE).getByRole("link", { name: "Ask for a quote" }).click();
    await page.waitForURL(/\/rfq\/new\?to=svc6as-lighthouse-tax-consultancy/);

    await expect(page.getByText("Only Lighthouse Tax Consultancy sees this brief.")).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Where is the site?" }).locator("option:checked")).toHaveText(
      "Business Bay",
    );
    await sendBrief(page, page.getByRole("button", { name: "Send to Lighthouse Tax Consultancy" }).filter({ visible: true }));
  });

  test("the fan-out opens the brief for this trade and place, and sends to the count it stated", async ({ page }) => {
    await page.goto(BB);
    const heading = page.getByRole("heading", { name: /^Ask \d+ firms? that cover Business Bay$/ }).filter({ visible: true });
    const stated = toNumber(await heading.innerText());
    expect(stated).toBeGreaterThan(0);
    expect(stated).toBeLessThanOrEqual(8);

    await page.locator("a:visible", { hasText: "Post a requirement" }).click();
    await page.waitForURL(/\/rfq\/new\?category=vat-and-tax&kind=services&area=business-bay$/);
    await expect(page.getByRole("combobox", { name: "Where is the site?" }).locator("option:checked")).toHaveText(
      "Business Bay",
    );
    await sendBrief(
      page,
      page.getByRole("button", { name: `Send to ${stated} supplier${stated === 1 ? "" : "s"}` }).filter({ visible: true }),
    );
  });
});

test.describe("B7 and B8 — two link axes, and only live pages on either", () => {
  test("Nearby is the trade elsewhere; Related work is other trades here", async ({ page }) => {
    await page.goto(BB);
    const nearby = page.getByRole("navigation", { name: "Nearby" });
    await expect(nearby.getByRole("link", { name: /^Downtown Dubai/ })).toHaveAttribute("href", DOWNTOWN);
    const related = page.getByRole("navigation", { name: "Related work" });
    await expect(related.getByRole("link", { name: "Auditors in Business Bay" })).toHaveAttribute("href", BB_AUDIT);
  });

  test("every anchor into the class answers 200, and the unpublished page is anchored nowhere", async ({
    page,
    request,
  }) => {
    for (const route of [BB, DOWNTOWN, BB_AUDIT, DUBAI]) {
      await page.goto(route);
      const hrefs = await page.locator("main a").evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
      expect(hrefs.filter((href) => href.includes("/deira/")), route).toEqual([]);
      const landing = [...new Set(hrefs.filter((href) => /^\/dubai\/[a-z0-9-]+(\/[a-z0-9-]+)?$/.test(href)))];
      for (const href of landing) {
        const response = await request.get(href, { maxRedirects: 0 });
        expect(response.status(), `${route} → ${href}`).toBe(200);
      }
    }
    expect((await request.get(DEIRA, { maxRedirects: 0 })).status()).toBe(404);
  });

  test("every link a row carries answers — storefront, coverage, service, brief", async ({ page, request }) => {
    /*
       Build phase 4: the routes this page hands a buyer to are other boards'
       (1d-s, 1f-s, 1g-s, 1h-s), and a row that links to one that is not there
       is a dead end dressed as a result. The first page, and the last, where
       the unclaimed import sits.
    */
    const listed = await everyFirm(page, BB);
    expect(listed.at(-1)).toBe(QUAYSIDE);
    const hrefs = new Set<string>();
    for (const url of [BB, page.url()]) {
      await page.goto(url);
      for (const href of await page
        .locator("[data-landing-firm] a")
        .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""))) {
        hrefs.add(href);
      }
    }
    expect(hrefs.size).toBeGreaterThan(20);
    for (const href of hrefs) {
      const response = await request.get(href, { maxRedirects: 0 });
      expect(response.status(), href).toBe(200);
    }
  });

  test("the sitemap carries the four published pages and not the fifth", async ({ request }) => {
    const xml = await (await request.get("/sitemap.xml")).text();
    for (const route of [BB, DOWNTOWN, BB_AUDIT, DUBAI]) expect(xml, route).toContain(route);
    expect(xml).not.toContain(DEIRA);
  });
});

test.describe("the emirate class, for work", () => {
  test("lists the practices covering Dubai and links the live area pages", async ({ page }) => {
    await page.goto(BB);
    await page.getByRole("link", { name: "Dubai", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`${DUBAI}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("VAT consultants in Dubai");
    await expect(page.getByText(/^[\d,]+ firms? covering Dubai$/)).toBeVisible();

    const areas = page.getByRole("navigation", { name: "Areas in Dubai" });
    await expect(areas.getByRole("link", { name: /^Business Bay/ })).toHaveAttribute("href", BB);
    await expect(areas.getByRole("link", { name: /^Downtown Dubai/ })).toHaveAttribute("href", DOWNTOWN);
  });
});

test.describe("structured data matches the page", () => {
  test("the breadcrumb, the list and the questions", async ({ page }) => {
    await page.goto(BB);
    const blocks = await jsonLd(page);

    const crumbs = blocks.find((block) => block["@type"] === "BreadcrumbList");
    expect((crumbs?.itemListElement as { name: string }[]).map((entry) => entry.name)).toEqual([
      "VAT & tax advisory",
      "Dubai",
      "Business Bay",
    ]);

    const list = blocks.find((block) => block["@type"] === "ItemList");
    expect(list?.numberOfItems).toBe(await page.locator("[data-landing-firm]").count());

    const faq = blocks.find((block) => block["@type"] === "FAQPage");
    const marked = ((faq?.mainEntity ?? []) as { name: string }[]).map((entry) => entry.name);
    const visible = await page.locator('section[aria-labelledby="faq-heading"] h3').allTextContents();
    expect(visible).toEqual(marked);
    expect(marked.length).toBeGreaterThanOrEqual(3);

    expect(await page.locator('meta[name="robots"]').count()).toBe(0);
    expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toContain(BB);
  });

  test("the three questions are the trade's, and render as questions", async ({ page }) => {
    await page.goto(BB);
    const block = page.getByRole("region", { name: "What to ask VAT consultants in Business Bay" });
    await expect(block.getByRole("heading", { level: 3 })).toHaveText([
      "Are you a registered FTA tax agent?",
      "Is the fee per return or a retainer?",
      "Who handles an FTA audit if one comes?",
    ]);
  });
});

test.describe("the address itself", () => {
  test("page 2 is its own canonical, and past the end is not a page", async ({ page }) => {
    await page.goto(BB);
    await page.getByRole("navigation", { name: "More firms" }).getByRole("link", { name: /^Show all/ }).click();
    await expect(page).toHaveURL(new RegExp(`${BB.replace(/[/]/g, "\\/")}\\?page=2$`));
    expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toContain("page=2");
    expect((await page.goto(`${BB}?page=99`))?.status()).toBe(404);
  });
});

test.describe("accessibility", () => {
  for (const route of [BB, DUBAI]) {
    test(`axe is clean on ${route}`, async ({ page }) => {
      await page.goto(route);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
        // docs/contrast.md — the failing pairs are token-level and pinned.
        .disableRules(["color-contrast"])
        .analyze();
      const summary = results.violations.map((v) => ({ id: v.id, nodes: v.nodes.length }));
      expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
    });
  }
});
