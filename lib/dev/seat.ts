import "server-only";
import { prisma } from "@/lib/db/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyCode } from "@/lib/auth/flow";
import type { Role } from "@/lib/auth/roles";
import { devGate } from "./guard";

/**
 * Sign in as any seat, on a throwaway database, without typing a code.
 *
 * ## Why this exists
 *
 * The seller dashboard has fifteen screens and nobody had looked at them
 * signed in. Not because sign-in is broken — it is complete — but because
 * three things stand between a developer and a session:
 *
 *   - `prisma/seed.mts` mints its own ids (`00000000-0000-4000-8000-…`) for
 *     every seeded owner, so no seeded row corresponds to a Supabase auth user
 *     and `adoptProfile`, which matches by id, can never adopt one.
 *   - The project's phone provider is off and the built-in SMTP sends two
 *     messages an hour, so a correct account still has no way to receive a code.
 *   - `DEV_SELLER_SLUG` sidesteps both, but it is one business chosen in a file,
 *     read only where `getSellerSeat` looks for it, and it produces an actor
 *     that no capability check on the staff side will ever see.
 *
 * `scripts/dev-seat.mts` already solves this at the command line. This is the
 * same mechanism behind a page, which matters for two reasons: switching
 * business or role is now a click rather than a script run plus a code typed
 * into a form, and an agent driving a browser can reach it.
 *
 * ## What this is not
 *
 * **Not a bypass.** No session is minted here and no role is granted to a
 * session directly. It provisions an account with the service-role key,
 * generates a one-time code with `admin.generateLink`, and then calls the
 * ordinary `verifyCode` — so `supabase.auth.verifyOtp`, `adoptProfile`,
 * `syncClaims` and the cookie writes are the production path, byte for byte.
 * The only substitution is delivery.
 *
 * `lib/auth/staff.ts` argues there must be no development route to `ops_lead`,
 * and it is right. That argument is about an environment variable that *makes
 * you* an ops lead — a fence inside the auth layer with a hole in it. This
 * creates an account and hands it a code, on a loopback database, to somebody
 * who already holds the service-role key. `scripts/dev-seat.mts` makes the same
 * distinction at more length and provisions the same seats.
 */

export interface SeatKind {
  key: string;
  roles: readonly Role[];
  /** Whether this seat is attached to one business. */
  needsBusiness: boolean;
  /** Where the real `destinationFor` will land it. */
  landing: string;
}

/**
 * Every seat worth looking at a screen from.
 *
 * All four seller roles, not just the owner. Board 8a refuses a `seller_sales`
 * seat and the team screen refuses everything but an owner; a fence nobody can
 * stand behind is a fence nobody has checked.
 */
export const SEAT_KINDS: readonly SeatKind[] = [
  { key: "owner", roles: ["seller_owner"], needsBusiness: true, landing: "/dashboard" },
  { key: "manager", roles: ["seller_manager"], needsBusiness: true, landing: "/dashboard" },
  { key: "sales", roles: ["seller_sales"], needsBusiness: true, landing: "/dashboard/leads" },
  { key: "finance", roles: ["seller_finance"], needsBusiness: true, landing: "/dashboard/billing" },
  { key: "ops_lead", roles: ["staff_ops_lead"], needsBusiness: false, landing: "/admin" },
  { key: "moderator", roles: ["staff_moderator"], needsBusiness: false, landing: "/admin" },
  { key: "field", roles: ["staff_field"], needsBusiness: false, landing: "/admin" },
  { key: "staff_finance", roles: ["staff_finance"], needsBusiness: false, landing: "/admin" },
  { key: "buyer", roles: ["buyer"], needsBusiness: false, landing: "/" },
];

export function seatKind(key: string): SeatKind | undefined {
  return SEAT_KINDS.find((kind) => kind.key === key);
}

/**
 * A deliverable domain. Supabase rejects reserved TLDs like `.example`, which
 * is why every seeded owner is doubly unreachable — the address could not
 * receive a code even if the id matched.
 */
const DOMAIN = "businesslistings.me";

/** One stable address per seat, so re-signing in reuses the account. */
export function seatEmail(kind: SeatKind, slug: string | null): string {
  return kind.needsBusiness && slug
    ? `dev-${kind.key}-${slug}@${DOMAIN}`.slice(0, 200)
    : `dev-${kind.key}@${DOMAIN}`;
}

export type SeatResult =
  | { ok: true; destination: string; email: string }
  | { ok: false; error: string };

/**
 * Provision the account, then sign in through the real form's own service.
 *
 * The guard is re-checked here rather than trusted from the layout. A server
 * action is a URL: the page it was rendered on refusing to render does not
 * stop a POST, and this one grants a session.
 */
