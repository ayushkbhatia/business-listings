import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { Client } from "pg";

/**
 * Board `7b`, clicked — the buying company's account.
 *
 *   - a buyer sets up the company, and a TRN one digit short is refused
 *     without wiping what they typed;
 *   - the rule card is rendered from its settings, and says who cannot be
 *     covered (`B2`, `B3`);
 *   - a colleague's request, held by her monthly limit, is approved from the
 *     rail, and approving accepts the quote (`B1`, `B5`);
 *   - the page is axe-clean, and a signed-out visitor is sent to sign in and
 *     brought back.
 *
 * Named `buyer-company` rather than `company-account` on purpose:
 * `playwright.config.ts` sends every `*account*.spec.ts` to the seller project.
 *
 * Each test makes its own buyer and company, named for the project and
 * worker, so desktop and mobile never share a row. Colleagues, enquiries and
 * quotes are written straight into Postgres — the approval queue is what is
 * already there when the approver arrives — and the suppliers are claimed
 * listings with no seat, so no seller's lead counts move. Talks to Postgres
 * through `pg`, as `auth.setup.ts` does.
 */

const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
const secret = process.env["SUPABASE_SECRET_KEY"];
const PASSWORD = "dhow wharf at deira creek";
const DAY = 86_400_000;

test.skip(!url || !secret, "Needs a Supabase service key to make an account.");

let admin: SupabaseClient;
const authUsers: string[] = [];
const people: string[] = [];
const companies: string[] = [];

async function db<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env["DATABASE_URL"]! });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

test.beforeAll(() => {
  admin = createClient(url!, secret!, { auth: { autoRefreshToken: false, persistSession: false } });
});

