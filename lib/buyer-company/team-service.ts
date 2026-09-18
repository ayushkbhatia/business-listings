import "server-only";
import { prisma } from "@/lib/db/client";
import { Prisma } from "@/lib/db/generated/client";
import { hashInviteToken, isWellFormedInviteToken, mintInviteToken } from "@/lib/staff/token";
import type { BuyerCompanyRole } from "./authority";
import { asAdmin, asMember, Refused, type NotAdmin, type Refusal } from "./guard";
import { companyInviteUrl, sendCompanyInviteEmail } from "./invite-email";
import { activeMembership, lockCompany, writeCompanyEvent } from "./store";
import {
  inviteExpiry,
  inviteState,
  readInvite,
  readSeatTerms,
  resendAllowedAt,
  type InviteError,
  type InviteField,
  type InviteState,
  type SeatError,
  type SeatField,
} from "./team";

/**
 * Board `7b` — the team: who is invited, who is in, in which seat, and who has
 * left.
 *
 * Three protections the board did not draw and the table needs:
 *
 * - **The last admin stays an admin.** A company nobody can administer cannot
 *   change its own rule, and nobody on the platform can change it for them.
 * - **The named approver stays an admin, and stays.** The rule names them; a
 *   rule naming somebody who cannot approve would hold every request above
 *   the threshold forever. Name another approver first.
 * - **Deactivated, never deleted** (flag 7). A person who leaves keeps their
 *   name on every approval they raised or gave, and their open requests are
 *   withdrawn, because approving one would accept a quote for someone who no
 *   longer buys for the company.
 */

// ── Invitations ──────────────────────────────────────────────────────────────

export type InviteResult =
  | { ok: true; inviteId: string; acceptUrl: string; emailed: boolean }
  | Refusal<NotAdmin | "already_member" | "already_invited">
  | { ok: false; error: "invalid"; errors: Partial<Record<InviteField, InviteError>> };

export async function inviteMember(
  actorId: string,
  raw: { fullName?: string; email?: string; role?: string; monthlyLimitAed?: string },
  now: Date = new Date(),
): Promise<InviteResult> {
  const read = readInvite(raw);
  if (!read.ok) return { ok: false, error: "invalid", errors: read.errors };
  const { token, tokenHash } = mintInviteToken();
  const expiresAt = inviteExpiry(now);

  const result = await asAdmin<
    { inviteId: string; companyName: string; inviterName: string },
    "already_member" | "already_invited"
  >(actorId, async (tx, seat) => {
    const already = await tx.buyerCompanyMember.findFirst({
      where: { companyId: seat.companyId, deactivatedAt: null, user: { email: read.value.email } },
      select: { id: true },
    });
    if (already) throw new Refused("already_member");

    const outstanding = await tx.buyerCompanyInvite.findFirst({
      where: { companyId: seat.companyId, email: read.value.email, acceptedAt: null, revokedAt: null },
      select: { id: true },
    });
    if (outstanding) throw new Refused("already_invited");

    const invite = await tx.buyerCompanyInvite.create({
      data: {
        companyId: seat.companyId,
        email: read.value.email,
        fullName: read.value.fullName,
        role: read.value.role,
        monthlyLimitAed: read.value.monthlyLimitAed,
        tokenHash,
        invitedById: actorId,
        expiresAt,
        lastSentAt: now,
        createdAt: now,
      },
      select: { id: true },
    });
    await writeCompanyEvent(tx, {
      companyId: seat.companyId,
      actorId,
      kind: "member_invited",
      subject: `invite:${invite.id}`,
      after: {
        fullName: read.value.fullName,
        email: read.value.email,
        role: read.value.role,
        monthlyLimitAed: read.value.monthlyLimitAed,
      },
      at: now,
    });
    const [company, inviter] = await Promise.all([
      tx.buyerCompany.findUniqueOrThrow({ where: { id: seat.companyId }, select: { name: true } }),
      tx.user.findUnique({ where: { id: actorId }, select: { fullName: true } }),
    ]);
    return { inviteId: invite.id, companyName: company.name, inviterName: inviter?.fullName ?? company.name };
  }).catch((error: unknown) => {
    // Two admins inviting one address a second apart: the index answers.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false as const, error: "already_invited" as const };
    }
    throw error;
  });

  if ("ok" in result) return result;

  const emailed = await sendCompanyInviteEmail({
    email: read.value.email,
    token,
    fullName: read.value.fullName,
    companyName: result.companyName,
    inviterName: result.inviterName,
    role: read.value.role,
    monthlyLimitAed: read.value.monthlyLimitAed,
    expiresAt,
  });
  return { ok: true, inviteId: result.inviteId, acceptUrl: companyInviteUrl(token), emailed };
}

