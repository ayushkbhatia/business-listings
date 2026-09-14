import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { Prisma } from "@/lib/db/generated/client";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentLegalVersions } from "@/lib/legal/documents";
import { checkAddressThrottle, checkThrottle, recordAttempt, remainingAttempts } from "./attempts";
import { maskIdentifier, normaliseIdentifier, type Identifier } from "./identity";
import { retryAfterSeconds, SIGNUP_ADDRESS_CEILING } from "./throttle";
import type { Role } from "./roles";
import { isSafeNext } from "./next-path";
import type { SupabaseClient, User as AuthUser } from "@supabase/supabase-js";

/**
 * The auth flow, as a service.
 *
 * Board 7a draws four states — sign in, sign up, verify, reset — and the
 * failures that go with them: link expired, too many attempts, account
 * suspended. Every one is an outcome of these functions, returned as a value
 * rather than thrown, because every one of them is a screen somebody has to be
 * shown rather than an error somebody has to debug.
 *
 * Supabase owns the code and the password hash. It generates, stores, expires
 * and verifies the OTP; we deliver it and decide who is allowed to ask. See
 * docs/auth-whatsapp-otp.md for why, and for what remains switched off on the
 * Supabase side. Passwords are in ./password.ts and reset grants in ./reset.ts;
 * both finish through `settleSession` here, so a session is seated, checked for
 * suspension and landed by one function whichever door it came through.
 *
 * Every function takes an optional Supabase client. The default reads the
 * request's cookies, which only exists inside a request — injecting one is what
 * lets tests/integration/auth-flow.test.ts drive the real thing against the
 * real Supabase project without a browser.
 */
export interface AuthDeps {
  supabase?: SupabaseClient;
}

export async function clientFrom(deps: AuthDeps): Promise<SupabaseClient> {
  return deps.supabase ?? ((await createClient()) as unknown as SupabaseClient);
}

/** Where a code went. The verify screen names the carrier it actually used. */
export type CodeChannel = "sms" | "email";

/** What a verified code is for. A reset mints a grant instead of landing. */
export type CodePurpose = "signin" | "reset";

/** Every way the screens can end. One string, one screen. */
export type AuthOutcome =
  | {
      ok: true;
      kind: "code_sent";
      identifier: Identifier;
      masked: string;
      channel: CodeChannel;
      /** True when the mobile could not be reached and the code went to the email instead. */
      fellBack?: boolean;
    }
  | { ok: true; kind: "signed_in"; userId: string; destination: string }
  | { ok: true; kind: "reset_sent"; masked: string }
  /** A code verified for a reset. The token becomes the grant cookie and never a URL. */
  | { ok: true; kind: "reset_granted"; token: string }
  | { ok: false; kind: "invalid_identifier" }
  | { ok: false; kind: "invalid_phone" }
  | { ok: false; kind: "invalid_email" }
  | { ok: false; kind: "name_required" }
  | { ok: false; kind: "terms_required" }
  | { ok: false; kind: "email_taken" }
  | { ok: false; kind: "phone_taken" }
  | { ok: false; kind: "cooldown"; retryAfterSeconds: number }
  | { ok: false; kind: "too_many_attempts"; retryAfterSeconds: number; limit: number }
  | { ok: false; kind: "code_incorrect"; attemptsLeft: number }
  | { ok: false; kind: "password_required" }
  | { ok: false; kind: "password_incorrect"; attemptsLeft: number }
  /** Board 7a `B5`: the password door is shut and the code door is not. */
  | { ok: false; kind: "password_locked"; retryAfterSeconds: number }
  | { ok: false; kind: "link_expired" }
  | { ok: false; kind: "suspended" }
  | { ok: false; kind: "delivery_failed" }
  | { ok: false; kind: "identifier_taken" }
  | { ok: false; kind: "unavailable" }
  /** Mobile codes are switched off platform-wide. Says so, and names the email. */
  | { ok: false; kind: "sms_unavailable" };

export interface StartInput {
  /** As typed. Normalised here, never by the caller. */
  identifier: string;
  ip?: string | null;
}