test.afterAll(async () => {
  await db(async (client) => {
    await client.query("BEGIN");
    // The company's history is append-only; test cleanup is the one sanctioned exception.
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

const cuid = () => `e2e7b${randomBytes(9).toString("hex")}`;

/** A buyer who can sign in with a password, and nothing else yet. */
async function buyer(info: TestInfo, name: string): Promise<{ id: string; email: string }> {
  const tag = `${info.project.name}-${info.workerIndex}-${Date.now().toString(36)}`;
  const email = `bl.e2e.7b+${tag}@gmail.com`;
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

/** A company with this person as its admin, written through the membership so the trigger writes the mirror. */
async function companyOf(adminId: string, name: string): Promise<string> {
  const id = cuid();
  companies.push(id);
  await db(async (client) => {
    await client.query(`INSERT INTO buyer_company (id, name, trn, updated_at) VALUES ($1, $2, '100448216900003', now())`, [id, name]);
    await client.query(`INSERT INTO buyer_company_member (id, company_id, user_id, role) VALUES ($1, $2, $3, 'company_admin')`, [
      cuid(),
      id,
      adminId,
    ]);
  });
  return id;
}

async function signIn(page: Page, email: string, next: string) {
  await page.goto(`/signin?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Mobile or email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[?]/g, "\\?")}$`));
}

test("a signed-out visitor is sent to sign in, and back", async ({ page }) => {
  await page.goto("/account/company");
  await expect(page).toHaveURL(/\/signin\?next=%2Faccount%2Fcompany$/);
});

test("sets up the company, and a short TRN is refused without losing the form (B7)", async ({ page }, info) => {
  test.skip(info.project.name === "mobile", "Writes a company; runs once per shard.");
  const person = await buyer(info, "Rami Haddad");
  await signIn(page, person.email, "/account/company");

  await expect(page.getByText("Set up your company", { exact: true })).toBeVisible();
  const name = `Marina Facilities ${info.workerIndex}${randomBytes(2).toString("hex")} Trading`;
  await page.getByLabel(/Registered company name/).fill(name);
  await page.getByLabel(/^TRN/).fill("100 4482 1690 000");
  await page.getByLabel(/Trade licence number/).fill("ded-772104");
  await page.getByRole("button", { name: "Set up the company" }).click();

  await expect(page.getByText("A TRN is 15 digits. Spaces and dashes are fine.")).toBeVisible();
  // What they typed is still there to correct.
  await expect(page.getByLabel(/Registered company name/)).toHaveValue(name);
  await expect(page.getByLabel(/Trade licence number/)).toHaveValue("ded-772104");

  await page.getByLabel(/^TRN/).fill("100 4482 1690 0003");
  await page.getByRole("button", { name: "Set up the company" }).click();

  const team = page.getByRole("table", { name: /People in the company/ });
  await expect(team).toBeVisible();
  await expect(page.getByLabel(/^TRN/)).toHaveValue("100 4482 1690 0003");
  await expect(page.getByLabel(/Trade licence number/)).toHaveValue("DED-772104");
  // Nothing claims a check nobody performs.
  await expect(page.getByText(/TRN verified|Matched/)).toHaveCount(0);

  const me = team.getByRole("row", { name: /Rami Haddad/ });
  await expect(me.getByRole("cell", { name: "Admin" })).toBeVisible();
  await expect(me.getByRole("cell", { name: "Unlimited" })).toBeVisible();
  // The header names the company the person now sends enquiries for.
  await expect(page.getByRole("banner").getByText(name)).toBeVisible();

  const row = await db((client) =>
    client.query<{ id: string }>(`SELECT buyer_company_id AS id FROM "user" WHERE id = $1`, [person.id]),
  );
  if (row.rows[0]?.id) companies.push(row.rows[0].id);
  expect(row.rows[0]?.id).toBeTruthy();
});

test("the rule card says what the settings say, including who nobody covers (B2, B3)", async ({ page }, info) => {
  test.skip(info.project.name === "mobile", "Changes the rule; runs once per shard.");
  const person = await buyer(info, "Rami Haddad");
  await companyOf(person.id, `Rule ${randomBytes(3).toString("hex")} Trading`);
  await signIn(page, person.email, "/account/company");

  const rule = page.getByRole("region", { name: "Approval rule" });
  await expect(rule.getByText("There is no company threshold. Each person accepts quotes within their own authority.")).toBeVisible();
  await expect(rule.getByText("Nobody approves their own request.")).toBeVisible();

  await rule.getByLabel(/Approval threshold/).fill("25,000");
  await rule.getByLabel("Approver").selectOption({ label: "Rami Haddad" });
  await rule.getByRole("button", { name: "Save rule" }).click();
  await expect(rule.getByText("Quotes over AED 25,000 need approval from Rami Haddad before they are accepted.")).toBeVisible();
  // The only admin is the approver, so nobody can approve his own: the card says so.
  await expect(rule.getByText(/Nobody can approve Rami Haddad's own quotes/)).toBeVisible();

  await rule.getByRole("switch", { name: "Require a PO number" }).click();
  await expect(rule.getByText("A PO number is required to accept a quote.")).toBeVisible();
  await expect(rule.getByRole("switch", { name: "Require a PO number" })).toHaveAttribute("aria-checked", "true");
  // No control on this card promises to block a payment; the one that replaced it tells.
  await expect(rule.getByText(/block payment/i)).toHaveCount(0);
  await expect(rule.getByRole("switch", { name: /Tell admins when a supplier asks to be paid off-platform/ })).toBeVisible();
});

test("approving a colleague's request accepts the quote, and the counter says why it was held (B1, B5)", async ({ page }, info) => {
  test.skip(info.project.name === "mobile", "Accepts a quote; runs once per shard.");
  const approver = await buyer(info, "Rami Haddad");
  const companyId = await companyOf(approver.id, `Approvals ${randomBytes(3).toString("hex")} Trading`);

  const refs = await db(async (client) => {
    const priya = randomUUID();
    people.push(priya);
    await client.query(`INSERT INTO "user" (id, full_name, roles, updated_at) VALUES ($1, 'Priya Menon', '{buyer}', now())`, [priya]);
    await client.query(
      `INSERT INTO buyer_company_member (id, company_id, user_id, role, monthly_limit_aed) VALUES ($1, $2, $3, 'procurement', 10000)`,
      [cuid(), companyId, priya],
    );
    const { rows: sellers } = await client.query<{ id: string; name: string }>(
      `SELECT b.id, b.display_name AS name FROM business b
        WHERE b.claim_status = 'claimed' AND b.published_at IS NOT NULL AND b.suspended_at IS NULL
          AND b.verification_tier >= 2
          AND NOT EXISTS (SELECT 1 FROM "user" u WHERE u.business_id = b.id)
        ORDER BY b.slug ASC, b.id ASC LIMIT 2`,
    );
    if (sellers.length < 2) throw new Error("needs two claimed sellers with no seat");
    const stamp = randomBytes(3).toString("hex").toUpperCase();
    const enquiryId = cuid();
    const ref = `ENQ-7B${stamp}`;
    await client.query(
      `INSERT INTO enquiry (id, ref, buyer_id, buyer_company_id, requirement, closes_at, created_at, emirate)
       VALUES ($1, $2, $3, $4, 'Grooved couplings, gaskets and hangers for the riser replacement.', $5, $6, 'dubai')`,
      [enquiryId, ref, priya, companyId, new Date(Date.now() + 4 * DAY), new Date(Date.now() - 2 * DAY)],
    );
    for (const seller of sellers) {
      await client.query(`INSERT INTO enquiry_recipient (enquiry_id, business_id, state) VALUES ($1, $2, 'quoted')`, [enquiryId, seller.id]);
    }
    const quoteId = cuid();
    await client.query(
      `INSERT INTO quote (id, ref, enquiry_id, business_id, status, sent_at, expires_at, updated_at)
       VALUES ($1, $2, $3, $4, 'sent', $5, $6, now())`,
      [quoteId, `QT-7B${stamp}-R1`, enquiryId, sellers[0]!.id, new Date(Date.now() - DAY), new Date(Date.now() + 13 * DAY)],
    );
    const lines: [string, number, string][] = [
      ["Rigid grooved coupling, DN100", 12, "812.00"],
      ["EPDM gasket, DN100", 24, "185.00"],
      ["Clevis hanger, DN100", 8, "180.00"],
    ];
    for (const [index, [description, qty, price]] of lines.entries()) {
      await client.query(
        `INSERT INTO quote_line (id, quote_id, description, qty, unit_price, sort_order) VALUES ($1, $2, $3, $4, $5, $6)`,
        [cuid(), quoteId, description, qty, price, index],
      );
    }
    await client.query(
      `INSERT INTO quote_approval (id, company_id, enquiry_id, quote_id, quote_revision, value_fils, raised_by_id, reasons, po_number, updated_at)
       VALUES ($1, $2, $3, $4, 1, 1562400, $5, '{over_limit}', 'PO-2026-0418', now())`,
      [cuid(), companyId, enquiryId, quoteId, priya],
    );
    return { enquiryId, supplier: sellers[0]!, stamp };
  });

  await signIn(page, approver.email, "/account/company");
  await expect(page.getByRole("link", { name: /Company & team\s*1/ }).first()).toBeVisible();

  const waiting = page.getByRole("complementary", { name: "Approval rule and requests" });
  await expect(waiting.getByText(`${refs.supplier.name} — 3 lines, AED 15,624 excl. VAT`)).toBeVisible();
  await expect(waiting.getByText("Beyond Priya Menon's monthly limit: AED 0 of AED 10,000 already used")).toBeVisible();

  await waiting.getByRole("button", { name: "Approve" }).click();
  const dialog = page.getByRole("dialog", { name: `Approve QT-7B${refs.stamp}-R1?` });
  await expect(dialog.getByText(/cannot be undone/)).toBeVisible();
  await dialog.getByRole("button", { name: "Approve and accept" }).click();

  await expect(waiting.getByText("Nothing is waiting for your approval.")).toBeVisible();
  const released = await db((client) =>
    client.query<{ to: string | null; ref: string | null }>(
      `SELECT contact_released_to_business_id AS "to", buyer_reference AS ref FROM enquiry WHERE id = $1`,
      [refs.enquiryId],
    ),
  );
  expect(released.rows[0]).toEqual({ to: refs.supplier.id, ref: "PO-2026-0418" });
});

test("has no axe violations", async ({ page }, info) => {
  const person = await buyer(info, "Rami Haddad");
  await companyOf(person.id, `Axe ${randomBytes(3).toString("hex")} Trading`);
  await signIn(page, person.email, "/account/company");
  await expect(page.getByRole("table", { name: /People in the company/ })).toBeVisible();
  const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
  expect(results.violations).toEqual([]);
});