export async function takeSeat(kindKey: string, slug: string | null): Promise<SeatResult> {
  const gate = devGate();
  if (!gate.allowed) return { ok: false, error: gate.refusals.join(" ") };

  const kind = seatKind(kindKey);
  if (!kind) return { ok: false, error: "That seat does not exist." };

  let businessId: string | null = null;
  if (kind.needsBusiness) {
    if (!slug) return { ok: false, error: "A seller seat needs a business to belong to." };
    const business = await prisma.business.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!business) return { ok: false, error: `No business has the slug ${slug}.` };
    businessId = business.id;
  }

  const email = seatEmail(kind, slug);
  const admin = createAdminClient();

  /*
     Reuse the auth user where it exists rather than deleting and recreating.

     `audit_event.actor_id` is Restrict, so once a seat has performed an audited
     mutation its profile row cannot be deleted — which is correct; an audit log
     that can lose its actor is not an audit log. `scripts/dev-seat.mts` learned
     this the same way.
  */
  const { data: existing } = await admin.auth.admin.listUsers({ perPage: 200 });
  const found = (existing?.users ?? []).find((user) => user.email === email);

  let userId: string;
  if (found) {
    userId = found.id;
  } else {
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: false,
    });
    if (error || !created.user) {
      return { ok: false, error: error?.message ?? `Could not create ${email}.` };
    }
    userId = created.user.id;
  }

  /*
     The profile row shares the auth user's id. That is the whole fix — every
     other route into a seat fails here, because `adoptProfile` matches on the
     id and the seed's synthetic ids never can.

     A profile holding this address under some other id is a dead row that owns
     a unique column, so it is cleared first.
  */
  await prisma.user.deleteMany({ where: { email, id: { not: userId } } });
  await prisma.user.upsert({
    where: { id: userId },
    create: {
      id: userId,
      email,
      fullName: `Dev ${kind.key}`,
      roles: [...kind.roles],
      businessId,
    },
    update: {
      email,
      roles: [...kind.roles],
      businessId,
      // A seat that was suspended by a moderator spec would otherwise refuse
      // for the rest of the database's life.
      suspendedAt: null,
    },
  });

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const code = link?.properties?.email_otp;
  if (linkError || !code) {
    return { ok: false, error: linkError?.message ?? `Could not generate a code for ${email}.` };
  }

  /*
     The production path from here. `verifyCode` calls `supabase.auth.verifyOtp`
     on the cookie-scoped server client, so the session cookies are written by
     the same code that writes them for a member of the public, and
     `adoptProfile` reads back the roles and business written above rather than
     granting anything of its own.
  */
  const outcome = await verifyCode({ identifier: email, code });
  if (!outcome.ok) return { ok: false, error: `Sign-in refused: ${outcome.kind}.` };
  if (outcome.kind !== "signed_in") return { ok: false, error: `Unexpected outcome: ${outcome.kind}.` };

  return { ok: true, destination: outcome.destination, email };
}

export interface SeatBusiness {
  slug: string;
  displayName: string;
  planId: string;
  verificationTier: number;
  profileStrength: number | null;
  live: boolean;
  suspended: boolean;
  products: number;
  photos: number;
  seats: number;
}

/**
 * The businesses worth seating into, and enough about each to choose one.
 *
 * The columns are the ones that change what a dashboard screen renders: the
 * plan decides which panels lock, the tier decides the badge, strength decides
 * the setup hub, and the three counts decide whether the setup tasks read as
 * open or done. Picking a business at random and finding every screen in the
 * same state is how a surface goes a whole handoff without its empty state
 * being looked at.
 */
export async function seatBusinesses(limit = 40): Promise<SeatBusiness[]> {
  const rows = await prisma.business.findMany({
    where: { claimStatus: "claimed" },
    orderBy: [{ profileStrength: "desc" }, { displayName: "asc" }],
    take: limit,
    select: {
      slug: true,
      displayName: true,
      planId: true,
      verificationTier: true,
      profileStrength: true,
      publishedAt: true,
      suspendedAt: true,
      _count: { select: { products: true, media: true, team: true } },
    },
  });

  return rows.map((row) => ({
    slug: row.slug,
    displayName: row.displayName,
    planId: row.planId ?? "free",
    verificationTier: row.verificationTier,
    profileStrength: row.profileStrength,
    live: row.publishedAt !== null,
    suspended: row.suspendedAt !== null,
    products: row._count.products,
    photos: row._count.media,
    seats: row._count.team,
  }));
}