/**
 * Supabase refusals that are true of the platform rather than of an account.
 *
 * Sign-in says the same thing whether or not the account exists. A trade
 * directory publishes supplier numbers on their storefronts, so enumerating
 * those is worthless — but buyer numbers are not published, and this is the one
 * place they could be checked one at a time. The cost of the neutral answer is
 * that a typo waits for a code that never comes, which the verify screen
 * softens by naming the masked number it sent to.
 *
 * That neutrality is about *whether the account exists*. A refusal about the
 * platform — the provider is off, the whole endpoint is rate-limited — is the
 * same for every identifier, so it tells nobody anything and is reported. It
 * used to be swallowed with the rest, and with the phone provider switched off
 * the screen sent everybody to `/verify` to wait for a code that did not exist.
 */
const NON_ENUMERATING = new Set([
  "signup_disabled",
  "email_provider_disabled",
  "phone_provider_disabled",
  // Not `sms_send_failed`. Supabase only reaches the delivery hook for an
  // account that exists, so reporting a failed delivery on sign-in would say
  // which numbers have accounts whenever the carrier is down. Sign-up may say
  // it, and does — see PHONE_UNDELIVERABLE.
  "over_email_send_rate_limit",
  "over_sms_send_rate_limit",
  "over_request_rate_limit",
]);

/**
 * Refusals that mean *mobile codes cannot be delivered right now*, for anybody.
 *
 * Checked against production on 14 Sep 2026: of 398 auth users, 377 hold a
 * phone and none has ever confirmed one, because the phone provider is off and
 * Meta has not approved the WhatsApp template. A sign-up that insisted on the
 * mobile would be a sign-up nobody can finish, so these send the code to the
 * email instead and the verify screen says why.
 */
const PHONE_UNDELIVERABLE = new Set(["phone_provider_disabled", "sms_send_failed", "over_sms_send_rate_limit"]);

function codeOf(error: { code?: string } | null | undefined): string | undefined {
  return error?.code ?? undefined;
}

export async function startSignIn(input: StartInput, deps: AuthDeps = {}): Promise<AuthOutcome> {
  const identifier = normaliseIdentifier(input.identifier);
  if (!identifier) return { ok: false, kind: "invalid_identifier" };
  return sendExistingAccountCode(identifier, input.ip ?? null, deps);
}

/**
 * A code to an account that already exists, without saying whether it does.
 * Shared by sign-in, the lockout's "send me a code instead" and a mobile reset.
 */
