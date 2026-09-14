import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
// Installs the writer `staffMutation` needs. Without it the first roster change
// on a cold server throws `AuditNotConfiguredError` and changes nothing.
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit";
import { assertReason } from "@/lib/audit/write-audit";
import { assertCanManageStaff } from "@/lib/auth/guards";
import { repairClaims } from "@/lib/auth/flow";
import { STAFF_ROLES, isStaffRoleName, type Actor, type Role, type StaffRole } from "@/lib/auth/roles";
import { sendStaffInviteEmail, staffInviteUrl } from "./email";
import {
  holdsSellerSeat,
  inviteExpiry,
  losesViewAs,
  normaliseStaffEmail,
  refuseRosterChange,
  resendBlockedUntil,
  staffInviteState,
  staffRoleOf,
  withStaffRole,
  withoutStaffRoles,
  type RosterRefusal,
} from "./policy";
import { mintInviteToken } from "./token";

/**
 * Board 4i — inviting, resending, revoking, changing a role, deactivating.
 *
 * Every function here is a staff state change, so every one is a
 * `staffMutation` under `staff.manage` with a written reason (`B3`, CLAUDE.md
 * non-negotiable 3). The order inside each is the same and it is load-bearing:
 *
 *   1. **Capability and reason, before any read.** A moderator posting to one
 *      of these learns nothing about the roster, not even whether an id exists,
 *      and a blank reason is refused without touching a row.
 *   2. **One transaction, holding the roster lock.** Two ops leads demoting
 *      each other at the same moment would each read "two ops leads" and each
 *      proceed, and the console would have none. `pg_advisory_xact_lock` makes
 *      every roster change wait for the one before it, so the count criterion 7
 *      rests on is read after the last change it could race with has committed.
 *   3. **Refusals are decided under the lock**, by `refuseRosterChange`, and
 *      thrown out of the transaction before `staffMutation` runs — a refused
 *      change writes nothing, including no audit row.
 *   4. **The claim is mirrored after commit.** `getActor` decides roles from the
 *      record, so a mirror that fails to write cannot leave a revoked person
 *      holding what was taken.
 *
 * Refusals travel as tokens. This layer knows the state; the screen knows the
 * words.
 */

export type StaffError =
  | RosterRefusal
  | "not_found"
  | "invalid_role"
  | "invalid_email"
  | "outside_domain"
  | "already_staff"
  | "already_invited"
  | "seller_seat"
  | "not_outstanding"
  | "too_soon";

class Refused extends Error {
  constructor(readonly code: StaffError) {
    super(code);
    this.name = "StaffRefused";
  }
}

/**
 * One key for the whole roster. A constant rather than `hashtext()`, so the
 * lock is greppable and nothing else in the product can collide with it by
 * choosing a similar string.
 */
const ROSTER_LOCK = 4_009_001;

