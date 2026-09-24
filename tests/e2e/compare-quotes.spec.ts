import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { Client } from "pg";

/**
 * Board `1n` — comparing the quotes received, in a browser.
 *
 * The arithmetic is proven in lib/quote/comparison.test.ts and the services in
 * tests/integration/compare-quotes-1n.test.ts. What is proven here is what
 * neither can see: the table as drawn and corrected at export — every line's
 * winner marked, the card at AED 13,560 across two suppliers, the one
 * incomplete quote flagged — the accept stated before it is offered and landing
 * on `7c`, a company buyer's rows saying *Send for approval* and naming who, the
 * export, the aliases that reach the page, and axe.
 *
 * `ENQ-8864` (prisma/seed-compare-quotes.mts) is read-only here: its Breeze
 * row offers the one nudge and no spec spends it. `ENQ-8865` is accepted once,
 * by the chromium project only.
 */

const TOKEN = "seed-0000-4000-8000-provisional06";
const BOARD = "ENQ-8864";
const ACCEPTABLE = "ENQ-8865";
const compare = (ref: string, query = "") => `/enquiry/${ref}/compare?t=${TOKEN}${query}`;

/** The row whose header cell names this supplier. */
const row = (page: Page, supplier: string) =>
  page.getByRole("table").getByRole("row").filter({ has: page.getByRole("rowheader", { name: new RegExp(`^${supplier}`) }) });

