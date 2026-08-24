import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkThrottle, recordAttempt } from "./attempts";
import { maskIdentifier, normaliseIdentifier, type Identifier } from "./identity";
import { retryAfterSeconds } from "./throttle";
import type { Role } from "./roles";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The auth flow, as a service.
 *
 * Board 7a draws four states — sign in, sign up, verify, reset — and three
 * failures: link expired, too many attempts, account suspended. All seven are
 * outcomes of these functions, returned as values rather than thrown, because
 * every one of them is a screen somebody has to be shown rather than an error
 * somebody has to debug.
 *
 * Supabase owns the code. It generates, stores, expires and verifies the OTP;
 * we deliver it and decide who is allowed to ask. See docs/auth-whatsapp-otp.md
 * for why, and for what remains switched off on the Supabase side.
 *
 * Every function takes an optional Supabase client. The default reads the
 * request's cookies, which only exists inside a request — injecting one is what
 * lets tests/integration/auth-flow.test.ts drive the real thing against the
 * real Supabase project without a browser.
 */
export interface AuthDeps {
  supabase?: SupabaseClient;
}

async function clientFrom(deps: AuthDeps): Promise<SupabaseClient> {
  return deps.supabase ?? ((await createClient()) as unknown as SupabaseClient);
}

/** Every way the seven screens can end. One string, one screen. */
export type AuthOutcome =
  | { ok: true; kind: "code_sent"; identifier: Identifier; masked: string }
  | { ok: true; kind: "signed_in"; userId: string; destination: string }
  | { ok: true; kind: "reset_sent"; masked: string }
  | { ok: false; kind: "invalid_identifier" }
  | { ok: false; kind: "cooldown"; retryAfterSeconds: number }
  | { ok: false; kind: "too_many_attempts"; retryAfterSeconds: number; limit: number }
  | { ok: false; kind: "code_incorrect" }
  | { ok: false; kind: "link_expired" }
  | { ok: false; kind: "suspended"; since: Date }
  | { ok: false; kind: "delivery_failed" }
  | { ok: false; kind: "unavailable" };

export interface StartInput {
  /** As typed. Normalised here, never by the caller. */
  identifier: string;
  ip?: string | null;
}

export interface SignUpInput extends StartInput {
  fullName: string;
  /** Board 7a: one account, two roles, either addable later. */
  wantsToBuy: boolean;
  wantsToList: boolean;
}

/**
 * Ask for a code, for somebody who already has an account.
 *
 * Deliberately says the same thing whether or not the account exists. A trade
 * directory publishes supplier numbers on their storefronts, so enumerating
 * those is worthless — but buyer numbers are not published, and this is the
 * one place they could be checked one at a time. The cost of the neutral answer
 * is that a typo waits for a code that never comes, which the verify screen
 * softens by naming the masked number it sent to.
 */
export async function startSignIn(input: StartInput, deps: AuthDeps = {}): Promise<AuthOutcome> {
  const identifier = normaliseIdentifier(input.identifier);
  if (!identifier) return { ok: false, kind: "invalid_identifier" };

  const gate = await checkThrottle(identifier.value, "otp_request");
  if (!gate.allowed) return throttled(gate);

  const supabase = await clientFrom(deps);
  const { error } = await supabase.auth.signInWithOtp({
    ...(identifier.kind === "phone" ? { phone: identifier.value } : { email: identifier.value }),
    options: { shouldCreateUser: false },
  });

  await recordAttempt({
    identifier: identifier.value,
    kind: "otp_request",
    // "No such user" still spent an attempt. Not counting it would make the
    // throttle itself an enumeration oracle.
    succeeded: !error,
    ip: input.ip ?? null,
  });

  return { ok: true, kind: "code_sent", identifier, masked: maskIdentifier(identifier) };
}

/**
 * Create an account and ask for a code.
 *
 * If a provisional identity already holds this number — a buyer who sent an
 * enquiry without signing up, which the enquiry flow in step 3 creates — it is
 * adopted rather than duplicated. Their enquiries come with them.
 */
