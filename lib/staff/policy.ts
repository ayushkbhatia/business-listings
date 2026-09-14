import { can } from "@/lib/auth/can";
import {
  STAFF_ROLES,
  isStaffRoleName,
  type Role,
  type StaffRole,
} from "@/lib/auth/roles";

/**
 * Board 4i's rules, as pure functions.
 *
 * Everything here is decided without a database, so every refusal the staff
 * console can produce is a unit test rather than a fixture. `service.ts` reads
 * the rows, asks these, and writes — under a lock, in one transaction — and a
 * screen asks the same functions to decide what to dim. The screen's answer is
 * a courtesy; the service's is the rule.
 */

// ── Windows ─────────────────────────────────────────────────────────────────

/**
 * How long an invitation link works. `B8`.
 *
 * Seventy-two hours rather than the seven days a supplier's team invitation
 * gets. A staff invitation is the one link in the product that grants audited
 * capabilities, and the window a forwarded or intercepted link stays usable is
 * the window that matters. Resending is one click and a reason away.
 */
export const STAFF_INVITE_HOURS = 72;

/** A resend within this long of the last send is refused. Server-side, not a disabled button. */
export const STAFF_INVITE_RESEND_MINUTES = 15;

/** "Decisions 30 d" on the roster. */
export const DECISION_WINDOW_DAYS = 30;

/** How often a console request may rewrite `staffLastActiveAt`. */
export const ACTIVITY_WRITE_EVERY_MS = 5 * 60 * 1000;

/**
 * Audited actions that are not decisions.
 *
 * Looking through a seller's eyes and reading another business's enquiries are
 * audited because they must never be silent — not because anybody decided
 * anything. Counting them as decisions would make the roster's workload column
 * reward browsing.
 */
export const NON_DECISION_ACTIONS = ["view_as", "cross_business_read"] as const;

// ── Who may be invited ──────────────────────────────────────────────────────

/**
 * The domains a staff address may be on. `B7`.
 *
 * In code, not in an environment variable or a table, deliberately: widening
 * who can be staff is a security decision, and a decision that deploys with a
 * reviewed diff is one somebody has argued for. Board 4i Q3 — whether an
 * external contractor may hold a role — is open, and until it is answered the
 * answer is no: `contractor@vendor.ae` is refused.
 *
 * There is no SSO in this product. Staff sign in with a one-time code like
 * everybody else, so the domain is the control: an invitation is redeemable
 * only by whoever can read that mailbox, and the mailbox is ours to close.
 */
export const STAFF_EMAIL_DOMAINS = ["businesslistings.me"] as const;

export type StaffEmailResult =
  | { ok: true; email: string }
  | { ok: false; error: "invalid_email" | "outside_domain" };

/** Lowercased, trimmed, one `@`, on a staff domain. */
export function normaliseStaffEmail(raw: string): StaffEmailResult {
  const email = raw.trim().toLowerCase();
  const at = email.lastIndexOf("@");
  // Deliberately plain. A regex that tries to be RFC 5322 refuses real
  // addresses; this refuses only what cannot be an address at all.
  if (
    email.length > 254 ||
    at < 1 ||
    at !== email.indexOf("@") ||
    at === email.length - 1 ||
    /\s/.test(email)
  ) {
    return { ok: false, error: "invalid_email" };
  }
  const domain = email.slice(at + 1);
  if (!(STAFF_EMAIL_DOMAINS as readonly string[]).includes(domain)) {
    return { ok: false, error: "outside_domain" };
  }
  return { ok: true, email };
}

// ── Roles on a person ───────────────────────────────────────────────────────

/**
 * The staff role a person holds, or null.
 *
 * One at most — see `withStaffRole`. A row holding two (written before 4i, or
 * by hand) reads as its widest, in matrix order, so the roster never shows
 * somebody narrower than they are.
 */
export function staffRoleOf(roles: readonly string[]): StaffRole | null {
  return STAFF_ROLES.find((role) => roles.includes(role)) ?? null;
}

/**
 * Their roles with exactly one staff role.
 *
 * Every non-staff role is kept: an ops lead who also buys stays a buyer. Every
 * other staff role is dropped, which is board 4i's separation of duties made
 * structural — finance "can move money and cannot moderate anything", and a
 * person holding both would be exactly the combination the board forbids.
 */
