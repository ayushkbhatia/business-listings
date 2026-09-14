import "server-only";
import { prisma } from "@/lib/db/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkAddressThrottle, checkThrottle, recordAttempt, remainingAttempts } from "./attempts";
import { clientFrom, settleSession, type AuthDeps, type AuthOutcome } from "./flow";
import { normaliseIdentifier, type Identifier } from "./identity";
import { loginIdentityFor } from "./reset";
import { retryAfterSeconds } from "./throttle";

/**
 * Board 7a, state one — sign in with a password.
 *
 * `signInWithPassword` appeared nowhere in this repository before this file,
 * while `/signin` offered "Use a password instead" and the reset screen wrote a
 * password nothing could read back. This is the reading half.
 *
 * ## Nothing assumes a password exists (`B3`)
 *
 * Most accounts never set one: a code needs none, and mobile is the primary
 * identity. So a wrong password and no password are the same answer, and the
 * answer names the way through — send yourself a code — rather than implying
 * the person has forgotten something they may never have had.
 *
 * ## A locked password leaves the code path open (`B5`)
 *
 * Wrong passwords are counted as `password_verify`, never `otp_verify`. The
 * lockout screen offers a code, and the backend honours that because the two
 * counts cannot touch. The per-address ceiling is a second, looser count for
 * one address walking a list of accounts.
 *
 * ## Neutral about whether the account exists
 *
 * A mistyped address, an account with no password, a wrong password: one
 * answer, and every one of them spends an attempt against the identifier as
 * typed. Not counting attempts against addresses with no account would make
 * the lockout itself an enumeration oracle.
 */

export interface PasswordSignInInput {
  identifier: string;
  password: string;
  next?: string | null;
  ip?: string | null;
}

/** Credential refusals. Everything else Supabase says is about the platform. */
const CREDENTIAL_REFUSALS = new Set(["invalid_credentials", "email_not_confirmed", "phone_not_confirmed"]);

export async function signInWithPassword(input: PasswordSignInInput, deps: AuthDeps = {}): Promise<AuthOutcome> {
  const identifier = normaliseIdentifier(input.identifier);
  if (!identifier) return { ok: false, kind: "invalid_identifier" };
  if (!input.password) return { ok: false, kind: "password_required" };

  const ip = input.ip ?? null;

  const [own, address] = await Promise.all([
    checkThrottle(identifier.value, "password_verify"),
    checkAddressThrottle(ip, "password_verify"),
  ]);
  const shut = !own.allowed ? own : !address.allowed ? address : null;
  if (shut) return { ok: false, kind: "password_locked", retryAfterSeconds: retryAfterSeconds(shut) };

  const login = await resolveLogin(identifier);

  const supabase = await clientFrom(deps);
  const { data, error } = await supabase.auth.signInWithPassword(
    login.kind === "email"
      ? { email: login.value, password: input.password }
      : { phone: login.value, password: input.password },
  );

  if (error || !data.user) {
    if (error && !CREDENTIAL_REFUSALS.has(error.code ?? "")) {
      // Not the person's mistake — a rate limit or an outage upstream. It
      // spends nothing of theirs and says so.
      console.error("[auth] password sign-in refused for a platform reason", { code: error.code, status: error.status });
      return error.code === "over_request_rate_limit"
        ? { ok: false, kind: "too_many_attempts", retryAfterSeconds: 3600, limit: 0 }
        : { ok: false, kind: "unavailable" };
    }

    await recordAttempt({ identifier: identifier.value, kind: "password_verify", succeeded: false, ip });
    const left = await remainingAttempts(identifier.value, "password_verify");
    if (left === 0) {
      const locked = await checkThrottle(identifier.value, "password_verify");
      return { ok: false, kind: "password_locked", retryAfterSeconds: retryAfterSeconds(locked) };
    }
    return { ok: false, kind: "password_incorrect", attemptsLeft: left };
  }

  await recordAttempt({ identifier: identifier.value, kind: "password_verify", succeeded: true, ip });
  return settleSession(supabase, data.user, identifier, input.next ?? null);
}

/**
 * The identity to name to Supabase for the account behind what was typed.
 *
 * One account answers to its mobile and its email, but Supabase's password
 * grant takes one of them, and only for an identity the Supabase user actually
 * holds. Someone who signed up by email and types their mobile here would be
 * refused by a grant that names the mobile. So what was typed is resolved to the
 * profile, and the profile to the identity Supabase holds — email first, because
 * the email provider is on in every environment and the phone provider is not.
 *
 * Where there is no profile, what was typed goes through unchanged, so the
 * refusal comes from the same call and costs the same attempt as any other.
 */
async function resolveLogin(identifier: Identifier): Promise<Identifier> {
  const profile = await prisma.user.findUnique({
    where: identifier.kind === "phone" ? { phone: identifier.value } : { email: identifier.value },
    select: { id: true, phone: true, email: true, isProvisional: true },
  });
  if (!profile || profile.isProvisional) return identifier;

  try {
    const { data } = await createAdminClient().auth.admin.getUserById(profile.id);
    if (!data.user) return identifier;
    return loginIdentityFor(data.user, profile) ?? identifier;
  } catch {
    return identifier;
  }
}
