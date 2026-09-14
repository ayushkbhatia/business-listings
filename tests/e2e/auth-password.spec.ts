import { createHash, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { Client } from "pg";

/**
 * Board 7a, clicked — the round trips a render test cannot see.
 *
 *   - sign in with a password and land where you were going;
 *   - a wrong password states what is left, and the fifth locks the password
 *     while the code button stays live (`B5`);
 *   - a reset link opens a password field once, the meter reads the board's
 *     "Strong — 12 characters", saving signs in, and the same link is dead after;
 *   - a session whose account is suspended stops working on the next request.
 *
 * Each test makes its own account, named for the project and worker, so the
 * desktop and mobile projects never share one — the lockout counts per
 * identifier, and a shared seat would lock the other project out.
 *
 * Delivery is the one thing substituted: the reset grant is written straight
 * into `password_reset` with a token this test holds, because the emailed link
 * is the only leg that needs a mail carrier. Everything from the link onwards is
 * the production path.
 *
 * Talks to Postgres through `pg`, as auth.setup.ts does: Playwright transforms
 * test files to CommonJS and the generated Prisma client uses `import.meta`.
 */

const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
const secret = process.env["SUPABASE_SECRET_KEY"];
const PASSWORD = "harbour crane at jebel ali";

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
    await client.query(`DELETE FROM password_reset WHERE user_id = ANY($1::uuid[])`, [made]);
    await client.query(`DELETE FROM auth_attempt WHERE identifier IN (SELECT email FROM "user" WHERE id = ANY($1::uuid[]))`, [made]);
    await client.query(`DELETE FROM "user" WHERE id = ANY($1::uuid[])`, [made]);
  });
  for (const id of made) await admin.auth.admin.deleteUser(id).catch(() => undefined);
});

async function account(info: TestInfo, password: string | null = PASSWORD) {
  const tag = `${info.project.name}-${info.workerIndex}-${Date.now().toString(36)}`;
  const email = `bl.e2e.7a+${tag}@gmail.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    ...(password ? { password } : {}),
  });
  if (error || !data.user) throw error ?? new Error("no user");
  made.push(data.user.id);
  await db((client) =>
    client.query(`INSERT INTO "user" (id, email, full_name, roles, updated_at) VALUES ($1, $2, $3, '{buyer}', now())`, [
      data.user!.id,
      email,
      "Suresh Menon",
    ]),
  );
  return { id: data.user.id, email };
}

async function signIn(page: Page, identifier: string, password: string) {
  await page.getByLabel("Mobile or email").fill(identifier);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("signs in with a password and lands where it was going", async ({ page }, info) => {
  const { email } = await account(info);
  await page.goto("/signin?next=%2Faccount%2Fenquiries");
  await signIn(page, email, PASSWORD);
  await expect(page).toHaveURL(/\/account\/enquiries$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your enquiries");
});

test("a wrong password states what is left, and the fifth locks only the password (B5)", async ({ page }, info) => {
  const { email } = await account(info);
  await page.goto("/signin");
  await signIn(page, email, "not the password at all");
  await expect(page.getByRole("alert").filter({ hasText: "4 attempts left" })).toBeVisible();

  for (let i = 0; i < 4; i += 1) {
    await page.getByLabel("Password").fill(`still not it ${i} xx`);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(/error=/);
  }

  await expect(page.getByText("Locked for 15 minutes, or sign in with a one-time code instead.")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Send me a one-time code" })).toBeEnabled();

  // A fresh visit with the identifier reads the lock from the record, not the URL.
  await page.goto(`/signin?to=${encodeURIComponent(email)}`);
  await expect(page.getByLabel("Password")).toBeDisabled();
});

test("a reset link sets a password once, signs in with it, and is dead afterwards (criterion 6)", async ({ page }, info) => {
  const { id, email } = await account(info, null);
  const token = randomBytes(32).toString("base64url");
  await db((client) =>
    client.query(
      `INSERT INTO password_reset (id, user_id, channel, token_hash, created_at, expires_at)
       VALUES ($1, $2, 'email', $3, now(), now() + interval '1 hour')`,
      [`e2e${randomBytes(8).toString("hex")}`, id, createHash("sha256").update(token).digest("hex")],
    ),
  );

  await page.goto(`/auth/reset?token=${token}`);
  // The token leaves the address bar at the first redirect.
  await expect(page).toHaveURL(/\/reset\?stage=set$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Set a new password");

  const field = page.getByLabel("New password");
  await field.fill("harbour");
  await expect(page.getByText("7 characters — it needs at least 12")).toBeVisible();
  await field.fill("harbourcrane");
  await expect(page.getByText("Strong — 12 characters")).toBeVisible();

  await page.getByRole("button", { name: "Save and sign in" }).click();
  await expect(page).toHaveURL(/\/account\/enquiries$/);

  const saved = await db((client) =>
    client.query<{ password_set_at: Date | null }>(`SELECT password_set_at FROM "user" WHERE id = $1`, [id]),
  );
  expect(saved.rows[0]?.password_set_at).not.toBeNull();

  await page.goto(`/auth/reset?token=${token}`);
  await expect(page).toHaveURL(/\/reset\?error=link_expired/);

  // And the password that was set is one that signs in.
  await page.context().clearCookies();
  await page.goto("/signin");
  await signIn(page, email, "harbourcrane");
  await expect(page).toHaveURL(/\/account\/enquiries$/);
});

test("a suspended account's live session stops at the next request, and sign-in says why without saying why (B7)", async ({ page }, info) => {
  const { id, email } = await account(info);
  await page.goto("/signin?next=%2Faccount%2Fenquiries");
  await signIn(page, email, PASSWORD);
  await expect(page).toHaveURL(/\/account\/enquiries$/);

  await db((client) => client.query(`UPDATE "user" SET suspended_at = now() WHERE id = $1`, [id]));

  await page.goto("/account/enquiries");
  await expect(page).toHaveURL(/\/signin/);

  await signIn(page, email, PASSWORD);
  await expect(page.getByText("Contact support — the reason is in your email.")).toBeVisible();
  await page.goto("/account/enquiries");
  await expect(page).toHaveURL(/\/signin/);
});