export async function sendExistingAccountCode(
  identifier: Identifier,
  ip: string | null,
  deps: AuthDeps = {},
): Promise<AuthOutcome> {
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
    ip,
  });

  const code = codeOf(error);
  if (error && code && NON_ENUMERATING.has(code)) {
    if (identifier.kind === "phone" && PHONE_UNDELIVERABLE.has(code)) {
      return { ok: false, kind: "sms_unavailable" };
    }
    return fromSupabaseError(error);
  }

  return {
    ok: true,
    kind: "code_sent",
    identifier,
    masked: maskIdentifier(identifier),
    channel: identifier.kind === "phone" ? "sms" : "email",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sign up
// ─────────────────────────────────────────────────────────────────────────────

export interface SignUpInput {
  fullName: string;
  /** As typed. Board 7a: mobile is the primary identity, with `+971` pre-filled. */
  phone: string;
  /** As typed. Collected as "work email" — see Q5. */
  email: string;
  /** Board 7a `B1`: which door, not which product. Decides the landing only. */
  intent: "buying" | "listing";
  termsAccepted: boolean;
  /** "Use email instead" on the verify screen. */
  prefer?: CodeChannel;
  ip?: string | null;
  now?: Date;
}

/**
 * What a sign-up carries to the moment its code is verified.
 *
 * Stored on the Supabase user's `user_metadata`, and read once, by
 * `adoptProfile`, when the profile row is first created or claimed. It is
 * user-writable metadata, so nothing in it is a permission: never roles, never
 * a business. The terms acceptance is the person's own statement about
 * themselves, taken at the moment the form was sent — and there is no session
 * with which to rewrite it until after it has been recorded.
 */
interface SignUpMetadata {
  full_name: string;
  wants_to_list: boolean;
  signup_phone: string;
  signup_email: string;
  terms_version: string;
  privacy_version: string;
  terms_accepted_at: string;
}

/**
 * Create an account and send a code.
 *
 * Three facts decide how, in this order.
 *
 * **Who already holds the mobile.** A provisional identity — a buyer who sent an
 * enquiry without signing up — is adopted rather than duplicated, so their
 * enquiries come with them. A real account is a sign-in: the code goes to that
 * account and nothing about it changes.
 *
 * **Who already holds the email.** If a different real account holds it, the
 * answer is to sign in there, not to make a second account that would fork the
 * person — board 7a `B1` is one account for both roles.
 *
 * **Whether a mobile can be reached at all.** The code goes to the mobile
 * first. When the platform cannot deliver to mobiles, it goes to the email and
 * `fellBack` tells the verify screen to say so.
 */
export async function startSignUp(input: SignUpInput, deps: AuthDeps = {}): Promise<AuthOutcome> {
  const fullName = input.fullName.trim();
  if (!fullName) return { ok: false, kind: "name_required" };

  const phone = normaliseIdentifier(input.phone);
  if (!phone || phone.kind !== "phone") return { ok: false, kind: "invalid_phone" };
  const email = normaliseIdentifier(input.email);
  if (!email || email.kind !== "email") return { ok: false, kind: "invalid_email" };
  if (!input.termsAccepted) return { ok: false, kind: "terms_required" };

  const now = input.now ?? new Date();
  const versions = currentLegalVersions(now);
  const metadata: SignUpMetadata = {
    full_name: fullName,
    wants_to_list: input.intent === "listing",
    signup_phone: phone.value,
    signup_email: email.value,
    terms_version: versions.terms,
    privacy_version: versions.privacy,
    terms_accepted_at: now.toISOString(),
  };

  const ip = input.ip ?? null;

  const address = await checkAddressThrottle(ip, "otp_request", now, SIGNUP_ADDRESS_CEILING);
  if (!address.allowed) return throttled(address);

  const [byPhone, byEmail] = await Promise.all([
    prisma.user.findUnique({
      where: { phone: phone.value },
      select: { id: true, email: true, isProvisional: true },
    }),
    prisma.user.findUnique({
      where: { email: email.value },
      select: { id: true, isProvisional: true },
    }),
  ]);

  if (byEmail && byEmail.id !== byPhone?.id && !byEmail.isProvisional) {
    await recordSignUpRefusal(ip);
    return { ok: false, kind: "email_taken" };
  }

  const supabase = await clientFrom(deps);

  // A real account already holds this mobile. Said plainly, the way an email on
  // another account is: sign-up is not neutral (an address you typed is your
  // own), and quietly turning it into a sign-in sent a code to an account that
  // might have no Supabase user at all — every seeded seat is one — and left the
  // person waiting on a screen for a code that was never going to exist.
  if (byPhone && !byPhone.isProvisional) {
    await recordSignUpRefusal(ip);
    return { ok: false, kind: "phone_taken" };
  }

  if (input.prefer !== "email") {
    const gate = await checkThrottle(phone.value, "otp_request");
    if (!gate.allowed) return throttled(gate);

    if (byPhone?.isProvisional) {
      await mergeMetadata(byPhone.id, metadata);
    }

    const { error } = await supabase.auth.signInWithOtp({
      phone: phone.value,
      options: {
        // A provisional identity already has its Supabase user; everybody else
        // gets one now, because the delivery hook needs a user to send for.
        shouldCreateUser: !byPhone,
        data: { ...metadata },
      },
    });

    await recordAttempt({ identifier: phone.value, kind: "otp_request", succeeded: !error, ip });

    if (!error) {
      return { ok: true, kind: "code_sent", identifier: phone, masked: maskIdentifier(phone), channel: "sms" };
    }
    // `otp_disabled` here is "signups not allowed" for mobiles — a platform
    // setting, not this person — so it falls back like an undeliverable mobile.
    // On sign-in the same code means "no such user", which is why it is not in
    // PHONE_UNDELIVERABLE.
    if (!PHONE_UNDELIVERABLE.has(codeOf(error) ?? "") && codeOf(error) !== "otp_disabled") {
      return fromSupabaseError(error);
    }

    // The provider being off refuses before a user is created. A failed
    // delivery refuses after — the hook needed the user to send for — so only
    // then is there a user holding this mobile to find.
    return sendSignUpCodeByEmail({
      phone,
      email,
      metadata,
      holderId: byPhone?.id ?? (codeOf(error) === "sms_send_failed" ? await findAuthUserByPhone(phone.value) : undefined) ?? null,
      ip,
      input,
      supabase,
    });
  }

  return sendSignUpCodeByEmail({ phone, email, metadata, holderId: byPhone?.id ?? null, ip, input, supabase });
}

/**
 * The email half of a sign-up, for when the mobile cannot be reached or the
 * person asked for email.
 *
 * One Supabase user per person, whichever carrier the code used. Where a user
 * already holds the mobile — a provisional identity, or the one the failed SMS
 * attempt just created — the email is attached to *that* user before the code
 * is sent, so verifying it seats the same account the enquiries hang from. The
 * address is attached unconfirmed; receiving the code there is what confirms
 * it. Otherwise a new user is created on the email, carrying the mobile in its
 * metadata for `adoptProfile` to write onto the profile.
 */
async function sendSignUpCodeByEmail(args: {
  phone: Identifier;
  email: Identifier;
  metadata: SignUpMetadata;
  /** The Supabase user that already holds the mobile, where one does. */
  holderId: string | null;
  ip: string | null;
  input: SignUpInput;
  supabase: SupabaseClient;
}): Promise<AuthOutcome> {
  const { email, metadata, ip, supabase } = args;

  const gate = await checkThrottle(email.value, "otp_request");
  if (!gate.allowed) return throttled(gate);

  const { holderId } = args;

  if (holderId) {
    const attached = await attachEmail(holderId, email.value, metadata);
    if (attached === "taken") return { ok: false, kind: "email_taken" };
    if (attached === "failed") return { ok: false, kind: "unavailable" };
  }

  const { error } = await supabase.auth.signInWithOtp({
    email: email.value,
    options: { shouldCreateUser: !holderId, data: { ...metadata } },
  });

  await recordAttempt({ identifier: email.value, kind: "otp_request", succeeded: !error, ip });

  if (error) return fromSupabaseError(error);
  return {
    ok: true,
    kind: "code_sent",
    identifier: email,
    masked: maskIdentifier(email),
    channel: "email",
    fellBack: args.input.prefer !== "email",
  };
}

/**
 * A sign-up refused because an identifier is taken, counted against the address
 * that asked — see `SIGNUP_ADDRESS_CEILING`. Keyed `ip:` rather than on the
 * identifier, so the refusal spends nothing of the account it names.
 */
async function recordSignUpRefusal(ip: string | null): Promise<void> {
  if (!ip) return;
  await recordAttempt({ identifier: `ip:${ip}`, kind: "otp_request", succeeded: false, ip });
}

/** Merge sign-up fields into an existing Supabase user's metadata. Best-effort. */
async function mergeMetadata(userId: string, metadata: SignUpMetadata): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data } = await admin.auth.admin.getUserById(userId);
    await admin.auth.admin.updateUserById(userId, {
      user_metadata: { ...(data.user?.user_metadata ?? {}), ...metadata, provisional: false },
    });
  } catch (cause) {
    console.error("[auth] could not merge sign-up metadata", { userId, cause });
  }
}

