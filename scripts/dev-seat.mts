/**
 * Provision a seat you can actually sign into, and print a code for it.
 *
 *   pnpm dev:seat ops
 *   pnpm dev:seat seller --slug al-marwan-industrial-supplies-llc
 *   pnpm dev:seat buyer --email someone@example.com
 *
 * ## Why this exists
 *
 * Nobody could sign in. Not because the auth flow is broken — it is complete
 * and it works — but because of two things either side of it:
 *
 *   1. `seed.mts` mints its own ids for the four staff seats and every seller
 *      owner (`00000000-0000-4000-8000-…`), so no seeded row corresponds to a
 *      Supabase auth user. `adoptProfile` matches a profile to a session **by
 *      id**, so a seeded seat cannot be adopted — and because `User.email` is
 *      unique, signing up with that address could not create one either.
 *   2. The project's phone provider is off and the built-in SMTP sends two
 *      messages an hour, so even a correct account has no way to receive a
 *      code.
 *
 * This closes both the way `tests/e2e/auth.setup.ts` does, which until now was
 * the only thing in the repo that had ever produced a real session: create the
 * auth user, write the profile row with the **same id**, then read the one-time
 * code out of `generateLink` instead of sending it anywhere.
 *
 * ## What this is not
 *
 * Not a bypass. It mints no session and grants no role directly — it prints a
 * code you type into the real `/verify` form, so `verifyOtp`, `adoptProfile`
 * and `syncClaims` all run exactly as they do for a member of the public.
 *
 * `lib/auth/staff.ts` argues against a dev route to `ops_lead` on the grounds
 * that the blast radius is every audited capability in the matrix, and it is
 * right. That argument is about an environment variable that *makes you* an
 * ops lead. This is a script that provisions an account and hands you a
 * one-time code, run by somebody who already holds the service-role key.
 */

import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";

const ROLES = {
  ops: { roles: ["staff_ops_lead"], name: "Dev Ops Lead", landing: "/admin" },
  moderator: { roles: ["staff_moderator"], name: "Dev Moderator", landing: "/admin" },
  finance: { roles: ["staff_finance"], name: "Dev Finance", landing: "/admin" },
  field: { roles: ["staff_field"], name: "Dev Field Verifier", landing: "/admin" },
  seller: { roles: ["seller_owner"], name: "Dev Seller", landing: "/dashboard/leads" },
  buyer: { roles: ["buyer"], name: "Dev Buyer", landing: "/" },
} as const;

type SeatKind = keyof typeof ROLES;

function usage(message: string): never {
  console.error(`\n${message}\n`);
  console.error("  pnpm dev:seat <kind> [--email you@example.com] [--slug business-slug]");
  console.error(`  kind: ${Object.keys(ROLES).join(" | ")}\n`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const kind = argv[0] as SeatKind | undefined;
if (!kind || !(kind in ROLES)) usage("Pick a seat kind.");

function flag(name: string): string | undefined {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? undefined : argv[at + 1];
}

const seat = ROLES[kind];
// A deliverable address by default. Supabase rejects reserved TLDs like
// `.example`, which is why the seeded seller owners are doubly unreachable.
const email = flag("email") ?? `dev-${kind}@businesslistings.me`;
const slug = flag("slug");

const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
const secret = process.env["SUPABASE_SECRET_KEY"];
const database = process.env["DATABASE_URL"];

if (!url || !secret || !database) {
  usage(
    "Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and DATABASE_URL.\n" +
      "They are in .env.local — run this through `pnpm dev:seat`, which loads it.",
  );
}

if (process.env["NODE_ENV"] === "production") {
  usage("Refusing to run against production.");
}

const admin = createClient(url, secret, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const db = new Client({ connectionString: database });

await db.connect();

try {
  let businessId: string | null = null;
  if (seat.roles[0] === "seller_owner") {
    if (!slug) usage("A seller seat needs --slug, so there is a business to own.");
    const found = await db.query<{ id: string }>("SELECT id FROM business WHERE slug = $1", [slug]);
    businessId = found.rows[0]?.id ?? null;
    if (!businessId) usage(`No business with slug ${slug}. Has the seed run?`);
  }

  /*
     Reuse the auth user if it is already there rather than deleting it.

     `audit_event.actor_id` is Restrict, so once a seat has performed an
     audited mutation its profile row cannot be deleted — which is right, an
     audit log that can lose its actor is not an audit log. The e2e setup
     learned this the same way.
  */
  const { data: existing } = await admin.auth.admin.listUsers({ perPage: 200 });
  const found = (existing?.users ?? []).find((user) => user.email === email);

  let userId: string;
  if (found) {
    userId = found.id;
    const profile = await db.query('SELECT id FROM "user" WHERE id = $1', [userId]);
    if (profile.rowCount === 0) {
      // An auth user that outlived its profile row. Take the unique email back
      // from any orphan before re-creating it.
      await db.query('DELETE FROM "user" WHERE email = $1 AND id <> $2', [email, userId]);
      await db.query(
        `INSERT INTO "user" (id, email, full_name, roles, business_id, updated_at)
         VALUES ($1, $2, $3, $4::"role"[], $5, now())`,
        [userId, email, seat.name, seat.roles, businessId],
      );
    } else {
      await db.query(
        `UPDATE "user" SET full_name = $2, roles = $3::"role"[], business_id = $4, updated_at = now()
         WHERE id = $1`,
        [userId, seat.name, seat.roles, businessId],
      );
    }
    console.log(`· reusing the existing seat for ${email}`);
  } else {
    // A profile row holding this email with no auth user behind it is a dead
    // row, and it holds the unique address.
    await db.query('DELETE FROM "user" WHERE email = $1', [email]);
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: false,
    });
    if (error || !created.user) throw error ?? new Error(`could not create ${email}`);
    userId = created.user.id;

    // The profile row shares the auth user's id. That is the whole fix —
    // `adoptProfile` matches on it, and the seed's synthetic ids never can.
    await db.query(
      `INSERT INTO "user" (id, email, full_name, roles, business_id, updated_at)
       VALUES ($1, $2, $3, $4::"role"[], $5, now())`,
      [userId, email, seat.name, seat.roles, businessId],
    );
    console.log(`· created ${email}`);
  }

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const code = link?.properties?.email_otp;
  if (linkError || !code) {
    throw linkError ?? new Error(`could not generate a code for ${email}`);
  }

  console.log(`
  seat      ${kind} — ${seat.roles.join(", ")}
  email     ${email}${businessId ? `\n  business  ${slug}` : ""}
  code      ${code}

  Sign in at  http://localhost:3000/verify?to=${encodeURIComponent(email)}
  You land on ${seat.landing}

  The code is single-use and expires. Run this again for another.
`);
} finally {
  await db.end();
}