export type ResendResult =
  | { ok: true; acceptUrl: string; emailed: boolean }
  | Refusal<NotAdmin | "not_found" | "too_soon">;

/**
 * Send it again, with a new link and a new week. An expired invitation can be
 * re-sent — that is the whole of what *Expired* offers (`B11`).
 */
export async function resendInvite(actorId: string, inviteId: string, now: Date = new Date()): Promise<ResendResult> {
  const { token, tokenHash } = mintInviteToken();
  const expiresAt = inviteExpiry(now);

  const result = await asAdmin<
    { email: string; fullName: string; role: BuyerCompanyRole; monthlyLimitAed: number | null; companyName: string; inviterName: string },
    "not_found" | "too_soon"
  >(actorId, async (tx, seat) => {
    const invite = await tx.buyerCompanyInvite.findFirst({
      where: { id: inviteId, companyId: seat.companyId, acceptedAt: null, revokedAt: null },
      select: { email: true, fullName: true, role: true, monthlyLimitAed: true, lastSentAt: true, company: { select: { name: true } } },
    });
    if (!invite) throw new Refused("not_found");
    if (resendAllowedAt(invite.lastSentAt).getTime() > now.getTime()) throw new Refused("too_soon");
    await tx.buyerCompanyInvite.update({
      where: { id: inviteId },
      data: { tokenHash, expiresAt, lastSentAt: now, sendCount: { increment: 1 } },
    });
    await writeCompanyEvent(tx, {
      companyId: seat.companyId,
      actorId,
      kind: "invite_resent",
      subject: `invite:${inviteId}`,
      after: { email: invite.email },
      at: now,
    });
    const inviter = await tx.user.findUnique({ where: { id: actorId }, select: { fullName: true } });
    return {
      email: invite.email,
      fullName: invite.fullName,
      role: invite.role,
      monthlyLimitAed: invite.monthlyLimitAed,
      companyName: invite.company.name,
      inviterName: inviter?.fullName ?? invite.company.name,
    };
  });
  if ("ok" in result) return result;

  const emailed = await sendCompanyInviteEmail({ ...result, token, expiresAt });
  return { ok: true, acceptUrl: companyInviteUrl(token), emailed };
}

