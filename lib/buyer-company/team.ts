import { isBuyerCompanyRole, type BuyerCompanyRole } from "./authority";
import { isEmailShaped, normaliseEmail } from "./details";

/**
 * Board `7b` — the team's pure half: what an invitation or a change of seat
 * posts, and what state an invitation is in.
 *
 * `B11`: *Invited is a real state, distinct from Active, and an invitation
 * expires.* Seven days, as a supplier's team invitation does (board 8d) — a
 * procurement colleague is invited by someone who can re-send in one click.
 */

export const INVITE_DAYS = 7;
/** How soon a re-send is allowed. A second email a minute after the first is a mail loop. */
export const RESEND_MINUTES = 15;
/** The largest monthly limit the form takes: AED 100m. Larger is a typo, or an admin. */
export const LIMIT_MAX_AED = 100_000_000;

export type InviteState = "invited" | "expired" | "accepted" | "revoked";

export function inviteState(
  invite: { expiresAt: Date; acceptedAt: Date | null; revokedAt: Date | null },
  now: Date,
): InviteState {
  if (invite.acceptedAt) return "accepted";
  if (invite.revokedAt) return "revoked";
  return invite.expiresAt.getTime() <= now.getTime() ? "expired" : "invited";
}

export function inviteExpiry(now: Date): Date {
  return new Date(now.getTime() + INVITE_DAYS * 86_400_000);
}

export function resendAllowedAt(lastSentAt: Date): Date {
  return new Date(lastSentAt.getTime() + RESEND_MINUTES * 60_000);
}

export interface SeatTerms {
  role: BuyerCompanyRole;
  /** Procurement only, in whole dirhams. */
  monthlyLimitAed: number | null;
}

export type SeatField = "role" | "monthlyLimitAed";
export type SeatError = "required" | "invalid" | "too_large";

/**
 * A role and, for procurement, a limit. The limit is refused on any other role
 * rather than ignored: a number typed against an admin is a number somebody
 * thinks means something.
 */
export function readSeatTerms(raw: { role?: string; monthlyLimitAed?: string }):
  | { ok: true; value: SeatTerms }
  | { ok: false; errors: Partial<Record<SeatField, SeatError>> } {
  const errors: Partial<Record<SeatField, SeatError>> = {};
  const role = (raw.role ?? "").trim();
  if (!role) errors.role = "required";
  else if (!isBuyerCompanyRole(role)) errors.role = "invalid";

  const limitText = (raw.monthlyLimitAed ?? "").replace(/[,\s]/g, "").replace(/^AED/i, "");
  let monthlyLimitAed: number | null = null;
  if (role === "procurement") {
    if (!limitText) errors.monthlyLimitAed = "required";
    else if (!/^\d+$/.test(limitText) || Number(limitText) <= 0) errors.monthlyLimitAed = "invalid";
    else if (Number(limitText) > LIMIT_MAX_AED) errors.monthlyLimitAed = "too_large";
    else monthlyLimitAed = Number(limitText);
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { role: role as BuyerCompanyRole, monthlyLimitAed } };
}

export type InviteField = "fullName" | "email" | SeatField;
export type InviteError = SeatError | "too_long";

export interface InviteTerms extends SeatTerms {
  fullName: string;
  email: string;
}

/**
 * A person, by name and work email, with their seat.
 *
 * A name is required because the table records who committed money (`7b`
 * flag 3): *Site foreman — JLT* is a function, and a function cannot be the one
 * who approved a quote.
 */
export function readInvite(raw: { fullName?: string; email?: string; role?: string; monthlyLimitAed?: string }):
  | { ok: true; value: InviteTerms }
  | { ok: false; errors: Partial<Record<InviteField, InviteError>> } {
  const errors: Partial<Record<InviteField, InviteError>> = {};
  const fullName = (raw.fullName ?? "").replace(/\s+/g, " ").trim();
  if (!fullName) errors.fullName = "required";
  else if (fullName.length > 120) errors.fullName = "too_long";

  const email = normaliseEmail(raw.email ?? "");
  if (!email) errors.email = "required";
  else if (email.length > 254 || !isEmailShaped(email)) errors.email = "invalid";

  const seat = readSeatTerms(raw);
  if (!seat.ok) Object.assign(errors, seat.errors);

  if (Object.keys(errors).length > 0 || !seat.ok) return { ok: false, errors };
  return { ok: true, value: { fullName, email, ...seat.value } };
}

/** The whole-dirham threshold the rule form posts, or null for none. */
export function readThreshold(raw: string | undefined):
  | { ok: true; value: number | null }
  | { ok: false; error: "invalid" | "too_large" } {
  const text = (raw ?? "").replace(/[,\s]/g, "").replace(/^AED/i, "");
  if (!text) return { ok: true, value: null };
  if (!/^\d+$/.test(text) || Number(text) <= 0) return { ok: false, error: "invalid" };
  if (Number(text) > LIMIT_MAX_AED) return { ok: false, error: "too_large" };
  return { ok: true, value: Number(text) };
}