async function attachEmail(
  userId: string,
  email: string,
  metadata: SignUpMetadata,
): Promise<"attached" | "taken" | "failed"> {
  const admin = createAdminClient();
  const { data: current } = await admin.auth.admin.getUserById(userId);
  if (current.user?.email && current.user.email.toLowerCase() !== email) {
    // The user already answers to a different address. Never overwrite a
    // sign-in address from a sign-up form.
    return "taken";
  }
  const { error } = await admin.auth.admin.updateUserById(userId, {
    ...(current.user?.email ? {} : { email, email_confirm: false }),
    user_metadata: { ...(current.user?.user_metadata ?? {}), ...metadata, provisional: false },
  });
  if (!error) return "attached";
  if (error.code === "email_exists" || error.status === 422) return "taken";
  console.error("[auth] could not attach an email to a sign-up", { userId, code: error.code });
  return "failed";
}

// ─────────────────────────────────────────────────────────────────────────────
// Verify
// ─────────────────────────────────────────────────────────────────────────────

export interface VerifyInput {
  identifier: string;
  code: string;
  ip?: string | null;
  /** Where to land. Validated against a same-origin path by the caller. */
  next?: string | null;
  /** Board 7a `B2`: a verified code can be the way into a password reset. */
  purpose?: CodePurpose;
}

/**
 * Submit a code.
 *
 * On success this is also where a session first meets the profile row — see
 * `settleSession`. For a reset, the verified code mints a single-use grant
 * rather than landing anywhere: recovery works from the mobile alone.
 */
