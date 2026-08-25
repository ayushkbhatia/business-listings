import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test as setup, type Page } from "@playwright/test";
import { Client } from "pg";

/**
 * Sign the seller seats in, once, and save their sessions for the dashboard
 * tests.
 *
 * Four steps of handoff 2 shipped with no browser test for their seller
 * screens, because Playwright builds for production and the development seat
 * in lib/auth/dev-seller.ts is deliberately inert there. The answer was never
 * to weaken that fence — it was to sign in properly, which handoff 2 step 2
 * built.
 *
 * Two seats, because the two overview boards are two plans. Board 3a is what a
 * Pro seller sees and board 11a is the argument made to a Free one, and neither
 * can be checked from the other's session. Handoff 3 will want a third for the
 * `sales` role when criterion 9 arrives.
 *
 * The only substitution is delivery: `admin.generateLink` returns the code
 * Supabase generated without sending it. Everything after — the verify form,
 * verifyOtp, the profile lookup, the roles claim, the redirect — is the
 * production path.
 *
 * Needs a Supabase service key. Without one neither seller project is
 * registered at all (see playwright.config.ts), rather than skipping silently.
 *
 * Talks to Postgres through `pg` rather than Prisma: Playwright transforms test
 * files to CommonJS and the generated client uses `import.meta`.
 */

interface Seat {
  /** A deliverable address: Supabase rejects reserved TLDs like .example. */
  email: string;
  /**
   * The fixture business the specs assert against.
   *
   * Absent for a staff seat, which belongs to the platform rather than to a
   * business. That is not a special case for tests — `User.businessId` is
   * nullable precisely because staff exist.
   */
  slug?: string;
  name: string;
  roles: string[];
  state: string;
  /** Where this seat lands after verifying, per `destinationFor`. */
  landing: string;
  /** The h1 that proves the landing page actually rendered. */
  heading: string;
}

const SEATS: Record<"pro" | "free" | "opsLead" | "moderator", Seat> = {
  pro: {
    email: "bl.e2e.seller@gmail.com",
    slug: "al-marwan-industrial-supplies-llc",
    name: "E2E Seller",
    roles: ["seller_owner"],
    state: "tests/e2e/.auth/seller.json",
    landing: "**/dashboard/leads",
    heading: "Leads",
  },
  free: {
    // Board 11a is the whole reason this seat exists: the missed-enquiry list
    // and the locked panels only appear for a plan that has a cap to reach.
    email: "bl.e2e.free.seller@gmail.com",
    slug: "al-manara-equipment-trading-llc",
    name: "E2E Free Seller",
    roles: ["seller_owner"],
    state: "tests/e2e/.auth/seller-free.json",
    landing: "**/dashboard/leads",
    heading: "Leads",
  },
  /*
   * Two staff seats, and the second one is the point.
   *
   * Criterion 9 says a moderator cannot change a verification tier, issue a
   * credit or suspend an account. The integration tests prove the services
   * refuse them; this seat proves the console does not offer them the control
   * in the first place. Both halves are needed and neither substitutes for the
   * other — a hidden button is a UI opinion and a server action is a URL.
   */
  opsLead: {
    email: "bl.e2e.ops@gmail.com",
    name: "E2E Ops Lead",
    roles: ["staff_ops_lead"],
    state: "tests/e2e/.auth/staff-ops.json",
    landing: "**/admin",
    heading: "Platform overview",
  },
  moderator: {
    email: "bl.e2e.moderator@gmail.com",
    name: "E2E Moderator",
    roles: ["staff_moderator"],
    state: "tests/e2e/.auth/staff-moderator.json",
    landing: "**/admin",
    heading: "Platform overview",
  },
};

async function provision(page: Page, seat: Seat) {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"]!;
  const secret = process.env["SUPABASE_SECRET_KEY"]!;
  const admin: SupabaseClient = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const db = new Client({ connectionString: process.env["DATABASE_URL"]! });
  await db.connect();

  try {
    // Start clean. A leftover from an interrupted run would collide on the
    // unique email and leave the profile row pointing at a dead auth user.
    const { data: existing } = await admin.auth.admin.listUsers({ perPage: 200 });
    for (const user of existing?.users ?? []) {
      if (user.email !== seat.email) continue;
      await db.query('DELETE FROM "user" WHERE id = $1', [user.id]);
      await admin.auth.admin.deleteUser(user.id).catch(() => undefined);
    }
    await db.query('DELETE FROM "user" WHERE email = $1', [seat.email]);

    let businessId: string | null = null;
    if (seat.slug) {
      const business = await db.query<{ id: string }>("SELECT id FROM business WHERE slug = $1", [
        seat.slug,
      ]);
      businessId = business.rows[0]?.id ?? null;
      if (!businessId) throw new Error(`the seed has no business ${seat.slug}`);
    }

    const { data: created, error } = await admin.auth.admin.createUser({
      email: seat.email,
      email_confirm: false,
    });
    if (error || !created.user) throw error ?? new Error(`could not create ${seat.email}`);

    /*
     * The profile row shares the auth user's id, which is what `adoptProfile`
     * expects — see lib/auth/flow.ts. A seller seat is a User with a
     * businessId; this is a real one, not a special case for tests.
     */
    await db.query(
      `INSERT INTO "user" (id, email, full_name, roles, business_id, updated_at)
       VALUES ($1, $2, $3, $4::"role"[], $5, now())`,
      [created.user.id, seat.email, seat.name, seat.roles, businessId],
    );

    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: seat.email,
    });
    if (linkError || !link.properties?.email_otp) {
      throw linkError ?? new Error(`could not generate a sign-in code for ${seat.email}`);
    }

    // The production verify form, not a cookie injected from the side.
    await page.goto(`/verify?to=${encodeURIComponent(seat.email)}`);
    await page.getByLabel("Verification code").fill(link.properties.email_otp);
    await page.getByRole("button", { name: "Verify", exact: true }).click();

    /*
     * A seller lands on their leads and a staff seat lands on the console. If
     * this fails the auth flow is broken, which is worth knowing loudly rather
     * than as forty confusing failures — and it is exactly how the missing
     * `staff_*` branch in `destinationFor` would have surfaced: a staff sign-in
     * that silently went to the directory home.
     */
    await page.waitForURL(seat.landing, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1 })).toContainText(seat.heading);

    await page.context().storageState({ path: seat.state });
  } finally {
    await db.end();
  }
}

setup("sign in as a seller on Pro", async ({ page }) => {
  await provision(page, SEATS.pro);
});

setup("sign in as a seller on Free", async ({ page }) => {
  await provision(page, SEATS.free);
});

setup("sign in as an ops lead", async ({ page }) => {
  await provision(page, SEATS.opsLead);
});

setup("sign in as a moderator", async ({ page }) => {
  await provision(page, SEATS.moderator);
});