/** Open the accept sheet. Retried: a press before hydration opens nothing. */
async function openAccept(page: Page, name: RegExp) {
  const dialog = page.getByRole("dialog");
  await expect(async () => {
    await page.getByRole("button", { name }).click();
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  return dialog;
}

test.describe("the board as drawn", () => {
  test("states the enquiry, and puts a row per supplier against a column per line", async ({ page }) => {
    await page.goto(compare(BOARD));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Chilled water riser — valves, couplings, gaskets");
    await expect(page.getByText(/^ENQ-8864 · Sent \d{1,2} \w{3} · Closes in 3 days$/i)).toBeVisible();
    await expect(page.getByText("4 quotes received")).toBeVisible();

    const table = page.getByRole("table", { name: /Quotes from 4 suppliers, priced line by line, excluding VAT/ });
    // Supplier, three lines, lead time, total, and the action.
    await expect(table.getByRole("columnheader")).toHaveCount(7);
    // Four quotes and the supplier who opened it and went quiet.
    await expect(table.getByRole("rowheader")).toHaveCount(5);
  });

  test("totals every row from its cells, and flags the one incomplete quote", async ({ page }) => {
    await page.goto(compare(BOARD));
    await expect(row(page, "Rawabi Industrial Supplies")).toContainText("AED 14,880");
    await expect(row(page, "Delta Valve & Fitting Co.")).toContainText("AED 13,320");
    await expect(row(page, "Delta Valve & Fitting Co.")).toContainText("2 of 3 lines");
    await expect(row(page, "Delta Valve & Fitting Co.")).toContainText("Not quoted");
    await expect(row(page, "Northgate Trading")).toContainText("AED 16,960");
    await expect(row(page, "Flowline Pump Trading LLC")).toContainText("AED 16,760");
  });

  test("marks every line's winner, the gasket included, and the card agrees (B1–B3)", async ({ page }) => {
    await page.goto(compare(BOARD));
    await expect(page.getByText("Lowest for this line")).toHaveCount(3);
    await expect(row(page, "Delta Valve & Fitting Co.").getByText("Lowest for this line")).toHaveCount(1);
    await expect(row(page, "Northgate Trading").getByText("Lowest for this line")).toHaveCount(2);
    await expect(row(page, "Rawabi Industrial Supplies").getByText("Lowest for this line")).toHaveCount(0);

    await expect(
      page.getByText(
        "Splitting across Delta Valve & Fitting Co. and Northgate Trading would land at AED 13,560 — AED 1,320 under the best single quote, across 2 deliveries.",
      ),
    ).toBeVisible();
    // Accepting is one supplier: the card points at the threads, not at a basket.
    await expect(page.getByRole("link", { name: "Your thread with Northgate Trading" })).toBeVisible();
  });

  test("offers Accept on every quoted row, the same control on each (B4)", async ({ page }) => {
    await page.goto(compare(BOARD));
    await expect(page.getByRole("button", { name: /^Accept .+'s quote QT-8864-\w+R1, AED [\d,]+$/ })).toHaveCount(4);
  });

  test("keeps the supplier who opened it and went quiet, with the one nudge (B10)", async ({ page }) => {
    await page.goto(compare(BOARD));
    const quiet = row(page, "Breeze Cooling Services");
    // The seed's clock: two days, and however many hours the shard has run since.
    await expect(quiet).toContainText(/Opened the request 2 d( \d+ h)? ago — no quote yet/);
    // Offered, and not pressed: the fixture keeps its nudge.
    await expect(quiet.getByRole("button", { name: "Nudge" })).toBeEnabled();
  });

  test("sorts by total with every complete quote before the incomplete one (B5)", async ({ page }) => {
    await page.goto(compare(BOARD, "&sort=total"));
    await expect(page.getByRole("link", { name: "Total, complete quotes first" })).toHaveAttribute("aria-current", "true");
    const order = await page.getByRole("table").getByRole("rowheader").locator("a").allTextContents();
    expect(order.slice(0, 4)).toEqual([
      "Rawabi Industrial Supplies",
      "Flowline Pump Trading LLC",
      "Northgate Trading",
      "Delta Valve & Fitting Co.",
    ]);
  });

  test("states the accept in full before it is offered, and cancelling accepts nothing", async ({ page }) => {
    await page.goto(compare(BOARD));
    const dialog = await openAccept(page, /^Accept Delta Valve & Fitting Co\.'s quote/);
    await expect(dialog).toContainText("1 line of your requirement is not quoted in this revision.");
    await expect(dialog).toContainText("AED 13,320 excl. VAT, across 2 lines");
    await expect(dialog).toContainText("Your name, mobile and email go to Delta Valve & Fitting Co., and to nobody else.");
    await expect(dialog).toContainText("are told you chose another supplier");
    await dialog.getByRole("button", { name: "Keep comparing" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("4 quotes received")).toBeVisible();
  });

  test("exports the comparison as the buyer's own file", async ({ page }) => {
    await page.goto(compare(BOARD));
    const href = await page.getByRole("link", { name: "Export comparison" }).getAttribute("href");
    const response = await page.request.get(href!);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/csv");
    expect(response.headers()["cache-control"]).toContain("no-store");
    const text = await response.text();
    expect(text).toContain("All amounts in AED, excluding VAT.");
    expect(text).toContain("14880.00");
    expect(text).toMatch(/Lowest per line,,,,Delta Valve & Fitting Co\.,Northgate Trading,Northgate Trading/);
  });

  test("is reached from the handoff's addresses, RFQ- and ENQ- alike", async ({ page }) => {
    await page.goto(`/account/rfq/RFQ-8864?t=${TOKEN}`);
    await expect(page).toHaveURL(new RegExp(`/enquiry/ENQ-8864/compare\\?t=${TOKEN}$`));
    await page.goto(`/account/enquiries/${BOARD}/compare?t=${TOKEN}`);
    await expect(page).toHaveURL(new RegExp(`/enquiry/${BOARD}/compare\\?t=${TOKEN}$`));
  });

  test("sends a visitor with neither a session nor a token to sign in, and back", async ({ page }) => {
    await page.goto(`/enquiry/${BOARD}/compare`);
    await expect(page).toHaveURL(new RegExp(`/signin\\?next=${encodeURIComponent(`/enquiry/${BOARD}/compare`)}$`));
  });

  test("does not scroll sideways on a phone — the table scrolls inside its frame", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "A phone-width check.");
    await page.goto(compare(BOARD));
    /*
       The layout viewport first. A phone widens it to fit anything that
       overflows — `sr-only` marks escaping the table's frame did exactly that —
       and then `scrollWidth - innerWidth` is zero on a page that scrolls
       sideways. The viewport staying at the device's width is the real check.
    */
    expect(await page.evaluate(() => window.innerWidth)).toBe(page.viewportSize()!.width);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const frame = page.getByRole("group", { name: "Quotes, line by line" });
    expect(await frame.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  });

  test("is axe clean", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "Run once, at the shard's width.");
    await page.goto(compare(BOARD));
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .disableRules(["color-contrast"])
      .analyze();
    const summary = results.violations.map((v) => `${v.id}: ${v.help}`);
    expect(summary, summary.join("\n")).toEqual([]);
  });
});

test.describe("accepting from the comparison", () => {
  test("lands on the accepted record, and the comparison becomes the record of the rest", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "Accepts the fixture; runs once per database.");
    await page.goto(compare(ACCEPTABLE));
    // A retry after a first attempt that accepted finds the record already made.
    if ((await page.getByText(/^You accepted /).count()) === 0) {
      const dialog = await openAccept(page, /^Accept Northgate Trading's quote/);
      await dialog.getByRole("button", { name: "Accept r1" }).click();
      await expect(page).toHaveURL(/\/accepted/);
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Northgate Trading");
      await page.goto(compare(ACCEPTABLE));
    }

    await expect(page.getByText(/^You accepted Northgate Trading's quote on /)).toBeVisible();
    await expect(row(page, "Northgate Trading")).toContainText("Accepted");
    await expect(row(page, "Rawabi Industrial Supplies")).toContainText("Declined");
    await expect(page.getByRole("button", { name: /^Accept / })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Message all" })).toHaveCount(0);
  });
});

/* ── A company buyer ──────────────────────────────────────────────────────── */

const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
const secret = process.env["SUPABASE_SECRET_KEY"];
const PASSWORD = "dhow wharf at deira creek";

async function db<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env["DATABASE_URL"]! });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

test.describe("a company buyer (B7)", () => {
  let admin: SupabaseClient;
  const authUsers: string[] = [];
  const people: string[] = [];
  const companies: string[] = [];

  test.skip(!url || !secret, "Needs a Supabase service key to make an account.");

  test.beforeAll(() => {
    admin = createClient(url!, secret!, { auth: { autoRefreshToken: false, persistSession: false } });
  });

  test.afterAll(async () => {
    await db(async (client) => {
      await client.query("BEGIN");
      await client.query(`SELECT set_config('app.buyer_company_maintenance', 'on', true)`);
      if (companies.length) await client.query(`DELETE FROM buyer_company_event WHERE company_id = ANY($1::text[])`, [companies]);
      await client.query("COMMIT");
      if (people.length) await client.query(`DELETE FROM enquiry WHERE buyer_id = ANY($1::uuid[])`, [people]);
      if (companies.length) await client.query(`DELETE FROM buyer_company WHERE id = ANY($1::text[])`, [companies]);
      if (people.length) {
        await client.query(`DELETE FROM auth_attempt WHERE identifier IN (SELECT email FROM "user" WHERE id = ANY($1::uuid[]))`, [people]);
        await client.query(`DELETE FROM "user" WHERE id = ANY($1::uuid[])`, [people]);
      }
    });
    for (const id of authUsers) await admin.auth.admin.deleteUser(id).catch(() => undefined);
  });

  async function person(info: TestInfo, name: string) {
    const tag = `${info.project.name}-${info.workerIndex}-${Date.now().toString(36)}`;
    const email = `bl.e2e.1n+${tag}-${randomBytes(2).toString("hex")}@gmail.com`;
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, password: PASSWORD });
    if (error || !data.user) throw error ?? new Error("no user");
    authUsers.push(data.user.id);
    people.push(data.user.id);
    await db((client) =>
      client.query(`INSERT INTO "user" (id, email, full_name, roles, updated_at) VALUES ($1, $2, $3, '{buyer}', now())`, [
        data.user!.id,
        email,
        name,
      ]),
    );
    return { id: data.user.id, email };
  }

  test("every row over her limit says Send for approval, names who approves, and leads to the rule", async ({ page }, info) => {
    const rami = await person(info, "Rami Haddad");
    const priya = await person(info, "Priya Menon");
    const companyId = `e2e1n${randomBytes(9).toString("hex")}`;
    companies.push(companyId);
    const ref = `ENQ-1N${Date.now().toString(36).toUpperCase()}${info.workerIndex}`;

    await db(async (client) => {
      await client.query(`INSERT INTO buyer_company (id, name, approval_threshold_aed, updated_at) VALUES ($1, $2, 25000, now())`, [
        companyId,
        `Marina Facilities ${randomBytes(2).toString("hex")}`,
      ]);
      await client.query(`INSERT INTO buyer_company_member (id, company_id, user_id, role) VALUES ($1, $2, $3, 'company_admin')`, [
        `e2e1n${randomBytes(9).toString("hex")}`,
        companyId,
        rami.id,
      ]);
      await client.query(`UPDATE buyer_company SET approver_id = $2 WHERE id = $1`, [companyId, rami.id]);
      // A monthly limit of AED 10,000: every quote on the board is beyond it.
      await client.query(
        `INSERT INTO buyer_company_member (id, company_id, user_id, role, monthly_limit_aed) VALUES ($1, $2, $3, 'procurement', 10000)`,
        [`e2e1n${randomBytes(9).toString("hex")}`, companyId, priya.id],
      );

      const enquiryId = `e2e1n${randomBytes(9).toString("hex")}`;
      await client.query(
        `INSERT INTO enquiry (id, ref, buyer_id, buyer_company_id, requirement, closes_at, created_at, emirate)
         VALUES ($1, $2, $3, $4, 'Grooved couplings for the riser replacement.', now() + interval '3 days', now() - interval '1 day', 'dubai')`,
        [enquiryId, ref, priya.id, companyId],
      );
      const lineId = `e2e1n${randomBytes(9).toString("hex")}`;
      await client.query(
        `INSERT INTO enquiry_line (id, enquiry_id, description, qty, unit, sort_order) VALUES ($1, $2, 'Rigid grooved coupling DN100', 120, 'pcs', 0)`,
        [lineId, enquiryId],
      );
      const { rows: suppliers } = await client.query<{ id: string }>(
        `SELECT id FROM business WHERE slug IN ('rawabi-industrial-supplies-1n', 'northgate-trading-1n') ORDER BY slug`,
      );
      for (const [index, supplier] of suppliers.entries()) {
        await client.query(
          `INSERT INTO enquiry_recipient (enquiry_id, business_id, state, first_reply_at, created_at) VALUES ($1, $2, 'quoted', now() - interval '20 hours', now() - interval '1 day')`,
          [enquiryId, supplier.id],
        );
        const quoteId = randomUUID();
        await client.query(
          `INSERT INTO quote (id, ref, enquiry_id, business_id, status, sent_at, expires_at, updated_at)
           VALUES ($1, $2, $3, $4, 'sent', now() - interval '20 hours', now() + interval '10 days', now())`,
          [quoteId, `${ref}-Q${index}`, enquiryId, supplier.id],
        );
        await client.query(
          `INSERT INTO quote_line (id, quote_id, enquiry_line_id, description, qty, unit_price, sort_order) VALUES ($1, $2, $3, 'Coupling', 120, $4, 0)`,
          [randomUUID(), quoteId, lineId, index === 0 ? "96.00" : "102.00"],
        );
      }
    });

    await page.goto(`/signin?next=${encodeURIComponent(`/enquiry/${ref}/compare`)}`);
    await page.getByLabel("Mobile or email").fill(priya.email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/enquiry/${ref}/compare$`));

    // B12: the signed-in shell — the account menu, and My enquiries as the tab.
    // The tab carries its count; the footer's link of the same name does not.
    await expect(page.getByRole("link", { name: /^My enquiries \d+$/ })).toHaveAttribute("aria-current", "page");

    const approvals = page.getByRole("link", { name: /'s quote .+, for approval$/ });
    await expect(approvals).toHaveCount(2);
    await expect(page.getByText("Goes to Rami Haddad first").first()).toBeVisible();
    await expect(page.getByText(/goes to Rami Haddad first, and nothing is released or declined until it is approved/)).toBeVisible();

    await approvals.first().click();
    await expect(page).toHaveURL(new RegExp(`/enquiry/.+/accept/`));
    await expect(page.getByText(/This goes to Rami Haddad for approval/)).toBeVisible();
  });
});