export async function verifyCode(input: VerifyInput, deps: AuthDeps = {}): Promise<AuthOutcome> {
  const identifier = normaliseIdentifier(input.identifier);
  if (!identifier) return { ok: false, kind: "invalid_identifier" };

  const code = input.code.replace(/\D/g, "");

  const gate = await checkThrottle(identifier.value, "otp_verify");
  if (!gate.allowed) return throttled(gate);

  if (!code) return { ok: false, kind: "code_incorrect", attemptsLeft: await remainingAttempts(identifier.value, "otp_verify") };

  const supabase = await clientFrom(deps);
  const { data, error } = await supabase.auth.verifyOtp(
    identifier.kind === "phone"
      ? { phone: identifier.value, token: code, type: "sms" }
      : { email: identifier.value, token: code, type: "email" },
  );

  if (error || !data.user) {
    await recordAttempt({ identifier: identifier.value, kind: "otp_verify", succeeded: false, ip: input.ip ?? null });
    /*
     * Always "that code did not match", never "expired".
     *
     * Supabase answers a wrong code and an expired one identically —
     * `otp_expired`, "Token has expired or is invalid" — and it is right to:
     * telling somebody a code expired confirms it was once valid, which is a
     * free bit for anybody guessing. So this screen does not claim to know,
     * and the copy covers both by offering a fresh code.
     *
     * Board 7a: *attempt counted, remaining attempts stated*. The count is read
     * back after the failure is written, so it is the number the next refusal
     * enforces — and the fifth wrong code is the lockout itself, not a screen
     * saying "0 attempts left" above a form that still takes one.
     */
    const left = await remainingAttempts(identifier.value, "otp_verify");
    if (left === 0) {
      const locked = await checkThrottle(identifier.value, "otp_verify");
      if (!locked.allowed) return throttled(locked);
    }
    return { ok: false, kind: "code_incorrect", attemptsLeft: left };
  }

  await recordAttempt({ identifier: identifier.value, kind: "otp_verify", succeeded: true, ip: input.ip ?? null });

  const settled = await settleSession(supabase, data.user, identifier, input.next ?? null);
  if (!settled.ok || input.purpose !== "reset") return settled;

  const { issueResetGrant } = await import("./reset");
  const token = await issueResetGrant({
    userId: data.user.id,
    channel: identifier.kind === "phone" ? "sms" : "email",
    ip: input.ip ?? null,
  });
  return { ok: true, kind: "reset_granted", token };
}

/**
 * The one way a fresh Supabase session becomes a seated one.
 *
 * Every door ends here — a verified code, a password, a new password saved from
 * a reset — so the three things that must be true of a session are decided once:
 *
 *   1. **It has a profile row**, created or claimed (`adoptProfile`), with the
 *      roles claim mirrored into `app_metadata`.
 *   2. **It is not suspended.** Out again immediately if it is; a suspended
 *      account holding a live session is a suspended account that is not
 *      suspended. The reason is never returned — board 7a `B7`.
 *   3. **It lands somewhere true** — `landingFor`, which knows about a closure
 *      in its cooling-off window (Q2).
 */
