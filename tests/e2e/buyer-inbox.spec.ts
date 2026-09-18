import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { Client } from "pg";

/**
 * Board 10e, clicked — the buyer's way back in.
 *
 *   - the chips count the rows, and the gap between SENT TO and QUOTED is the
 *     verb on each one;
 *   - NEEDS YOU nudges the sellers who have not answered and says how many;
 *   - *Re-send* opens the composer carrying the expired requirement — over a
 *     draft left by an earlier visit, which used to win;
 *   - a search saved with nothing behind it is kept as an alert, and removed on
 *     request;
 *   - the account menu signs out.
 *
 * Each test makes its own buyer, named for the project and worker, so desktop
 * and mobile never share a chip count. The enquiries are written straight into
 * Postgres: an inbox is what is already there when the buyer comes back, and a
 * sent enquiry would fan out to seeded sellers other specs count leads for. The
 * recipients are sellers with no seat, for the same reason.
 *
 * Talks to Postgres through `pg`, as auth.setup.ts does: Playwright transforms
 * test files to CommonJS and the generated Prisma client uses `import.meta`.
 */

const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
const secret = process.env["SUPABASE_SECRET_KEY"];
const PASSWORD = "dhow wharf at deira creek";
const DAY = 86_400_000;

test.skip(!url || !secret, "Needs a Supabase service key to make an account.");

let admin: SupabaseClient;
const made: string[] = [];

test.beforeAll(() => {
  admin = createClient(url!, secret!, { auth: { autoRefreshToken: false, persistSession: false } });
});

async function db<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env["DATABASE_URL"]! });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

test.afterAll(async () => {
  if (!made.length) return;
  await db(async (client) => {
    await client.query(`DELETE FROM enquiry WHERE buyer_id = ANY($1::uuid[])`, [made]);
    await client.query(`DELETE FROM saved_search WHERE user_id = ANY($1::uuid[])`, [made]);
    await client.query(`DELETE FROM auth_attempt WHERE identifier IN (SELECT email FROM "user" WHERE id = ANY($1::uuid[]))`, [made]);
    await client.query(`DELETE FROM "user" WHERE id = ANY($1::uuid[])`, [made]);
  });
  for (const id of made) await admin.auth.admin.deleteUser(id).catch(() => undefined);
});

const id = () => `e2e10e${randomBytes(8).toString("hex")}`;

interface Inbox {
  email: string;
  nudgeRef: string;
  compareRef: string;
  expiredRef: string;
}

