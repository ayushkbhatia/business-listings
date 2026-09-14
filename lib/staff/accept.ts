import "server-only";
import { prisma } from "@/lib/db/client";
import { repairClaims } from "@/lib/auth/flow";
import { isStaffRoleName, type Actor, type StaffRole } from "@/lib/auth/roles";
import { holdsSellerSeat, staffInviteState, staffRoleOf, withStaffRole } from "./policy";
import { hashInviteToken, isWellFormedInviteToken } from "./token";

/**
 * Board 4i — reading an invitation link, and taking the role it offers.
 *
 * **The authority is the token plus the mailbox, not a capability.** The
 * invitee holds no staff role yet, so there is nothing to `assertCan` against.
 * Three things stand in for it: the token's own state, that the signed-in
 * account holds the invited address, and that the account is not a seller seat.
 *
 * **No audit row.** `AuditEvent` records decisions and who made them, and the
 * decision here was the ops lead's — logged, with a reason, as `staff_invited`
 * when they sent it. Accepting is the invitee's, it is not a staff state change
 * made *by* staff, and the `StaffInvite` row records it (`acceptedAt`,
 * `acceptedById`). Writing a row here would need a reason nobody wrote.
 *
 * Lives apart from `service.ts` so that nothing in the console imports it: the
 * console's audit-coverage check follows imports from `app/(admin)`, and a write
 * reachable from there without `staffMutation` is exactly what it refuses.
 */

export type StaffInviteView =
  | { state: "not_found" }
  | { state: "used" }
  | { state: "expired"; email: string }
  | { state: "revoked" }
  | { state: "ok"; email: string; role: StaffRole; inviterName: string; expiresAt: Date };

/**
 * A token, resolved to five states.
 *
 * A malformed token, an unknown one and an accepted one answer alike — "this
 * link does not work" — so a guessed link learns nothing. `expired` names the
 * address, because the person holding a real expired link needs to know which
 * account to ask about; the address is ours and on our domain. `revoked` names
 * nobody.
 */
export async function readStaffInvite(token: string, now: Date = new Date()): Promise<StaffInviteView> {
  if (!isWellFormedInviteToken(token)) return { state: "not_found" };

  const invite = await prisma.staffInvite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    select: {
      email: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      invitedBy: { select: { fullName: true, email: true } },
    },
  });
  if (!invite) return { state: "not_found" };

  const state = staffInviteState(invite, now);
  if (state === "accepted") return { state: "used" };
  if (state === "revoked") return { state: "revoked" };
  if (state === "expired") return { state: "expired", email: invite.email };
  // A row can outlive the enum it was written against; the CHECK constraint
  // says it cannot, and this says so again at the one place it would grant.
  if (!isStaffRoleName(invite.role)) return { state: "not_found" };

  return {
    state: "ok",
    email: invite.email,
    role: invite.role,
    inviterName: invite.invitedBy.fullName ?? invite.invitedBy.email ?? "",
    expiresAt: invite.expiresAt,
  };
}

export type AcceptStaffInviteResult =
  | { ok: true; role: StaffRole }
  | {
      ok: false;
      reason:
        | "not_found"
        | "used"
        | "expired"
        | "revoked"
        | "wrong_account"
        | "already_staff"
        | "seller_seat"
        | "suspended";
    };

/** The same key `service.ts` locks. Acceptance adds a staff role, so it queues with the rest. */
const ROSTER_LOCK = 4_009_001;

export async function acceptStaffInvite(
  token: string,
  actor: Actor,
  now: Date = new Date(),
): Promise<AcceptStaffInviteResult> {
  if (!isWellFormedInviteToken(token)) return { ok: false, reason: "not_found" };
  const tokenHash = hashInviteToken(token);

  const outcome = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ROSTER_LOCK}::bigint)`;

    const invite = await tx.staffInvite.findUnique({
      where: { tokenHash },
      select: { id: true, email: true, role: true, expiresAt: true, acceptedAt: true, revokedAt: true },
    });
    if (!invite || !isStaffRoleName(invite.role)) return { ok: false as const, reason: "not_found" as const };

    const state = staffInviteState(invite, now);
    if (state === "accepted") return { ok: false as const, reason: "used" as const };
    if (state === "revoked") return { ok: false as const, reason: "revoked" as const };
    if (state === "expired") return { ok: false as const, reason: "expired" as const };

    const holder = await tx.user.findUnique({
      where: { id: actor.id },
      select: { email: true, roles: true, businessId: true, suspendedAt: true },
    });
    if (!holder) {
      // A session with no profile row. `adoptProfile` makes one at the first
      // verification, so this is a broken invariant, not something a person did.
      throw new Error(`No profile row for the signed-in actor ${actor.id}; cannot accept a staff invite`);
    }

    // Email only. A staff invitation is to a mailbox on our domain, and an
    // account signed in by mobile has not shown it holds one.
    if ((holder.email ?? "").trim().toLowerCase() !== invite.email) {
      return { ok: false as const, reason: "wrong_account" as const };
    }
    if (holder.suspendedAt) return { ok: false as const, reason: "suspended" as const };
    if (staffRoleOf(holder.roles)) return { ok: false as const, reason: "already_staff" as const };
    if (holdsSellerSeat(holder.roles, holder.businessId)) {
      return { ok: false as const, reason: "seller_seat" as const };
    }

    const role: StaffRole = invite.role;
    const nextRoles = withStaffRole(holder.roles, role);

    const claimed = await tx.staffInvite.updateMany({
      where: { id: invite.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
      data: { acceptedAt: now, acceptedById: actor.id },
    });
    if (claimed.count === 0) return { ok: false as const, reason: "used" as const };

    await tx.user.update({
      where: { id: actor.id },
      // A returning member of staff is not deactivated any more.
      data: { roles: nextRoles, staffDeactivatedAt: null },
    });

    return { ok: true as const, role, roles: nextRoles, businessId: holder.businessId };
  });

  if (!outcome.ok) return outcome;
  await repairClaims(actor.id, outcome.roles, outcome.businessId);
  return { ok: true, role: outcome.role };
}