export async function settleSession(
  supabase: SupabaseClient,
  user: AuthUser,
  identifier: Identifier,
  next: string | null,
): Promise<AuthOutcome> {
  const profile = await adoptProfile(user.id, identifier, user.user_metadata ?? {});

  if (profile === "identifier_taken") {
    // Verified and still cannot be seated. Out again, so the session does not
    // linger with no profile behind it.
    await supabase.auth.signOut();
    return { ok: false, kind: "identifier_taken" };
  }

  if (profile.suspendedAt) {
    await supabase.auth.signOut();
    return { ok: false, kind: "suspended" };
  }

  return {
    ok: true,
    kind: "signed_in",
    userId: user.id,
    destination: await landingFor(user.id, profile.roles, next, profile.wantsToList),
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
 * Board 7a adds two things to the first seating, and only to the first: the
 * other identifier from the sign-up form, where nobody else holds it, and the
 * terms acceptance with its versions and the time the box was ticked (`B10`).
 * An existing account signing in again changes neither.
 *
 * Roles are mirrored into `app_metadata` here because that is what `getActor`
 * reads, and only the service role may write it.
 */
async function adoptProfile(userId: string, identifier: Identifier, metadata: Record<string, unknown>) {
  const fullName = typeof metadata["full_name"] === "string" ? metadata["full_name"] : null;
  const wantsToList = metadata["wants_to_list"] === true;
  const select = { id: true, roles: true, suspendedAt: true, businessId: true, wantsToList: true } as const;

  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { ...select, isProvisional: true, phone: true, email: true },
  });

  if (existing && !existing.isProvisional) {
    await syncClaims(userId, existing.roles, existing.businessId);
    return existing;
  }

  const secondary = await secondaryIdentifier(userId, identifier, metadata, existing);

  try {
    if (existing?.isProvisional) {
      return await claimProvisional();
    }
    return await createProfile();
  } catch (error) {
    /*
       `User.email` and `User.phone` are both unique, and the row that holds
       this one has a different id — so it cannot be adopted and cannot be
       created.

       Every seeded staff seat and seller owner is exactly this: `seed.mts`
       mints their ids itself, so none of them corresponds to a Supabase auth
       user. Signing up as one used to throw a raw Prisma error straight out
       through the server action, which reached the browser as a 500 — "the site
       is broken" rather than "this account cannot be signed into", which are
       very different things to be told.
    */
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      console.error("[auth] identifier already held by a profile with another id", {
        userId,
        kind: identifier.kind,
      });
      return "identifier_taken" as const;
    }
    throw error;
  }

  async function claimProvisional() {
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
        ...(existing!.roles.length === 0 ? { roles: ["buyer" as Role] } : {}),
        ...(identifier.kind === "email" && !existing!.email ? { email: identifier.value } : {}),
        ...secondary,
      },
      select,
    });
    await recordTermsAcceptance(userId, metadata);
    await syncClaims(userId, claimed.roles, claimed.businessId);
    return claimed;
  }

  async function createProfile() {
    const profile = await prisma.user.create({
      data: {
        id: userId,
        fullName,
        ...(identifier.kind === "phone" ? { phone: identifier.value } : { email: identifier.value }),
        ...secondary,
        // Always `buyer`. `seller_owner` is scoped to a business and there is no
        // business until the claim flow attaches one, so granting it here would
        // grant it over nothing. Board 7a `B1`: the second role is added later
        // on the same account, never by a second one.
        roles: ["buyer"],
        wantsToList,
      },
      select,
    });

    await recordTermsAcceptance(userId, metadata);
    await syncClaims(userId, profile.roles, profile.businessId);
    return profile;
  }
}

/**
 * The sign-up form's other identifier, for the profile row — only where nobody
 * else holds it.
 *
 * A code proves one of the two. The other is written as it was typed, and
 * attached to the Supabase user unconfirmed so that it works as a sign-in
 * address later: a code sent there is what confirms it. If another account
 * already holds it, it is left off rather than failing a sign-in the person has
 * just earned.
 */
async function secondaryIdentifier(
  userId: string,
  identifier: Identifier,
  metadata: Record<string, unknown>,
  existing: { phone: string | null; email: string | null } | null,
): Promise<{ phone?: string; email?: string }> {
  const raw = identifier.kind === "phone" ? metadata["signup_email"] : metadata["signup_phone"];
  if (typeof raw !== "string") return {};
  const other = normaliseIdentifier(raw);
  if (!other || other.kind === identifier.kind) return {};
  if (other.kind === "email" ? existing?.email : existing?.phone) return {};

  const holder = await prisma.user.findFirst({
    where: other.kind === "email" ? { email: other.value } : { phone: other.value },
    select: { id: true },
  });
  if (holder && holder.id !== userId) return {};

  try {
    const { error } = await createAdminClient().auth.admin.updateUserById(
      userId,
      other.kind === "email"
        ? { email: other.value, email_confirm: false }
        : { phone: other.value.replace(/^\+/, ""), phone_confirm: false },
    );
    if (error) return {};
  } catch {
    return {};
  }

  return other.kind === "email" ? { email: other.value } : { phone: other.value };
}

/**
 * Board 7a `B10`. A version and a timestamp, never a boolean.
 *
 * `accepted_at` is the moment the form was sent, and it comes from metadata the
 * server wrote. It is clamped into the last day so a stale or edited value
 * cannot record an acceptance from before the account could have existed.
 */