export async function startSignUp(input: SignUpInput, deps: AuthDeps = {}): Promise<AuthOutcome> {
  const identifier = normaliseIdentifier(input.identifier);
  if (!identifier) return { ok: false, kind: "invalid_identifier" };

  const gate = await checkThrottle(identifier.value, "otp_request");
  if (!gate.allowed) return throttled(gate);

  const supabase = await clientFrom(deps);
  const { error } = await supabase.auth.signInWithOtp({
    ...(identifier.kind === "phone" ? { phone: identifier.value } : { email: identifier.value }),
    options: {
      shouldCreateUser: true,
      // Read back on the first successful verification and written into the
      // profile row. Not roles: user_metadata is user-writable, and a role that
      // a user can write is not a role.
      data: {
        full_name: input.fullName.trim(),
        wants_to_buy: input.wantsToBuy,
        wants_to_list: input.wantsToList,
      },
    },
  });

  await recordAttempt({
    identifier: identifier.value,
    kind: "otp_request",
    succeeded: !error,
    ip: input.ip ?? null,
  });

  if (error) return fromSupabaseError(error);
  return { ok: true, kind: "code_sent", identifier, masked: maskIdentifier(identifier) };
}

export interface VerifyInput {
  identifier: string;
  code: string;
  ip?: string | null;
  /** Where to land. Validated against a same-origin path by the caller. */
  next?: string | null;
}

/**
 * Submit a code.
 *
 * On success this is also where a session first meets the profile row: roles
 * are written to `app_metadata`, which only the service role can write and
 * which `getActor` reads, and a suspended account is turned straight back out.
 */
export async function verifyCode(input: VerifyInput, deps: AuthDeps = {}): Promise<AuthOutcome> {
  const identifier = normaliseIdentifier(input.identifier);
  if (!identifier) return { ok: false, kind: "invalid_identifier" };

  const code = input.code.replace(/\D/g, "");
  if (!code) return { ok: false, kind: "code_incorrect" };

  const gate = await checkThrottle(identifier.value, "otp_verify");
  if (!gate.allowed) return throttled(gate);

  const supabase = await clientFrom(deps);
  const { data, error } = await supabase.auth.verifyOtp(
    identifier.kind === "phone"
      ? { phone: identifier.value, token: code, type: "sms" }
      : { email: identifier.value, token: code, type: "email" },
  );

  if (error || !data.user) {
    await recordAttempt({
      identifier: identifier.value,
      kind: "otp_verify",
      succeeded: false,
      ip: input.ip ?? null,
    });
    /*
     * Always "that code did not match", never "expired".
     *
     * Supabase answers a wrong code and an expired one identically —
     * `otp_expired`, "Token has expired or is invalid" — and it is right to:
     * telling somebody a code expired confirms it was once valid, which is a
     * free bit for anybody guessing. So this screen does not claim to know,
     * and the copy covers both by offering a fresh code.
     *
     * `link_expired` is a link state, not a code state. It comes from
     * app/auth/callback/route.ts, where Supabase does say so explicitly in the
     * query string, and it is the state board 7a draws.
     */
    return { ok: false, kind: "code_incorrect" };
  }

  await recordAttempt({
    identifier: identifier.value,
    kind: "otp_verify",
    succeeded: true,
    ip: input.ip ?? null,
  });

  const profile = await adoptProfile(data.user.id, identifier, data.user.user_metadata ?? {});

  if (profile.suspendedAt) {
    // Out again immediately. A suspended account holding a live session is a
    // suspended account that is not suspended.
    await supabase.auth.signOut();
    return { ok: false, kind: "suspended", since: profile.suspendedAt };
  }

  return {
    ok: true,
    kind: "signed_in",
    userId: data.user.id,
    destination: destinationFor(profile.roles, input.next ?? null),
  };
}