async function lockRoster(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ROSTER_LOCK}::bigint)`;
}

/** Unsuspended accounts holding ops lead. Read under the lock, never before it. */
async function activeOpsLeads(tx: Prisma.TransactionClient): Promise<number> {
  return tx.user.count({ where: { roles: { has: "staff_ops_lead" }, suspendedAt: null } });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

// ── Invite ──────────────────────────────────────────────────────────────────

export type InviteStaffResult =
  | {
      ok: true;
      inviteId: string;
      expiresAt: Date;
      delivered: boolean;
      /**
       * The link, only when the email did not go. The ops lead is the fallback
       * carrier, and a link shown on every invitation would be a link copied into
       * chat by habit. Redeeming it still needs the invited mailbox.
       */
      link: string | null;
    }
  | { ok: false; error: StaffError };

export async function inviteStaff(input: {
  actor: Actor;
  email: string;
  role: string;
  reason: string;
  inviterName: string;
  now?: Date;
}): Promise<InviteStaffResult> {
  assertCanManageStaff(input.actor);
  assertReason("staff_invited", input.reason);

  if (!isStaffRoleName(input.role)) return { ok: false, error: "invalid_role" };
  const role: StaffRole = input.role;
  const normalised = normaliseStaffEmail(input.email);
  if (!normalised.ok) return { ok: false, error: normalised.error };
  const email = normalised.email;

  const now = input.now ?? new Date();
  const expiresAt = inviteExpiry(now);
  const { token, tokenHash } = mintInviteToken();
  // Minted here rather than by the column default, so the audit row can name
  // the invitation it records — the subject is fixed before the write runs.
  const inviteId = randomUUID();

  try {
    await prisma.$transaction(async (tx) => {
      await lockRoster(tx);

      const holder = await tx.user.findUnique({
        where: { email },
        select: { roles: true, businessId: true },
      });
      if (holder && staffRoleOf(holder.roles)) throw new Refused("already_staff");
      if (holder && holdsSellerSeat(holder.roles, holder.businessId)) throw new Refused("seller_seat");

      const outstanding = await tx.staffInvite.findFirst({
        where: { email, acceptedAt: null, revokedAt: null },
        select: { id: true },
      });
      if (outstanding) throw new Refused("already_invited");

      return staffMutation(
        {
          actor: input.actor,
          capability: "staff.manage",
          action: "staff_invited",
          subject: `StaffInvite:${inviteId}`,
          reason: input.reason,
          tx,
        },
        async () => {
          await tx.staffInvite.create({
            data: {
              id: inviteId,
              email,
              role,
              tokenHash,
              invitedById: input.actor.id,
              expiresAt,
              lastSentAt: now,
            },
          });
          return { result: undefined, before: null, after: { email, role, expiresAt } };
        },
      );
    });
  } catch (error) {
    if (error instanceof Refused) return { ok: false, error: error.code };
    // The partial unique index, reached by a second tab that missed the lock's
    // read because it committed first. Same answer as the read above.
    if (isUniqueViolation(error)) return { ok: false, error: "already_invited" };
    throw error;
  }

  const delivered = await sendStaffInviteEmail({
    email,
    token,
    role,
    inviterName: input.inviterName,
    expiresAt,
  });

  return { ok: true, inviteId, expiresAt, delivered, link: delivered ? null : staffInviteUrl(token) };
}

// ── Resend ──────────────────────────────────────────────────────────────────

export type ResendStaffInviteResult =
  | { ok: true; expiresAt: Date; delivered: boolean; link: string | null }
  | { ok: false; error: StaffError; retryAt?: Date };

/**
 * A new link and a new window, for an invitation still outstanding. `B8`.
 *
 * A new token, not the old one: the row holds only a hash, so there is no old
 * one to send, and that is the point — whoever held the previous link, forwarded
 * or intercepted, holds nothing now. The screen says so before the click.
 */
export async function resendStaffInvite(input: {
  actor: Actor;
  inviteId: string;
  reason: string;
  inviterName: string;
  now?: Date;
}): Promise<ResendStaffInviteResult> {
  assertCanManageStaff(input.actor);
  assertReason("staff_invite_resent", input.reason);

  const now = input.now ?? new Date();
  const expiresAt = inviteExpiry(now);
  const { token, tokenHash } = mintInviteToken();

  let sent: { email: string; role: StaffRole };
  try {
    sent = await prisma.$transaction(async (tx) => {
      await lockRoster(tx);

      const invite = await tx.staffInvite.findUnique({
        where: { id: input.inviteId },
        select: {
          id: true,
          email: true,
          role: true,
          expiresAt: true,
          acceptedAt: true,
          revokedAt: true,
          lastSentAt: true,
        },
      });
      if (!invite) throw new Refused("not_found");
      const state = staffInviteState(invite, now);
      if (state === "accepted" || state === "revoked") throw new Refused("not_outstanding");
      if (!isStaffRoleName(invite.role)) throw new Refused("invalid_role");

      const blocked = resendBlockedUntil(invite.lastSentAt, now);
      if (blocked) throw Object.assign(new Refused("too_soon"), { retryAt: blocked });

      const role: StaffRole = invite.role;
      return staffMutation(
        {
          actor: input.actor,
          capability: "staff.manage",
          action: "staff_invite_resent",
          subject: `StaffInvite:${invite.id}`,
          reason: input.reason,
          tx,
        },
        async () => {
          await tx.staffInvite.update({
            where: { id: invite.id },
            data: { tokenHash, expiresAt, lastSentAt: now, sendCount: { increment: 1 } },
          });
          return {
            result: { email: invite.email, role },
            before: { expiresAt: invite.expiresAt, state },
            after: { expiresAt },
          };
        },
      );
    });
  } catch (error) {
    if (error instanceof Refused) {
      const retryAt = (error as Refused & { retryAt?: Date }).retryAt;
      return { ok: false, error: error.code, ...(retryAt ? { retryAt } : {}) };
    }
    throw error;
  }

  const delivered = await sendStaffInviteEmail({
    email: sent.email,
    token,
    role: sent.role,
    inviterName: input.inviterName,
    expiresAt,
  });
  return { ok: true, expiresAt, delivered, link: delivered ? null : staffInviteUrl(token) };
}

// ── Revoke ──────────────────────────────────────────────────────────────────

export type StaffResult = { ok: true } | { ok: false; error: StaffError };

export async function revokeStaffInvite(input: {
  actor: Actor;
  inviteId: string;
  reason: string;
  now?: Date;
}): Promise<StaffResult> {
  assertCanManageStaff(input.actor);
  assertReason("staff_invite_revoked", input.reason);
  const now = input.now ?? new Date();

  try {
    await prisma.$transaction(async (tx) => {
      await lockRoster(tx);
      const invite = await tx.staffInvite.findUnique({
        where: { id: input.inviteId },
        select: { id: true, email: true, role: true, expiresAt: true, acceptedAt: true, revokedAt: true },
      });
      if (!invite) throw new Refused("not_found");
      const state = staffInviteState(invite, now);
      if (state === "accepted" || state === "revoked") throw new Refused("not_outstanding");

      await staffMutation(
        {
          actor: input.actor,
          capability: "staff.manage",
          action: "staff_invite_revoked",
          subject: `StaffInvite:${invite.id}`,
          reason: input.reason,
          tx,
        },
        async () => {
          /*
             Conditioned on still being outstanding, and the count checked. The
             lock serialises roster changes, but acceptance holds it too — this is
             the belt to that brace, and it costs nothing.
          */
          const { count } = await tx.staffInvite.updateMany({
            where: { id: invite.id, acceptedAt: null, revokedAt: null },
            data: { revokedAt: now },
          });
          if (count === 0) throw new Refused("not_outstanding");
          return {
            result: undefined,
            before: { email: invite.email, role: invite.role, state },
            after: { state: "revoked" },
          };
        },
      );
    });
  } catch (error) {
    if (error instanceof Refused) return { ok: false, error: error.code };
    throw error;
  }
  return { ok: true };
}

// ── Change a role ───────────────────────────────────────────────────────────

export async function changeStaffRole(input: {
  actor: Actor;
  userId: string;
  role: string;
  reason: string;
  now?: Date;
}): Promise<StaffResult> {
  assertCanManageStaff(input.actor);
  assertReason("staff_role_changed", input.reason);
  if (!isStaffRoleName(input.role)) return { ok: false, error: "invalid_role" };
  const role: StaffRole = input.role;
  return moveStaff({ ...input, next: role, action: "staff_role_changed" });
}

// ── Deactivate ──────────────────────────────────────────────────────────────

/**
 * Take every staff role away, and keep the person. `B9`, and the "suspended
 * staff account" state: their log entries persist under their name, because the
 * `User` row is never deleted and `AuditEvent.actorId` is `Restrict`.
 *
 * Non-staff roles stay. A former moderator who buys on the platform is still a
 * buyer, and their enquiries are still theirs.
 */
export async function deactivateStaff(input: {
  actor: Actor;
  userId: string;
  reason: string;
  now?: Date;
}): Promise<StaffResult> {
  assertCanManageStaff(input.actor);
  assertReason("staff_deactivated", input.reason);
  return moveStaff({ ...input, next: null, action: "staff_deactivated" });
}

async function moveStaff(input: {
  actor: Actor;
  userId: string;
  reason: string;
  next: StaffRole | null;
  action: "staff_role_changed" | "staff_deactivated";
  now?: Date;
}): Promise<StaffResult> {
  const now = input.now ?? new Date();

  let mirrored: { roles: Role[]; businessId: string | null };
  try {
    mirrored = await prisma.$transaction(async (tx) => {
      await lockRoster(tx);

      const target = await tx.user.findUnique({
        where: { id: input.userId },
        select: { id: true, roles: true, suspendedAt: true, businessId: true },
      });
      if (!target) throw new Refused("not_found");

      const refusal = refuseRosterChange({
        actorId: input.actor.id,
        target,
        next: input.next,
        activeOpsLeads: await activeOpsLeads(tx),
      });
      if (refusal) throw new Refused(refusal);

      const before = staffRoleOf(target.roles);
      const nextRoles =
        input.next === null ? withoutStaffRoles(target.roles) : withStaffRole(target.roles, input.next);

      return staffMutation(
        {
          actor: input.actor,
          capability: "staff.manage",
          action: input.action,
          subject: `User:${target.id}`,
          reason: input.reason,
          tx,
        },
        async () => {
          await tx.user.update({
            where: { id: target.id },
            data: {
              roles: nextRoles,
              ...(input.next === null ? { staffDeactivatedAt: now } : {}),
            },
          });

          /*
             A live view-as session is a capability in use. Ended in the same
             transaction as the role that allowed it, so there is no moment where
             the role is gone and the session is not.
          */
          if (losesViewAs(target.roles, nextRoles)) {
            await tx.viewAsSession.updateMany({
              where: { staffId: target.id, endedAt: null },
              data: { endedAt: now },
            });
          }

          return {
            result: { roles: nextRoles, businessId: target.businessId },
            before: { role: before },
            after: { role: input.next },
          };
        },
      );
    });
  } catch (error) {
    if (error instanceof Refused) return { ok: false, error: error.code };
    throw error;
  }

  await repairClaims(input.userId, mirrored.roles, mirrored.businessId);
  return { ok: true };
}

/** For a screen that must list the roles an ops lead may choose from. */
export const ASSIGNABLE_STAFF_ROLES: readonly StaffRole[] = STAFF_ROLES;