async function recordTermsAcceptance(userId: string, metadata: Record<string, unknown>): Promise<void> {
  const terms = metadata["terms_version"];
  const privacy = metadata["privacy_version"];
  const at = metadata["terms_accepted_at"];
  if (typeof terms !== "string" || typeof privacy !== "string") return;

  const now = Date.now();
  const stated = typeof at === "string" ? Date.parse(at) : Number.NaN;
  const acceptedAt = new Date(
    Number.isFinite(stated) && stated <= now && stated >= now - 86_400_000 ? stated : now,
  );

  try {
    await prisma.termsAcceptance.createMany({
      data: [{ userId, termsVersion: terms, privacyVersion: privacy, acceptedAt, source: "signup" }],
      skipDuplicates: true,
    });
  } catch (cause) {
    // A malformed version fails the CHECK. The account is real either way, and
    // refusing a verified sign-in over the consent record would lose both.
    console.error("[auth] could not record the terms acceptance", { userId, cause });
  }
}

/**
 * A lightweight identity for a buyer who has not signed up.
 *
 * The README is explicit that requiring signup before the first enquiry is the
 * fastest way to kill the funnel, so the enquiry flow calls this instead:
 * capture the mobile, create the identity, let them claim it later. Board 7a
 * `B9` is the same rule from the other side — auth is deferred, not gating.
 *
 * It is a real Supabase user, unverified, plus a profile row sharing its id —
 * see `adoptProfile` for why the ids have to match. It holds no roles until it
 * is claimed, so it can own an enquiry and do nothing else.
 *
 * Returns the existing profile if that number is already known, provisional or
 * not. Two people cannot share a mobile, and a second enquiry from the same
 * number is the same buyer.
 *
 * It also recovers from the two stores having drifted apart. A Supabase auth
 * user can outlive its profile row — a failed transaction, a half-finished
 * cleanup — and without this, `createUser` fails on the duplicate phone and
 * that number can never send an enquiry again. Finding the existing auth user
 * and rebuilding the profile beside it is the repair.
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

  let userId = data?.user?.id;

  if (!userId) {
    // The auth user may already exist with no profile row beside it. Adopt it
    // rather than leave this number permanently unable to send an enquiry.
    userId = await findAuthUserByPhone(identifier.value);
    if (!userId) {
      console.error("[auth] could not create a provisional identity", { cause: error?.message });
      return null;
    }
  }

  await prisma.user.create({
    data: {
      id: userId,
      phone: identifier.value,
      fullName: input.fullName?.trim() ?? null,
      // No roles. It can own an enquiry and nothing else until it is claimed.
      roles: [],
      isProvisional: true,
      claimToken: randomUUID(),
    },
  });

  return { userId, created: true };
}

/**
 * The Supabase auth user for a number, when one exists.
 *
 * The admin API has no lookup by phone, so this pages the list. It only runs on
 * drift paths — a createUser that failed on a duplicate, a sign-up whose SMS
 * attempt created a user and then could not deliver — so the cost lands on a
 * case that should be rare and would otherwise be unrecoverable.
 */
async function findAuthUserByPhone(e164: string): Promise<string | undefined> {
  const bare = e164.replace(/^\+/, "");
  const admin = createAdminClient();
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) return undefined;
    const found = data.users.find((u) => u.phone === bare || u.phone === e164);
    if (found) return found.id;
    if (data.users.length < 200) return undefined;
  }
  return undefined;
}

/**
 * The same write, for `getActor` to call when it finds a session whose claim
 * is empty and whose profile row is not.
 *
 * Exported rather than duplicated so there is one place that decides what the
 * claim contains. Still best-effort: a repair that throws would turn a page
 * that renders thin into a page that does not render.
 */
export async function repairClaims(
  userId: string,
  roles: readonly Role[],
  businessId: string | null,
): Promise<void> {
  await syncClaims(userId, roles, businessId);
}

/**
 * Mirror roles into the JWT claim `getActor` reads. Service role only.
 *
 * `business_id` is written as `null` rather than omitted when there is none.
 * Omitting it left the key untouched, so a claim could be written once and
 * never removed — a seller who left a business, or an id whose business no
 * longer exists, kept the stale value for good. `getActor` treats the profile
 * row as the truth and calls this to correct the claim, which only works if
 * "no business" is something this can actually say.
 */