export async function revokeInvite(
  actorId: string,
  inviteId: string,
  now: Date = new Date(),
): Promise<{ ok: true } | Refusal<NotAdmin | "not_found">> {
  return asAdmin<{ ok: true }, "not_found">(actorId, async (tx, seat) => {
    const revoked = await tx.buyerCompanyInvite.updateMany({
      where: { id: inviteId, companyId: seat.companyId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    if (revoked.count === 0) throw new Refused("not_found");
    const invite = await tx.buyerCompanyInvite.findUniqueOrThrow({ where: { id: inviteId }, select: { email: true } });
    await writeCompanyEvent(tx, {
      companyId: seat.companyId,
      actorId,
      kind: "invite_revoked",
      subject: `invite:${inviteId}`,
      before: { email: invite.email },
      at: now,
    });
    return { ok: true };
  });
}

// ── Accepting ────────────────────────────────────────────────────────────────

export interface InviteView {
  state: InviteState;
  companyName: string;
  fullName: string;
  email: string;
  role: BuyerCompanyRole;
  monthlyLimitAed: number | null;
  inviterName: string | null;
  expiresAt: Date;
}

/** What the join page shows. Null for a token that is malformed or matches nothing — one answer for both. */
export async function readCompanyInvite(token: string, now: Date = new Date()): Promise<InviteView | null> {
  if (!isWellFormedInviteToken(token)) return null;
  const invite = await prisma.buyerCompanyInvite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    select: {
      email: true,
      fullName: true,
      role: true,
      monthlyLimitAed: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      company: { select: { name: true } },
      invitedBy: { select: { fullName: true } },
    },
  });
  if (!invite) return null;
  return {
    state: inviteState(invite, now),
    companyName: invite.company.name,
    fullName: invite.fullName,
    email: invite.email,
    role: invite.role,
    monthlyLimitAed: invite.monthlyLimitAed,
    inviterName: invite.invitedBy?.fullName ?? null,
    expiresAt: invite.expiresAt,
  };
}

export type AcceptInviteResult =
  | { ok: true; companyId: string }
  | Refusal<"not_found" | "expired" | "revoked" | "used" | "provisional" | "wrong_account" | "other_company" | "already_member">;

/**
 * Join. The signed-in account must be the one the invitation was sent to: the
 * link proves somebody could read that inbox, and a forwarded link should not
 * seat whoever it was forwarded to.
 */
export async function acceptCompanyInvite(
  token: string,
  actorId: string,
  now: Date = new Date(),
): Promise<AcceptInviteResult> {
  if (!isWellFormedInviteToken(token)) return { ok: false, error: "not_found" };
  const tokenHash = hashInviteToken(token);
  const found = await prisma.buyerCompanyInvite.findUnique({ where: { tokenHash }, select: { id: true, companyId: true } });
  if (!found) return { ok: false, error: "not_found" };

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`buyer_company_member:${actorId}`}))`;
      await lockCompany(tx, found.companyId);

      const invite = await tx.buyerCompanyInvite.findUniqueOrThrow({
        where: { id: found.id },
        select: {
          id: true,
          companyId: true,
          email: true,
          role: true,
          monthlyLimitAed: true,
          invitedById: true,
          expiresAt: true,
          acceptedAt: true,
          revokedAt: true,
          tokenHash: true,
        },
      });
      // A re-send replaced the hash under the lock: the old link is dead.
      if (invite.tokenHash !== tokenHash) throw new Refused("not_found");
      const state = inviteState(invite, now);
      if (state === "accepted") throw new Refused("used");
      if (state === "revoked") throw new Refused("revoked");
      if (state === "expired") throw new Refused("expired");

      const user = await tx.user.findUnique({ where: { id: actorId }, select: { email: true, isProvisional: true } });
      if (!user || user.isProvisional) throw new Refused("provisional");
      if ((user.email ?? "").trim().toLowerCase() !== invite.email) throw new Refused("wrong_account");

      const current = await activeMembership(tx, actorId);
      if (current?.companyId === invite.companyId) throw new Refused("already_member");
      if (current) throw new Refused("other_company");

      await tx.buyerCompanyMember.create({
        data: {
          companyId: invite.companyId,
          userId: actorId,
          role: invite.role,
          monthlyLimitAed: invite.monthlyLimitAed,
          invitedById: invite.invitedById,
          joinedAt: now,
        },
      });
      await tx.buyerCompanyInvite.update({ where: { id: invite.id }, data: { acceptedAt: now, acceptedById: actorId } });
      await writeCompanyEvent(tx, {
        companyId: invite.companyId,
        actorId,
        kind: "member_joined",
        subject: `invite:${invite.id}`,
        after: { role: invite.role, monthlyLimitAed: invite.monthlyLimitAed },
        at: now,
      });
      return { ok: true as const, companyId: invite.companyId };
    });
  } catch (error) {
    if (error instanceof Refused) return { ok: false, error: error.code as AcceptInviteResult extends Refusal<infer E> ? E : never };
    throw error;
  }
}

// ── Seats ────────────────────────────────────────────────────────────────────

type SeatRefusal = NotAdmin | "not_found" | "last_admin" | "is_approver";

async function guardSeatChange(
  tx: Prisma.TransactionClient,
  companyId: string,
  target: { userId: string; role: BuyerCompanyRole },
  nextRole: BuyerCompanyRole | null,
): Promise<void> {
  const leavingAdmin = target.role === "company_admin" && nextRole !== "company_admin";
  if (!leavingAdmin) return;
  const company = await tx.buyerCompany.findUniqueOrThrow({ where: { id: companyId }, select: { approverId: true } });
  if (company.approverId === target.userId) throw new Refused("is_approver");
  const admins = await tx.buyerCompanyMember.count({
    where: { companyId, deactivatedAt: null, role: "company_admin", userId: { not: target.userId } },
  });
  if (admins === 0) throw new Refused("last_admin");
}

export type SeatResult =
  | { ok: true }
  | Refusal<SeatRefusal>
  | { ok: false; error: "invalid"; errors: Partial<Record<SeatField, SeatError>> };

/** A member's role and limit. */
export async function changeSeat(
  actorId: string,
  memberId: string,
  raw: { role?: string; monthlyLimitAed?: string },
  now: Date = new Date(),
): Promise<SeatResult> {
  const read = readSeatTerms(raw);
  if (!read.ok) return { ok: false, error: "invalid", errors: read.errors };
  return asAdmin<SeatResult, Exclude<SeatRefusal, NotAdmin>>(actorId, async (tx, seat) => {
    const target = await tx.buyerCompanyMember.findFirst({
      where: { id: memberId, companyId: seat.companyId, deactivatedAt: null },
      select: { userId: true, role: true, monthlyLimitAed: true, user: { select: { fullName: true, email: true } } },
    });
    if (!target) throw new Refused("not_found");
    if (target.role === read.value.role && target.monthlyLimitAed === read.value.monthlyLimitAed) return { ok: true };
    await guardSeatChange(tx, seat.companyId, target, read.value.role);
    await tx.buyerCompanyMember.update({ where: { id: memberId }, data: read.value });
    await writeCompanyEvent(tx, {
      companyId: seat.companyId,
      actorId,
      kind: "member_changed",
      subject: `member:${memberId}`,
      before: { role: target.role, monthlyLimitAed: target.monthlyLimitAed },
      after: { role: read.value.role, monthlyLimitAed: read.value.monthlyLimitAed },
      note: target.user.fullName ?? target.user.email,
      at: now,
    });
    return { ok: true };
  });
}

/** Withdraw what a departing member has open. Approving it later would accept a quote in their name. */
async function withdrawOpenRequests(
  tx: Prisma.TransactionClient,
  companyId: string,
  userId: string,
  actorId: string,
  now: Date,
): Promise<void> {
  const open = await tx.quoteApproval.findMany({
    where: { companyId, raisedById: userId, status: { in: ["pending", "queried"] } },
    select: { id: true, quote: { select: { ref: true } } },
    orderBy: { id: "asc" },
  });
  for (const request of open) {
    await tx.quoteApproval.update({ where: { id: request.id }, data: { status: "withdrawn", updatedAt: now } });
    await writeCompanyEvent(tx, {
      companyId,
      actorId,
      kind: "approval_withdrawn",
      subject: `approval:${request.id}`,
      after: { quoteRef: request.quote.ref, why: "member_left" },
      at: now,
    });
  }
}

/** Deactivate somebody else. For oneself, `leaveCompany`. */
export async function deactivateMember(
  actorId: string,
  memberId: string,
  now: Date = new Date(),
): Promise<{ ok: true } | Refusal<SeatRefusal | "is_self">> {
  return asAdmin<{ ok: true }, Exclude<SeatRefusal, NotAdmin> | "is_self">(actorId, async (tx, seat) => {
    const target = await tx.buyerCompanyMember.findFirst({
      where: { id: memberId, companyId: seat.companyId, deactivatedAt: null },
      select: { userId: true, role: true, monthlyLimitAed: true, user: { select: { fullName: true, email: true } } },
    });
    if (!target) throw new Refused("not_found");
    if (target.userId === actorId) throw new Refused("is_self");
    await guardSeatChange(tx, seat.companyId, target, null);
    await tx.buyerCompanyMember.update({
      where: { id: memberId },
      data: { deactivatedAt: now, deactivatedById: actorId },
    });
    await withdrawOpenRequests(tx, seat.companyId, target.userId, actorId, now);
    await writeCompanyEvent(tx, {
      companyId: seat.companyId,
      actorId,
      kind: "member_deactivated",
      subject: `member:${memberId}`,
      before: { role: target.role, monthlyLimitAed: target.monthlyLimitAed },
      note: target.user.fullName ?? target.user.email,
      at: now,
    });
    return { ok: true };
  });
}

/** Leave the company. The same protections: the last admin and the named approver cannot. */
export async function leaveCompany(
  actorId: string,
  now: Date = new Date(),
): Promise<{ ok: true } | Refusal<"not_member" | "last_admin" | "is_approver">> {
  return asMember<{ ok: true }, "last_admin" | "is_approver">(actorId, async (tx, seat) => {
    await guardSeatChange(tx, seat.companyId, seat, null);
    await tx.buyerCompanyMember.update({
      where: { id: seat.id },
      data: { deactivatedAt: now, deactivatedById: actorId },
    });
    await withdrawOpenRequests(tx, seat.companyId, actorId, actorId, now);
    await writeCompanyEvent(tx, {
      companyId: seat.companyId,
      actorId,
      kind: "member_deactivated",
      subject: `member:${seat.id}`,
      before: { role: seat.role, monthlyLimitAed: seat.monthlyLimitAed },
      note: "left",
      at: now,
    });
    return { ok: true };
  });
}