/** A buyer with three enquiries: one to nudge, one with two quotes closing tomorrow, one expired. */
async function buyer(info: TestInfo): Promise<Inbox> {
  const tag = `${info.project.name}-${info.workerIndex}-${Date.now().toString(36)}`;
  const email = `bl.e2e.10e+${tag}@gmail.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, password: PASSWORD });
  if (error || !data.user) throw error ?? new Error("no user");
  const userId = data.user.id;
  made.push(userId);

  const stamp = randomBytes(3).toString("hex").toUpperCase();
  const refs = { nudgeRef: `ENQ-N${stamp}`, compareRef: `ENQ-C${stamp}`, expiredRef: `ENQ-X${stamp}` };

  await db(async (client) => {
    await client.query(`INSERT INTO "user" (id, email, full_name, roles, updated_at) VALUES ($1, $2, $3, '{buyer}', now())`, [
      userId,
      email,
      "Mariam Haddad",
    ]);
    const { rows: sellers } = await client.query<{ id: string }>(
      `SELECT b.id FROM business b
        WHERE b.claim_status = 'claimed' AND b.published_at IS NOT NULL AND b.suspended_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM "user" u WHERE u.business_id = b.id)
        ORDER BY b.slug DESC, b.id DESC LIMIT 2`,
    );
    if (sellers.length < 2) throw new Error("needs two claimed sellers with no seat");

    const now = Date.now();
    const enquiry = async (ref: string, requirement: string, closesAt: number, quoted: boolean) => {
      const enquiryId = id();
      await client.query(
        `INSERT INTO enquiry (id, ref, buyer_id, requirement, closes_at, created_at, emirate, deliver_to_area)
         VALUES ($1, $2, $3, $4, $5, $6, 'dubai', 'Al Quoz Industrial 3')`,
        [enquiryId, ref, userId, requirement, new Date(closesAt), new Date(now - 2 * DAY)],
      );
      await client.query(
        `INSERT INTO enquiry_line (id, enquiry_id, description, qty, sort_order) VALUES ($1, $2, 'Gate valve DN100, flanged PN16', 12, 0)`,
        [id(), enquiryId],
      );
      for (const seller of sellers) {
        await client.query(`INSERT INTO enquiry_recipient (enquiry_id, business_id, created_at) VALUES ($1, $2, $3)`, [
          enquiryId,
          seller.id,
          new Date(now - 2 * DAY),
        ]);
        if (quoted) {
          await client.query(
            `INSERT INTO quote (id, ref, enquiry_id, business_id, status, sent_at, updated_at) VALUES ($1, $2, $3, $4, 'sent', $5, now())`,
            [id(), `${ref}-${seller.id.slice(-4)}`, enquiryId, seller.id, new Date(now - DAY)],
          );
          await client.query(
            `UPDATE enquiry_recipient SET state = 'quoted', first_reply_at = $3 WHERE enquiry_id = $1 AND business_id = $2`,
            [enquiryId, seller.id, new Date(now - DAY)],
          );
        }
      }
    };
    // Two days and two hours, so "closes in 2 days" survives the seconds between here and the render.
    await enquiry(refs.nudgeRef, "Isolation valves for a chilled water riser", now + 2 * DAY + 2 * 60 * 60_000, false);
    await enquiry(refs.compareRef, "Butterfly valves for a pump room upgrade", now + DAY - 60 * 60_000, true);
    await enquiry(refs.expiredRef, "Gate valves for a district cooling plant", now - DAY, false);
  });

  return { email, ...refs };
}

async function signIn(page: Page, email: string, next: string) {
  await page.goto(`/signin?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Mobile or email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[?]/g, "\\?")}$`));
}

test("the chips count the rows, and NEEDS YOU nudges who has not answered (B1, B5)", async ({ page }, info) => {
  const inbox = await buyer(info);
  await signIn(page, inbox.email, "/account/enquiries");

  const chips = page.getByRole("navigation", { name: "Filter enquiries" });
  await expect(chips.getByRole("link", { name: "All 3" })).toBeVisible();
  await expect(chips.getByRole("link", { name: "Awaiting quotes 1" })).toBeVisible();
  await expect(chips.getByRole("link", { name: "Quotes in 1" })).toBeVisible();
  await expect(chips.getByRole("link", { name: "Accepted 0" })).toBeVisible();
  await expect(chips.getByRole("link", { name: "Expired 1" })).toBeVisible();

  // The verb is the status, and the status is the link.
  await expect(page.getByRole("link", { name: `Compare now, ${inbox.compareRef}` })).toHaveAttribute(
    "href",
    `/enquiry/${inbox.compareRef}/compare`,
  );
  await expect(page.getByRole("link", { name: `Re-send, ${inbox.expiredRef}` })).toHaveAttribute(
    "href",
    `/rfq/new?resend=${inbox.expiredRef}`,
  );

  const rail = page.getByRole("complementary", { name: "What needs you, and your history" });
  await expect(rail.getByText(`${inbox.nudgeRef} has no quotes and closes in 2 days`)).toBeVisible();
  await rail.getByRole("button", { name: "Nudge 2 sellers" }).click();

  await expect(page.getByText(`Nudged 2 sellers on ${inbox.nudgeRef}.`)).toBeVisible();
  await expect(rail.getByRole("button", { name: /^Nudge/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: `Awaiting quotes, ${inbox.nudgeRef}` })).toBeVisible();

  // Filtering to a chip shows exactly the rows it counted.
  await chips.getByRole("link", { name: "Expired 1" }).click();
  await expect(page).toHaveURL(/status=expired$/);
  // The URL changes before the new rows commit; the chip's current state is the commit.
  await expect(chips.getByRole("link", { name: "Expired 1" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: new RegExp(`, ${inbox.compareRef}$`) })).toHaveCount(0);
  await expect(page.getByRole("link", { name: `Re-send, ${inbox.expiredRef}` })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(`, ${inbox.nudgeRef}$`) })).toHaveCount(0);
});

test("re-send opens the composer carrying the expired requirement, over an older draft (B3)", async ({ page }, info) => {
  const inbox = await buyer(info);
  await signIn(page, inbox.email, "/account/enquiries");

  // A cold visit first leaves a blank row in the draft store.
  await page.goto("/rfq/new");
  await expect(page.getByText("1 / 3")).toBeVisible();

  await page.goto("/account/enquiries");
  await page.getByRole("link", { name: `Re-send, ${inbox.expiredRef}` }).click();
  await expect(page).toHaveURL(new RegExp(`resend=${inbox.expiredRef}$`));
  await expect(page.getByText(`Re-sending ${inbox.expiredRef}, which expired.`)).toBeVisible();

  await expect(page.locator("tbody tr").first().locator("input").first()).toHaveValue("Gate valve DN100, flanged PN16");
  await expect(page.getByLabel("Describe the job")).toHaveValue("Gate valves for a district cooling plant");
  await expect(page.getByLabel("Deliver to")).toHaveValue("Al Quoz Industrial 3");
  await expect(page.getByLabel("Emirate")).toHaveValue("dubai");

  // An enquiry still open has nothing to re-send, and says so.
  await page.goto(`/rfq/new?resend=${inbox.nudgeRef}`);
  await expect(page.getByRole("heading", { level: 1, name: "Re-send an enquiry" })).toBeVisible();
  await expect(page.getByText(`${inbox.nudgeRef} is still open, so there is nothing to re-send yet.`)).toBeVisible();
});

test("a search with nothing behind it is kept as an alert, and removed on request (B6)", async ({ page }, info) => {
  const inbox = await buyer(info);
  await signIn(page, inbox.email, "/account/saved");
  await expect(page.getByText("No saved searches yet")).toBeVisible();

  const query = `zeolite desiccant ${randomBytes(3).toString("hex")}`;
  await page.goto(`/search?q=${encodeURIComponent(query)}`);
  await page.getByRole("button", { name: "Save this search" }).click();
  await expect(page.getByText("Nothing matches yet. We email you when something is listed.")).toBeVisible();

  await page.goto("/account/saved");
  const row = page.getByRole("listitem").filter({ hasText: query });
  await expect(row.getByText("nothing exists yet")).toBeVisible();
  await expect(row.getByText("Alert from a zero-result search")).toBeVisible();
  await expect(row.getByLabel("Alert")).toHaveValue("when_listed");

  await row.getByLabel("Alert").selectOption("daily");
  await row.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Alert saved.")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: query }).getByLabel("Alert")).toHaveValue("daily");

  await page.getByRole("button", { name: `Remove ${query}` }).click();
  await expect(page.getByText("Saved search removed.")).toBeVisible();
  await expect(page.getByText("Alert saved.")).toHaveCount(0);
  await expect(page.getByRole("listitem").filter({ hasText: query })).toHaveCount(0);
});

test("the account menu names the buyer and signs out", async ({ page }, info) => {
  const inbox = await buyer(info);
  await signIn(page, inbox.email, "/account/enquiries");

  const header = page.getByRole("banner");
  // Board 7b: the header names the whole person, as `BLNav`'s signed-in block does.
  await header.getByText("Mariam Haddad", { exact: true }).click();
  await expect(header.getByRole("link", { name: "Saved searches" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(header.getByRole("link", { name: "Saved searches" })).toBeHidden();

  await header.getByText("Mariam Haddad", { exact: true }).click();
  await header.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);

  // The session is gone, not only the menu: the inbox asks for a sign-in again.
  await page.goto("/account/enquiries");
  await expect(page).toHaveURL(/\/signin\?next=%2Faccount%2Fenquiries$/);
  await expect(page.getByRole("banner").getByText("Mariam Haddad", { exact: true })).toHaveCount(0);
});