async function syncClaims(userId: string, roles: readonly Role[], businessId: string | null) {
  try {
    await createAdminClient().auth.admin.updateUserById(userId, {
      app_metadata: { roles, business_id: businessId },
    });
  } catch (cause) {
    // The session is valid; it just has no roles yet, so it can browse and not
    // much else. Failing the sign-in over this would be worse than a thin
    // session the next request repairs.
    console.error("[auth] could not write app_metadata roles", { userId, cause });
  }
}

export function throttled(
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
 * user-facing on Supabase's side, and it changes — with one exception below,
 * where the number we need exists nowhere else.
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
    case "over_sms_send_rate_limit": {
      /*
         Two different refusals share these codes. The per-address frequency
         limit ("you can only request this after 37 seconds") is a cooldown with
         a number in the message and nowhere else; the hourly ceiling carries no
         number at all. Reading the first as the second told somebody to wait an
         hour for a limit that cleared in under a minute.
      */
      const seconds = /after (\d+) seconds?/i.exec(error.message ?? "")?.[1];
      if (seconds) return { ok: false, kind: "cooldown", retryAfterSeconds: Number(seconds) };
      return { ok: false, kind: "too_many_attempts", retryAfterSeconds: 3600, limit: 0 };
    }
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
 * Where a fresh session lands, knowing about a closure.
 *
 * Board 7a Q2, our position taken: *recognise `closure_requested` and offer the
 * reversal inline.* Board 11i closes an account with a fourteen-day cooling-off
 * window and revokes the owner's seat, so an owner who signs in on day two has
 * a password that works, no seat, and a listing that is down — none of the
 * failure states. Without this they land on the directory home page with no
 * sign that the one screen they need exists. `/dashboard/account/close` renders
 * the reversal for exactly that seatless owner.
 *
 * A safe `next` still wins, except into the dashboard: a revoked seat 404s
 * there, and the dashboard shell sends that owner to the same screen anyway.
 * Imported lazily because lib/closure/service imports this module.
 */
export async function landingFor(
  userId: string,
  roles: readonly Role[],
  next: string | null,
  wantsToList = false,
): Promise<string> {
  const safeNext = next && isSafeNext(next) ? next : null;
  const hasSeat = roles.some((r) => r.startsWith("seller_"));
  if (!hasSeat && (!safeNext || safeNext.startsWith("/dashboard"))) {
    const { openClosureOwnedBy } = await import("@/lib/closure/service");
    if (await openClosureOwnedBy(userId)) return "/dashboard/account/close";
  }
  return destinationFor(roles, next, wantsToList);
}

/**
 * Where a fresh session lands.
 *
 * `next` wins where it is safe, because somebody who was sent to sign in from a
 * storefront wants the storefront back.
 *
 * A buyer with no `next` lands in the buyer account — board 7a's *sign up,
 * buyer: lands in the buyer account*. `/account/enquiries` is that account's
 * front page, and it renders its own empty state for somebody who has sent
 * nothing yet.
 *
 * `wantsToList` is the intent captured at signup, not a role — `adoptProfile`
 * writes it and grants `buyer` regardless, because `seller_owner` is scoped to
 * a business and there is no business yet. Which is exactly the case this
 * handles: board 7a's *sign up, seller: lands in claim/onboarding*. It ranks
 * below the seller check, so a supplier who already has a business still gets
 * their dashboard.
 */
export function destinationFor(
  roles: readonly Role[],
  next: string | null,
  wantsToList = false,
): string {
  if (next && isSafeNext(next)) return next;
  /*
   * Staff before seller, because somebody can hold both — a small operations
   * team will have an ops lead who also owns a test listing — and the console
   * is the surface they signed in for. `/admin` is board 4a, which answers
   * "which of the six jobs is behind" and links into each of them.
   */
  if (roles.some((r) => r.startsWith("staff_"))) return "/admin";
  if (roles.some((r) => r.startsWith("seller_"))) return "/dashboard/leads";
  if (wantsToList) return "/onboarding/claim";
  return "/account/enquiries";
}

/*
   `isSafeNext` moved to ./next-path.ts and is re-exported here.

   This file is `server-only` — it imports Prisma and the Supabase admin client
   — and a same-origin path check is string work that both sides of the boundary
   need. Re-exported rather than relocated with a find-and-replace so the seven
   modules that already import it from here are untouched by that move.
*/
export { isSafeNext, signInHref } from "./next-path";
