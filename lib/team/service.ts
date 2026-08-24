import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { assertCanManageTeam } from "@/lib/auth/guards";
import type { Actor, Role } from "@/lib/auth/roles";
import { allowance, type PlanCaps } from "@/lib/plan/entitlements";
import { medianResponseMs, windowStart } from "@/lib/metrics/response-time";

/**
 * Team, seats and lead routing. Board 7d.
 *
 * Only the owner touches any of it — `team.manage` is owner-only, because a
 * seat costs money and grants capabilities. A manager who could invite a
 * manager is a manager who can grant themselves nothing they lack, but a
 * finance seat who could invite one certainly is.
 */

const SEATABLE: readonly Role[] = ["seller_manager", "seller_sales", "seller_finance"];
const INVITE_DAYS = 7;

export const ROUTING = ["everyone", "round_robin", "by_branch"] as const;
export type LeadRouting = (typeof ROUTING)[number];

/** Offered in the interval a supplier actually thinks in. */
export const ESCALATION_CHOICES = [30, 60, 120, 240, 480] as const;

export type TeamResult = { ok: true } | { ok: false; error: string };

export interface Seat {
  id: string;
  name: string | null;
  email: string | null;
  roles: string[];
  /** Median milliseconds from enquiry to this person's first reply. Null when unmeasured. */
  medianReplyMs: number | null;
  isOwner: boolean;
}

/**
 * Who is on the team, and how fast each of them answers.
 *
 * The per-person figure is the board's own ask, "including the uncomfortable
 * one — the owner is often the slowest". It is measured the same way the public
 * number is, by the same function, over the same ninety-day window. A different
 * calculation here would eventually disagree with the storefront, and the owner
 * would be right to trust neither.
 */
export async function teamFor(businessId: string, now = new Date()): Promise<Seat[]> {
  const [members, replies] = await Promise.all([
    prisma.user.findMany({
      where: { businessId },
      orderBy: { createdAt: "asc" },
      select: { id: true, fullName: true, email: true, roles: true },
    }),
    /*
     * Whose reply it was. `EnquiryRecipient.firstReplyAt` records that the
     * business replied, not who — the sender is on the message, so the person
     * is found there. Only the first message from each side counts, which is
     * what `firstReplyAt` already means.
     */
    prisma.message.findMany({
      where: {
        businessId,
        createdAt: { gte: windowStart(now) },
        sender: { businessId },
      },
      orderBy: { createdAt: "asc" },
      select: {
        senderId: true,
        createdAt: true,
        enquiry: { select: { id: true, createdAt: true } },
      },
    }),
  ]);

  // First reply per enquiry, attributed to whoever sent it.
  const firstByEnquiry = new Map<string, { senderId: string; deliveredAt: Date; repliedAt: Date }>();
  for (const message of replies) {
    if (firstByEnquiry.has(message.enquiry.id)) continue;
    firstByEnquiry.set(message.enquiry.id, {
      senderId: message.senderId,
      deliveredAt: message.enquiry.createdAt,
      repliedAt: message.createdAt,
    });
  }

  const byPerson = new Map<string, { deliveredAt: Date; firstReplyAt: Date | null }[]>();
  for (const reply of firstByEnquiry.values()) {
    const list = byPerson.get(reply.senderId) ?? [];
    list.push({ deliveredAt: reply.deliveredAt, firstReplyAt: reply.repliedAt });
    byPerson.set(reply.senderId, list);
  }

  return members.map((member) => ({
    id: member.id,
    name: member.fullName,
    email: member.email,
    roles: member.roles,
    medianReplyMs: medianResponseMs(byPerson.get(member.id) ?? []),
    isOwner: member.roles.includes("seller_owner"),
  }));
}

export interface InviteInput {
  email: string;
  roles: Role[];
}

export type InviteResult = { ok: true; token: string } | { ok: false; error: string };

export async function inviteSeat(
  actor: Actor,
  businessId: string,
  input: InviteInput,
  plan: PlanCaps | null,
  now = new Date(),
): Promise<InviteResult> {
  assertCanManageTeam(actor);
  if (actor.businessId !== businessId) {
    return { ok: false, error: "You can only invite people to your own team." };
  }

  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: "Enter an email address they can receive." };
  }

  const roles = input.roles.filter((role) => SEATABLE.includes(role));
  if (roles.length === 0) {
    return { ok: false, error: "Choose what this person can do." };
  }
  // A second owner is not a seat this screen sells. Transferring ownership is a
  // different act with different consequences and does not belong behind an
  // invite form.
  if (input.roles.includes("seller_owner")) {
    return { ok: false, error: "An invite cannot make somebody an owner." };
  }

  if (plan) {
    // Pending invites count. Otherwise a one-seat plan sends five invites and
    // the cap is discovered by whoever accepts last.
    const [taken, pending] = await Promise.all([
      prisma.user.count({ where: { businessId } }),
      prisma.teamInvite.count({ where: { businessId, acceptedAt: null, revokedAt: null } }),
    ]);
    if (allowance(plan, "seats", taken + pending).atCap) {
      return { ok: false, error: "at_cap" };
    }
  }

  const token = randomBytes(24).toString("base64url");
  await prisma.teamInvite.upsert({
    where: { businessId_email: { businessId, email } },
    create: {
      businessId,
      email,
      roles,
      invitedById: actor.id,
      token,
      expiresAt: new Date(now.getTime() + INVITE_DAYS * 86_400_000),
    },
    // Re-inviting replaces the offer rather than stacking a second one. The
    // roles may have changed since, and the older token should stop working.
    update: {
      roles,
      invitedById: actor.id,
      token,
      expiresAt: new Date(now.getTime() + INVITE_DAYS * 86_400_000),
      revokedAt: null,
    },
  });

  return { ok: true, token };
}

export async function revokeInvite(
  actor: Actor,
  businessId: string,
  id: string,
): Promise<TeamResult> {
  assertCanManageTeam(actor);
  const { count } = await prisma.teamInvite.updateMany({
    where: { id, businessId: actor.businessId ?? businessId, acceptedAt: null },
    data: { revokedAt: new Date() },
  });
  if (count === 0) return { ok: false, error: "That invite cannot be found." };
  return { ok: true };
}

export async function pendingInvites(businessId: string) {
  return prisma.teamInvite.findMany({
    where: { businessId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, roles: true, expiresAt: true },
  });
}

export interface RoutingInput {
  routing: string;
  escalationMinutes: number;
}

export async function saveRouting(
  actor: Actor,
  businessId: string,
  input: RoutingInput,
): Promise<TeamResult> {
  assertCanManageTeam(actor);
  if (actor.businessId !== businessId) {
    return { ok: false, error: "You can only change your own team's routing." };
  }

  if (!(ROUTING as readonly string[]).includes(input.routing)) {
    return { ok: false, error: "Choose one of the routing options." };
  }
  if (!(ESCALATION_CHOICES as readonly number[]).includes(input.escalationMinutes)) {
    // Clamped to the offered set rather than stored, for the same reason quote
    // validity is: a form can post anything, and an escalation of zero minutes
    // means every enquiry escalates instantly.
    return { ok: false, error: "Choose an escalation time from the list." };
  }

  await prisma.business.update({
    where: { id: businessId },
    data: {
      leadRouting: input.routing as never,
      leadEscalationMinutes: input.escalationMinutes,
    },
  });

  return { ok: true };
}
