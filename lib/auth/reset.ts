import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/client";
import type { PasswordResetChannel } from "@/lib/db/generated/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { endSessions } from "@/lib/closure/sessions";
import { checkThrottle, recordAttempt } from "./attempts";
import { hasEmailCarrier, sendPasswordChangedEmail, sendResetLinkEmail } from "./email";
import {
  clientFrom,
  sendExistingAccountCode,
  settleSession,
  throttled,
  type AuthDeps,
  type AuthOutcome,
} from "./flow";
import { maskIdentifier, normaliseIdentifier, type Identifier } from "./identity";
import { assessPassword, type PasswordProblem } from "./password-policy";

/**
 * Board 7a, state four — reset, and the grant that makes it single-use.
 *
 * A grant is permission to set a password once, for at most an hour. It is
 * earned one of two ways, and both end in the same form:
 *
 *   - **A link to the account's email** (`B6`). Lasts `RESET_LINK_MINUTES`.
 *   - **A code to the account's mobile** (`B2`), verified on `/verify`. Recovery
 *     works from the mobile alone, with no email on the account at all.
 *
 * Why ours and not Supabase's recovery link: Supabase expires an emailed link on
 * the project's email-OTP expiry, which board 7a sets at ten minutes for codes,
 * while the same board promises a reset link lasts an hour. One setting cannot
 * hold both. See `PasswordReset` in the schema.
 *
 * The token never sits in a URL longer than one redirect. The emailed link lands
 * on `app/auth/reset/route.ts`, which moves it into an httpOnly cookie and
 * redirects to a clean `/reset?stage=set`; a verified code sets the same cookie
 * directly. So a reset page left open, shared as a screenshot or sent onward in
 * a `Referer` carries nothing that can be redeemed.
 */

export const RESET_LINK_MINUTES = 60;
export const RESET_COOKIE = "bl_reset";
const TOKEN_BYTES = 32;

export function newResetToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** 32 bytes in base64url is 43 characters. Anything else is not ours. */
export function looksLikeResetToken(token: string | null | undefined): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export async function issueResetGrant(input: {
  userId: string;
  channel: PasswordResetChannel;
  ip: string | null;
  now?: Date;
}): Promise<string> {
  const now = input.now ?? new Date();
  const token = newResetToken();
  await prisma.passwordReset.create({
    data: {
      userId: input.userId,
      channel: input.channel,
      tokenHash: hashResetToken(token),
      createdAt: now,
      expiresAt: new Date(now.getTime() + RESET_LINK_MINUTES * 60_000),
      ip: input.ip,
    },
  });
  return token;
}

export interface ResetGrantView {
  id: string;
  userId: string;
  channel: PasswordResetChannel;
  expiresAt: Date;
  /** Which account, masked, so the form can say whose password it is setting. */
  masked: string | null;
  /** For the strength rules: a password built on the account's own identifiers is refused. */
  identifiers: string[];
}

/**
 * A grant that can still be used, or null.
 *
 * Reading never consumes. A mail scanner that follows the link, or a person who
 * opens it twice, has used nothing — only saving a password does.
 */
export async function readResetGrant(token: string | null | undefined, now: Date = new Date()): Promise<ResetGrantView | null> {
  if (!looksLikeResetToken(token)) return null;
  const grant = await prisma.passwordReset.findUnique({
    where: { tokenHash: hashResetToken(token) },
    select: {
      id: true,
      userId: true,
      channel: true,
      expiresAt: true,
      usedAt: true,
      user: { select: { phone: true, email: true } },
    },
  });
  if (!grant || grant.usedAt || grant.expiresAt.getTime() <= now.getTime()) return null;

  const shown = grant.channel === "sms" ? grant.user.phone ?? grant.user.email : grant.user.email ?? grant.user.phone;
  const identifier = shown ? normaliseIdentifier(shown) : null;
  return {
    id: grant.id,
    userId: grant.userId,
    channel: grant.channel,
    expiresAt: grant.expiresAt,
    masked: identifier ? maskIdentifier(identifier) : null,
    identifiers: [grant.user.phone, grant.user.email].filter((v): v is string => Boolean(v)),
  };
}

/**
 * Ask for a reset, by mobile or by email.
 *
 * Neutral about whether an account exists, the same as sign-in: the answer is
 * "if there is an account, something is on its way" either way. Two refusals
 * are not neutral, because both are true of the platform rather than of any
 * account — no email carrier configured, and mobile codes switched off.
 */
