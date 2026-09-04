import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { assertCanManageTeam } from "@/lib/auth/guards";
import type { Actor, Role } from "@/lib/auth/roles";
import { allowance, type PlanCaps } from "@/lib/plan/entitlements";
import { medianResponseMs, windowStart } from "@/lib/metrics/response-time";
import { readContact } from "./contact";
import { inviteUrl, sendInvite } from "./invite-email";

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
  /** Whatever the seller typed into "Mobile or email". Sniffed, not asked. */
  contact: string;
  roles: Role[];
  /** Which branch the seat is scoped to. Null is every branch. */
  branchId?: string | null;
}

export type InviteResult =
  | {
      ok: true;
      token: string;
      /**
       * The link, built. The cheapest possible unblock when an email does not
       * arrive: the owner copies it and sends it themselves, over whatever they
       * already use to talk to the person.
       *
       * It used to be that the token was generated here and thrown away by the
       * caller, so a supplier whose invitation went to a spam folder had no
       * recourse at all — not even a resend, because re-inviting mints a new
       * token and the old one stops working.
       */
      acceptUrl: string;
      /** False when the carrier refused or none is configured. The screen then leads with the link. */
      emailed: boolean;
      /** Which channel it actually went by. Stated per row, never promised. */
      channel: "whatsapp" | "email";
    }
  | {
      ok: false;
      error: string;
      /**
       * Who they already are, for the one refusal that names somebody.
       *
       * §4: a contact who already holds a seat is refused inline — "Rajesh is
       * already on your team" — rather than being sent an invitation to a seat
       * they are sitting in.
       */
      name?: string;
    };

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

  /*
     One box, sniffed. Board 8d §2 — a supplier's staff are reached on WhatsApp
     here, and an invitation that could only be emailed is one half of them
     would never see. `readContact` decides the channel and normalises; the
     screen shows the same answer live as the seller types.
  */
  const contact = readContact(input.contact);
  if (!contact.ok) {
    return {
      ok: false,
      error:
        contact.reason === "empty"
          ? "Enter a mobile number or an email address."
          : "That is not a UAE mobile or an email address.",
    };
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

  /*
     Already on the team. §4: refused inline and offered as a role change,
     rather than sending somebody an invitation to a seat they already hold —
     which arrives looking like the product has forgotten them.
  */
  const seated = await prisma.user.findFirst({
    where: {
      businessId,
      ...(contact.email ? { email: contact.email } : { phone: contact.phone as string }),
    },
    select: { fullName: true, email: true, phone: true },
  });
  if (seated) {
    return {
      ok: false,
      error: "already_seated",
      name: seated.fullName ?? seated.email ?? seated.phone ?? "",
    };
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
  const expiresAt = new Date(now.getTime() + INVITE_DAYS * 86_400_000);
  const invite = await prisma.teamInvite.upsert({
    /*
       Keyed on the channel this contact uses. Both columns carry a unique per
       business, and Postgres treats NULLs as distinct — so an email invitation
       and a mobile one never collide, and re-inviting the same contact finds
       the row rather than stacking a second. §4: the send is idempotent.
    */
    where: contact.email
      ? { businessId_email: { businessId, email: contact.email } }
      : { businessId_phone: { businessId, phone: contact.phone as string } },
    create: {
      businessId,
      email: contact.email,
      phone: contact.phone,
      branchId: input.branchId ?? null,
      roles,
      invitedById: actor.id,
      token,
      expiresAt,
      lastSentAt: now,
    },
    // Re-inviting replaces the offer rather than stacking a second one. The
    // roles may have changed since, and the older token should stop working.
    update: {
      roles,
      branchId: input.branchId ?? null,
      invitedById: actor.id,
      token,
      expiresAt,
      lastSentAt: now,
      revokedAt: null,
    },
    // Selected from the write rather than fetched after it. The email needs the
    // supplier's name and the sender's, and a second read for two strings is a
    // second round trip on the one path a person is waiting on.
    select: {
      email: true,
      phone: true,
      business: { select: { displayName: true } },
      invitedBy: { select: { fullName: true } },
    },
  });

  /*
     Sent here rather than by the screen.

     The invitation exists the moment the row is written, so delivery is part of
     creating one — a service that wrote the row and left the sending to
     whichever caller remembered would eventually have a caller that did not,
     and the invitee would wait for a message nobody sent. `sendInvite`
     never throws and reports what happened, so a carrier that is down costs the
     owner a copy-and-paste rather than the seat.
  */
  const sent = await sendInvite({
    ...(contact.email ? { email: contact.email } : { phone: contact.phone as string }),
    channel: contact.channel,
    token,
    // displayName, never tradeName: it is the name the invitee will see on the
    // storefront whose enquiries they are about to answer.
    businessName: invite.business.displayName,
    inviterName: invite.invitedBy.fullName ?? invite.business.displayName,
    roles,
    expiresAt,
  });

  return { ok: true, token, acceptUrl: inviteUrl(token), emailed: sent, channel: contact.channel };
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
    select: {
      id: true,
      email: true,
      phone: true,
      roles: true,
      expiresAt: true,
      // "Sent 2 days ago" is about the last send, not the first. A resend moves
      // it; without `lastSentAt` the row would age past a message that went an
      // hour ago.
      createdAt: true,
      lastSentAt: true,
    },
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

  /*
     The same number on the alerts screen, kept level.

     `NotificationPreference.escalateAfterMinutes` is the other door onto this
     setting — the alerts form at /dashboard/settings posts it and reads it
     back. Only `leadEscalationMinutes` is acted on, so leaving the preference
     stale would show the seller a threshold on one screen that the sweep
     ignores. `updateMany` rather than `update` because a business that has
     never opened the alerts screen has no preference row, and the absence is
     not an error here.
  */
  await prisma.notificationPreference.updateMany({
    where: { businessId },
    data: { escalateAfterMinutes: input.escalationMinutes },
  });

  return { ok: true };
}

/**
 * The rest of the seat lifecycle, re-exported so the team screen has one import.
 *
 * `removeSeat` is the inverse this file never had: docs/permissions.md §07 says
 * the owner may "invite or remove team members", and until now only half of
 * that existed. It lives in `./invite.ts` with acceptance and expiry because
 * the three share the roles ceiling and the claim repair, not because a team
 * screen needs them separated.
 */
export { acceptInvite, expireInvites, readInvite, removeSeat } from "./invite";
export type { AcceptResult, InviteView, RemoveResult } from "./invite";
export { inviteUrl } from "./invite-email";
