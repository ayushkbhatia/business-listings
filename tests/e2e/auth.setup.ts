import { createClient } from "@supabase/supabase-js";
import { expect, test as setup } from "@playwright/test";
import { Client } from "pg";

/**
 * Sign a seller in, once, and save the session for the dashboard tests.
 *
 * Four steps of this handoff shipped with no browser test for their seller
 * screens, because Playwright builds for production and the development seat
 * in lib/auth/dev-seller.ts is deliberately inert there. The answer was never
 * to weaken that fence — it was to sign in properly, which handoff 2 step 2
 * built. This does that, so criterion 11 covers the seller side with the same
 * evidence as the buyer side.
 *
 * The only substitution is delivery: `admin.generateLink` returns the code
 * Supabase generated without sending it. Everything after — the verify form,
 * verifyOtp, the profile lookup, the roles claim, the redirect — is the
 * production path.
 *
 * Needs a Supabase service key. Without one the seller project is not
 * registered at all (see playwright.config.ts), rather than skipping silently.
 *
 * Talks to Postgres through `pg` rather than Prisma: Playwright transforms
 * test files to CommonJS and the generated client uses `import.meta`. Three
 * statements do not need an ORM.
 */
const STATE = "tests/e2e/.auth/seller.json";

/** A deliverable address: Supabase rejects reserved TLDs like .example. */
const EMAIL = "bl.e2e.seller@gmail.com";
/** The fixture business the dashboard specs assert against. */
const BUSINESS_SLUG = "al-marwan-industrial-supplies-llc";

setup("sign in as a seller", async ({ page }) => {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"]!;
  const secret = process.env["SUPABASE_SECRET_KEY"]!;
  const admin = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const db = new Client({ connectionString: process.env["DATABASE_URL"]! });
  await db.connect();

  try {
    // Start clean. A leftover from an interrupted run would collide on the
    // unique email and leave the profile row pointing at a dead auth user.
    const { data: existing } = await admin.auth.admin.listUsers({ perPage: 200 });
    for (const user of existing?.users ?? []) {
      if (user.email !== EMAIL) continue;
      await db.query('DELETE FROM "user" WHERE id = $1', [user.id]);
      await admin.auth.admin.deleteUser(user.id).catch(() => undefined);
    }
    await db.query('DELETE FROM "user" WHERE email = $1', [EMAIL]);

    const business = await db.query<{ id: string }>(
      'SELECT id FROM business WHERE slug = $1',
      [BUSINESS_SLUG],
    );
    const businessId = business.rows[0]?.id;
    if (!businessId) throw new Error(`the seed has no business ${BUSINESS_SLUG}`);

    const { data: created, error } = await admin.auth.admin.createUser({
      email: EMAIL,
      email_confirm: false,
    });
    if (error || !created.user) throw error ?? new Error("could not create the e2e seller");

    /*
     * The profile row shares the auth user's id, which is what `adoptProfile`
     * expects — see lib/auth/flow.ts. A seller seat is a User with a
     * businessId; this is a real one, not a special case for tests.
     */
    await db.query(
      `INSERT INTO "user" (id, email, full_name, roles, business_id, updated_at)
       VALUES ($1, $2, $3, ARRAY['seller_owner']::"role"[], $4, now())`,
      [created.user.id, EMAIL, "E2E Seller", businessId],
    );

    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: EMAIL,
    });
    if (linkError || !link.properties?.email_otp) {
      throw linkError ?? new Error("could not generate a sign-in code");
    }

    // The production verify form, not a cookie injected from the side.
    await page.goto(`/verify?to=${encodeURIComponent(EMAIL)}`);
    await page.getByLabel("Verification code").fill(link.properties.email_otp);
    await page.getByRole("button", { name: "Verify", exact: true }).click();

    // A seller lands on their leads. If this fails the auth flow is broken,
    // which is worth knowing loudly rather than as forty confusing failures.
    await page.waitForURL("**/dashboard/leads", { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Leads");

    await page.context().storageState({ path: STATE });
  } finally {
    await db.end();
  }
});
