import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import type { Actor } from "@/lib/auth/roles";

/**
 * Board 12f — looking through a seller's eyes.
 *
 * Criterion 8: *"view-as is read-only, expires at 30 minutes, and writes an
 * audit row naming the ticket."* Three claims, and only one of them is about a
 * feature. The other two are about what it must refuse to do.
 *
 * ## Read-only is not a hidden button
 *
 * The enforcement is already in the permission matrix, and it is worth saying
 * why rather than adding a second mechanism on top.
 *
 * A view-as session does **not** swap the actor for the seller. The actor stays
 * the staff member — their id, their roles, their audit trail — and only the
 * *business* changes. Every seller mutation guards on a seller capability
 * (`listing.edit` is owner and manager, `team.manage` is owner, `billing.manage`
 * is owner and finance), and a staff actor holds none of them. So the refusal
 * happens at the same `assertCan` that refuses a sales seat, in the service
 * layer, on every path — including any path somebody adds later without reading
 * this comment.
 *
 * Hiding the buttons as well is fine and is not the fence. A hidden button is a
 * UI opinion; a server action is a URL.
 *
 * ## Thirty minutes is a fact the server checks
 *
 * `expiresAt` is a column. A session that ends when the tab closes is not
 * capped, and a cap the browser is merely told about is a cap somebody can keep
 * open all afternoon.
 */

export const VIEW_AS_MINUTES = 30;

export type StartResult =
  | { ok: true; sessionId: string; expiresAt: Date }
  | {
      ok: false;
      error: "not_found" | "already_viewing" | "needs_a_ticket";
      message: string;
    };

export interface StartInput {
  actor: Actor;
  businessId: string;
  /** The support ticket this is for. Required — it is the reason. */
  ticketRef: string;
  reason: string;
}

export async function startViewAs(input: StartInput, now = new Date()): Promise<StartResult> {
  const ticketRef = input.ticketRef.trim();
  if (ticketRef.length < 3) {
    return {
      ok: false,
      error: "needs_a_ticket",
      message: "Name the ticket this is for. It goes on the audit row, and it is the reason.",
    };
  }

  const business = await prisma.business.findUnique({
    where: { id: input.businessId },
    select: { id: true, displayName: true },
  });
  if (!business) {
    return { ok: false, error: "not_found", message: "That business is not in the directory." };
  }

  const live = await currentSession(input.actor.id, now);
  if (live) {
    return {
      ok: false,
      error: "already_viewing",
      message:
        "You are already viewing another account. End that session first — two at once means nobody can say whose account is on screen.",
    };
  }

  const expiresAt = new Date(now.getTime() + VIEW_AS_MINUTES * 60_000);

  const sessionId = await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "support.view_as",
        subject: `Business:${business.id}`,
        // The ticket is in front of the prose, the way the review-removal
        // ground is: a list on its own is not an explanation, and prose on its
        // own is not reviewable.
        reason: `${ticketRef}: ${input.reason}`,
        tx,
      },
      async () => {
        const created = await tx.viewAsSession.create({
          data: {
            staffId: input.actor.id,
            businessId: business.id,
            ticketRef,
            startedAt: now,
            expiresAt,
          },
          select: { id: true },
        });
        return {
          result: created.id,
          before: null,
          after: { ticketRef, expiresAt: expiresAt.toISOString(), minutes: VIEW_AS_MINUTES },
        };
      },
    ),
  );

  return { ok: true, sessionId, expiresAt };
}

/**
 * The live session for this staff member, if there is one.
 *
 * Expiry is applied on read rather than by a job. A session that is over is
 * over the moment somebody asks, whether or not anything has swept it — and a
 * cap that depends on a sweep having run is a cap with a gap in it.
 */
export async function currentSession(staffId: string, now = new Date()) {
  const session = await prisma.viewAsSession.findFirst({
    where: { staffId, endedAt: null },
    select: {
      id: true,
      businessId: true,
      ticketRef: true,
      startedAt: true,
      expiresAt: true,
      business: { select: { displayName: true, slug: true } },
    },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() <= now.getTime()) return null;
  return session;
}

/** Minutes left, for the banner that has to be visible the whole time. */
export function minutesLeft(expiresAt: Date, now = new Date()): number {
  return Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / 60_000));
}

export async function endViewAs(staffId: string, now = new Date()): Promise<void> {
  await prisma.viewAsSession.updateMany({
    where: { staffId, endedAt: null },
    data: { endedAt: now },
  });
}

/** Every session on this business, for the account-health screen. */
export async function sessionsFor(businessId: string, limit = 20) {
  return prisma.viewAsSession.findMany({
    where: { businessId },
    orderBy: { startedAt: "desc" },
    take: limit,
    select: {
      id: true,
      ticketRef: true,
      startedAt: true,
      endedAt: true,
      expiresAt: true,
      staff: { select: { id: true, fullName: true } },
    },
  });
}