export function withStaffRole(roles: readonly Role[], role: StaffRole): Role[] {
  return [...roles.filter((held) => !isStaffRoleName(held)), role];
}

/** Their roles with no staff role at all. */
export function withoutStaffRoles(roles: readonly Role[]): Role[] {
  return roles.filter((held) => !isStaffRoleName(held));
}

/**
 * Whether a person sits on a supplier's team.
 *
 * Refused for staff. A moderator who is also a seller seat can approve their
 * own listing's edits, and no check downstream of the queue asks. Not stated
 * on board 4i; it is the separation of duties the board does state, applied to
 * the one conflict that is not between two staff roles.
 */
export function holdsSellerSeat(roles: readonly string[], businessId: string | null): boolean {
  return businessId !== null || roles.some((role) => role.startsWith("seller_"));
}

// ── Invitation state ────────────────────────────────────────────────────────

export type StaffInviteState = "pending" | "expired" | "accepted" | "revoked";

export function staffInviteState(
  invite: { expiresAt: Date; acceptedAt: Date | null; revokedAt: Date | null },
  now: Date,
): StaffInviteState {
  if (invite.acceptedAt) return "accepted";
  if (invite.revokedAt) return "revoked";
  return invite.expiresAt.getTime() <= now.getTime() ? "expired" : "pending";
}

export function inviteExpiry(now: Date): Date {
  return new Date(now.getTime() + STAFF_INVITE_HOURS * 3_600_000);
}

/** Null when a resend is allowed now, otherwise when it next is. */
export function resendBlockedUntil(lastSentAt: Date, now: Date): Date | null {
  const next = lastSentAt.getTime() + STAFF_INVITE_RESEND_MINUTES * 60_000;
  return next > now.getTime() ? new Date(next) : null;
}

// ── Changing somebody ───────────────────────────────────────────────────────

export type RosterRefusal =
  /** Nobody changes their own staff role. Another ops lead does it. */
  | "self"
  /** Criterion 7: someone must hold the ops grants. */
  | "last_ops_lead"
  | "not_staff"
  | "same_role"
  | "suspended";

export interface RosterTarget {
  id: string;
  roles: readonly string[];
  suspendedAt: Date | null;
}

/**
 * Whether `actorId` may move `target` to `next` — a role, or null to deactivate.
 *
 * `activeOpsLeads` is the count of unsuspended accounts holding `staff_ops_lead`,
 * read inside the same lock as the write. It is a parameter rather than a query
 * so the rule is one function a test can call with 1.
 */
export function refuseRosterChange(input: {
  actorId: string;
  target: RosterTarget;
  next: StaffRole | null;
  activeOpsLeads: number;
}): RosterRefusal | null {
  const { actorId, target, next, activeOpsLeads } = input;
  const current = staffRoleOf(target.roles);

  if (target.id === actorId) return "self";
  if (!current) return "not_staff";
  if (next !== null && next === current) return "same_role";
  /*
     A suspended staff account can still be deactivated — that is the tidy end
     of it — but not given a new role, which would be granting capabilities to
     an account that cannot sign in and quietly regains them if it is restored.
  */
  if (next !== null && target.suspendedAt !== null) return "suspended";

  /*
     Criterion 7. Losing ops lead — by demotion or deactivation — is refused
     when this account is the only unsuspended one holding it. A suspended ops
     lead does not count towards the floor: they hold the grant and cannot use
     it, and the console needs somebody who can.
  */
  const losesOps = current === "staff_ops_lead" && next !== "staff_ops_lead";
  const countsTowardFloor = target.suspendedAt === null;
  if (losesOps && countsTowardFloor && activeOpsLeads <= 1) return "last_ops_lead";

  return null;
}

/**
 * What a role change takes away that is live right now.
 *
 * A view-as session is a staff member looking through a supplier's eyes, and it
 * outlives the click that started it by up to its expiry. Moving somebody off
 * every role that holds `support.view_as` must end it in the same transaction,
 * or the session is a capability kept after it was taken.
 */
export function losesViewAs(roles: readonly Role[], nextRoles: readonly Role[]): boolean {
  return (
    can({ id: "_", roles }, "support.view_as") && !can({ id: "_", roles: nextRoles }, "support.view_as")
  );
}