/**
 * The profile row behind a Supabase user, created or adopted.
 *
 * Two cases only, and that is the point of how provisional identities are
 * made. A buyer who sends an enquiry without signing up gets a real Supabase
 * user — unverified, with nothing but a phone number — and a profile row that
 * shares its id. See `createProvisionalIdentity`. So when they later verify a
 * code, the row is already theirs and claiming it is a flag, not a merge.
 *
 * The alternative was to create the profile row with an id of our own and
 * re-key it on first sign-in. That means updating a primary key that Enquiry,
 * Message, Review, ReviewRequest and SupplierReport all point at, under
 * foreign keys that are ON UPDATE NO ACTION — so it fails — and the fix for
 * that is either cascading updates everywhere or a hand-written list of
 * dependents that the next relation quietly falls off. Matching the ids from
 * the start costs nothing and removes the whole class of problem.
 *
 * Roles are mirrored into `app_metadata` here because that is what `getActor`
 * reads, and only the service role may write it.
 */
async function adoptProfile(
  userId: string,
  identifier: Identifier,
  metadata: Record<string, unknown>,
) {
  const fullName = typeof metadata["full_name"] === "string" ? metadata["full_name"] : null;
  const wantsToList = metadata["wants_to_list"] === true;

  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, roles: true, suspendedAt: true, businessId: true, isProvisional: true },
  });

  if (existing?.isProvisional) {
    // Claimed. The row keeps its id, so every enquiry sent before signing up
    // is already attached to the account that just came into being.
    const claimed = await prisma.user.update({
      where: { id: userId },
      data: {
        isProvisional: false,
        claimedAt: new Date(),
        claimToken: null,
        ...(fullName ? { fullName } : {}),
        ...(wantsToList ? { wantsToList: true } : {}),
        ...(existing.roles.length === 0 ? { roles: ["buyer" as Role] } : {}),
      },
      select: { id: true, roles: true, suspendedAt: true, businessId: true },
    });
    await syncClaims(userId, claimed.roles, claimed.businessId);
    return claimed;
  }

  if (existing) {
    await syncClaims(userId, existing.roles, existing.businessId);
    return existing;
  }

  const profile = await prisma.user.create({
    data: {
      id: userId,
      fullName,
      ...(identifier.kind === "phone" ? { phone: identifier.value } : { email: identifier.value }),
      // Always `buyer`. `seller_owner` is scoped to a business and there is no
      // business until the claim flow in handoff 3 attaches one, so granting it
      // here would grant it over nothing.
      roles: ["buyer"],
      wantsToList,
    },
    select: { id: true, roles: true, suspendedAt: true, businessId: true },
  });

  await syncClaims(userId, profile.roles, profile.businessId);
  return profile;
}

/**
 * A lightweight identity for a buyer who has not signed up.
 *
 * The README is explicit that requiring signup before the first enquiry is the
 * fastest way to kill the funnel, so the enquiry flow in step 3 calls this
 * instead: capture the mobile, create the identity, let them claim it later.
 *
 * It is a real Supabase user, unverified, plus a profile row sharing its id —
 * see `adoptProfile` for why the ids have to match. It holds no roles until it
 * is claimed, so it can own an enquiry and do nothing else.
 *
 * Returns the existing profile if that number is already known, provisional or
 * not. Two people cannot share a mobile, and a second enquiry from the same
 * number is the same buyer.
 */
export async function createProvisionalIdentity(input: {
  phone: string;
  fullName?: string | null;
}): Promise<{ userId: string; created: boolean } | null> {
  const identifier = normaliseIdentifier(input.phone);
  if (!identifier || identifier.kind !== "phone") return null;

  const known = await prisma.user.findFirst({
    where: { phone: identifier.value },
    select: { id: true },
  });
  if (known) return { userId: known.id, created: false };

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    phone: identifier.value.replace(/^\+/, ""),
    phone_confirm: false,
    user_metadata: { full_name: input.fullName?.trim() ?? null, provisional: true },
  });
  if (error || !data.user) return null;

  await prisma.user.create({
    data: {
      id: data.user.id,
      phone: identifier.value,
      fullName: input.fullName?.trim() ?? null,
      // No roles. It can own an enquiry and nothing else until it is claimed.
      roles: [],
      isProvisional: true,
      claimToken: randomUUID(),
    },
  });

  return { userId: data.user.id, created: true };
}