export async function requestPasswordReset(
  input: { identifier: string; ip?: string | null; now?: Date },
  deps: AuthDeps = {},
): Promise<AuthOutcome> {
  const identifier = normaliseIdentifier(input.identifier);
  if (!identifier) return { ok: false, kind: "invalid_identifier" };
  const ip = input.ip ?? null;

  // A mobile reset is a code, and the code is the same one sign-in sends.
  if (identifier.kind === "phone") return sendExistingAccountCode(identifier, ip, deps);

  if (!hasEmailCarrier()) return { ok: false, kind: "unavailable" };

  const gate = await checkThrottle(identifier.value, "reset_request");
  if (!gate.allowed) return throttled(gate);

  const account = await prisma.user.findUnique({
    where: { email: identifier.value },
    select: { id: true, isProvisional: true, suspendedAt: true },
  });

  let delivered = false;
  // A suspended account is sent nothing: a new password would not open it, and
  // the form refuses it anyway. Provisional identities have no password to reset.
  if (account && !account.isProvisional && !account.suspendedAt) {
    const token = await issueResetGrant({ userId: account.id, channel: "email", ip, ...(input.now ? { now: input.now } : {}) });
    delivered = await sendResetLinkEmail(identifier.value, token);
  }

  await recordAttempt({ identifier: identifier.value, kind: "reset_request", succeeded: delivered, ip });
  return { ok: true, kind: "reset_sent", masked: maskIdentifier(identifier) };
}

export type PasswordSaveOutcome =
  | AuthOutcome
  | { ok: false; kind: "password_rejected"; problem: PasswordProblem; length: number }
  /** Saved, and a session could not be opened with it here. The sign-in form says so. */
  | { ok: true; kind: "password_saved" };

/**
 * Save a new password against a grant, and sign in with it.
 *
 * In this order, and the order is the design:
 *
 *   1. **The grant is read, not claimed.** A password the rules refuse leaves
 *      the link usable — a typo in a twelve-character field should not cost
 *      somebody their email.
 *   2. **Suspension is checked before anything is written** (`B7`). A new
 *      password on a suspended account is a password that opens nothing, set
 *      by somebody who has not been told why.
 *   3. **The grant is claimed conditionally** — `used_at IS NULL AND expires_at
 *      > now()` in the update itself — so two tabs holding the same link cannot
 *      both set a password (`B6`, single-use).
 *   4. **Supabase stores the password.** If it refuses, the claim is released,
 *      because nothing was used.
 *   5. **Every other session ends.** A reset is what somebody does when they
 *      think somebody else has their password.
 *   6. **This browser is signed in with the new password**, through the same
 *      `settleSession` every door uses — board 7a's "Save and sign in".
 */
export async function setPasswordFromGrant(
  input: { token: string | null | undefined; password: string; next?: string | null; ip?: string | null; now?: Date },
  deps: AuthDeps = {},
): Promise<PasswordSaveOutcome> {
  const now = input.now ?? new Date();
  const grant = await readResetGrant(input.token, now);
  if (!grant) return { ok: false, kind: "link_expired" };

  const account = await prisma.user.findUnique({
    where: { id: grant.userId },
    select: { suspendedAt: true, email: true, phone: true },
  });
  if (!account) return { ok: false, kind: "link_expired" };
  if (account.suspendedAt) return { ok: false, kind: "suspended" };

  const assessment = assessPassword(input.password, { identifiers: grant.identifiers });
  if (assessment.problem) {
    return { ok: false, kind: "password_rejected", problem: assessment.problem, length: assessment.length };
  }

  const claimed = await prisma.passwordReset.updateMany({
    where: { id: grant.id, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (claimed.count !== 1) return { ok: false, kind: "link_expired" };

  const admin = createAdminClient();
  const { data: updated, error } = await admin.auth.admin.updateUserById(grant.userId, { password: input.password });
  if (error || !updated.user) {
    await prisma.passwordReset.updateMany({ where: { id: grant.id, usedAt: now }, data: { usedAt: null } });
    if (error?.code === "weak_password") {
      // Supabase's own rules — leaked-password protection, where the project has
      // it — refused what ours allowed. Said as a weak password, not an outage.
      return { ok: false, kind: "password_rejected", problem: "common", length: assessment.length };
    }
    console.error("[auth] could not save a password", { code: error?.code });
    return { ok: false, kind: "unavailable" };
  }

  await prisma.user.update({ where: { id: grant.userId }, data: { passwordSetAt: now } });
  await endSessions([grant.userId]);
  await sendPasswordChangedEmail(account.email);

  const login = loginIdentityFor(updated.user, account);
  if (!login) return { ok: true, kind: "password_saved" };

  const supabase = await clientFrom(deps);
  const { data, error: signInError } = await supabase.auth.signInWithPassword(
    login.kind === "email"
      ? { email: login.value, password: input.password }
      : { phone: login.value, password: input.password },
  );
  if (signInError || !data.user) {
    // Most often the phone provider being off, for an account whose only
    // identity is its mobile. The password is saved; the sign-in form takes it.
    return { ok: true, kind: "password_saved" };
  }

  return settleSession(supabase, data.user, login, input.next ?? null);
}

/**
 * Which of an account's identities a password sign-in should name.
 *
 * Email where Supabase holds one, because the email provider is on in every
 * environment and the phone provider is not. The mobile otherwise.
 */
export function loginIdentityFor(
  authUser: { email?: string | null; phone?: string | null },
  profile: { email: string | null; phone: string | null } | null,
): Identifier | null {
  const email = authUser.email ?? null;
  if (email) return normaliseIdentifier(email);
  const phone = authUser.phone ? `+${authUser.phone.replace(/^\+/, "")}` : profile?.phone ?? null;
  return phone ? normaliseIdentifier(phone) : null;
}