/** Mirror roles into the JWT claim `getActor` reads. Service role only. */
async function syncClaims(userId: string, roles: readonly Role[], businessId: string | null) {
  try {
    await createAdminClient().auth.admin.updateUserById(userId, {
      app_metadata: { roles, ...(businessId ? { business_id: businessId } : {}) },
    });
  } catch (cause) {
    // The session is valid; it just has no roles yet, so it can browse and not
    // much else. Failing the sign-in over this would be worse than a thin
    // session the next request repairs.
    console.error("[auth] could not write app_metadata roles", { userId, cause });
  }
}

export async function requestPasswordReset(
  input: StartInput & { redirectTo: string },
  deps: AuthDeps = {},
): Promise<AuthOutcome> {
  const identifier = normaliseIdentifier(input.identifier);
  if (!identifier || identifier.kind !== "email") return { ok: false, kind: "invalid_identifier" };

  const gate = await checkThrottle(identifier.value, "reset_request");
  if (!gate.allowed) return throttled(gate);

  const supabase = await clientFrom(deps);
  const { error } = await supabase.auth.resetPasswordForEmail(identifier.value, {
    redirectTo: input.redirectTo,
  });

  await recordAttempt({
    identifier: identifier.value,
    kind: "reset_request",
    succeeded: !error,
    ip: input.ip ?? null,
  });

  // Neutral either way, for the same reason as sign-in.
  return { ok: true, kind: "reset_sent", masked: maskIdentifier(identifier) };
}

function throttled(
  gate: Exclude<Awaited<ReturnType<typeof checkThrottle>>, { allowed: true }>,
): AuthOutcome {
  return gate.reason === "cooldown"
    ? { ok: false, kind: "cooldown", retryAfterSeconds: retryAfterSeconds(gate) }
    : { ok: false, kind: "too_many_attempts", retryAfterSeconds: retryAfterSeconds(gate), limit: gate.limit };
}

/**
 * Turn a Supabase auth error into one of our states.
 *
 * Only used where the failure is safe to describe. Sign-in stays deliberately
 * neutral; sign-up does not, because an address that does not exist is the
 * user's own typo and there is nothing to enumerate.
 *
 * Matching on `code` rather than the message. The message is prose, it is
 * user-facing on Supabase's side, and it changes.
 */
export function fromSupabaseError(error: {
  code?: string;
  status?: number;
  message?: string;
}): AuthOutcome {
  switch (error.code) {
    case "email_address_invalid":
    case "validation_failed":
      return { ok: false, kind: "invalid_identifier" };
    case "over_email_send_rate_limit":
    case "over_sms_send_rate_limit":
    case "over_request_rate_limit":
      // Supabase's own limit, hit before ours. It does not tell us for how
      // long, and its default window is an hour.
      return { ok: false, kind: "too_many_attempts", retryAfterSeconds: 3600, limit: 0 };
    case "signup_disabled":
    case "email_provider_disabled":
    case "phone_provider_disabled":
      return { ok: false, kind: "unavailable" };
    default:
      return { ok: false, kind: "delivery_failed" };
  }
}

/**
 * Where a fresh session lands.
 *
 * `next` wins where it is safe, because somebody who was sent to sign in from a
 * storefront wants the storefront back.
 *
 * A buyer with no `next` goes to the home page rather than to
 * `/account/enquiries`, which docs/routes.md names and step 3 of this handoff
 * builds. Landing a new account on a 404 is worse than landing it on the
 * directory. Change this line when that route exists.
 */
export function destinationFor(roles: readonly Role[], next: string | null): string {
  if (next && isSafeNext(next)) return next;
  if (roles.some((r) => r.startsWith("seller_"))) return "/dashboard/leads";
  return "/";
}

/**
 * A `next` from a query string is attacker-controlled. Same-origin absolute
 * paths only: no scheme, no host, and no `//host` which a browser reads as
 * protocol-relative and follows off-site.
 */
export function isSafeNext(next: string): boolean {
  return next.startsWith("/") && !next.startsWith("//") && !next.includes("\\");
}

