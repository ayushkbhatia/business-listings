import "server-only";
import { Prisma } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import type { Actor } from "@/lib/auth/roles";
import type { MessageKey } from "@/lib/i18n";

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

/**
 * The window the desk's count is taken over.
 *
 * The meta line read *"{count} sessions in the last while"* over the twenty
 * rows the panel had fetched — a page cap wearing a total. A count needs a
 * window, and thirty days is the one a support desk is asked about.
 */
export const VIEW_AS_RECENT_DAYS = 30;

export type StartResult =
  | { ok: true; sessionId: string; expiresAt: Date }
  | {
      ok: false;
      error: "not_found" | "already_viewing" | "needs_a_ticket";
      /*
         A key, not a sentence. These three reach the screen, so they are
         user-visible strings — CLAUDE.md non-negotiable 5 — and they were
         English literals in a `server-only` module that renders nothing. The
         fix line travels with them, because `Alert` with a `bad` tone owes the
         reader a way out.
      */
      message: MessageKey;
      fix: MessageKey;
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
      message: "admin.support.error.needs_ticket",
      fix: "admin.support.error.needs_ticket_fix",
    };
  }

  const business = await prisma.business.findUnique({
    where: { id: input.businessId },
    select: { id: true, displayName: true },
  });
  if (!business) {
    return {
      ok: false,
      error: "not_found",
      message: "admin.support.error.business_missing",
      fix: "admin.support.not_found_fix",
    };
  }

  const live = await currentSession(input.actor.id, now);
  if (live) {
    return {
      ok: false,
      error: "already_viewing",
      message: "admin.support.error.already_viewing",
      fix: "admin.support.error.already_viewing_fix",
    };
  }

  const expiresAt = new Date(now.getTime() + VIEW_AS_MINUTES * 60_000);

  const sessionId = await prisma.$transaction(async (tx) => {
    /*
       Close whatever has run out before opening the next one.

       `currentSession` applies expiry on read, so a session nobody pressed
       *Stop* on stays `ended_at IS NULL` for ever: the thirty-minute cap holds,
       but `sessionsFor` — the account-health screen's list, which is the record
       of who looked at this seller — draws it as still open, and `endViewAs`
       would later stamp it with the hour somebody happened to press Stop on a
       different session rather than the minute it actually ended.

       `ended_at = expires_at`, so the row says when it ended rather than when
       it was tidied. Raw SQL because that is a column-to-column assignment and
       Prisma's `data` takes values, not field references. In the same
       transaction as the create, so a start either closes the old one or does
       not happen.

       No audit row: the end was decided when the session started — the length
       is on the start row's `after` — and `AuditEvent.actorId` is NOT NULL
       because the log holds decisions. This is the clock, not a decision.
    */
    await tx.$executeRaw(Prisma.sql`
      UPDATE view_as_session
         SET ended_at = expires_at
       WHERE staff_id = ${input.actor.id}::uuid
         AND ended_at IS NULL
         AND expires_at <= ${now}
    `);

    return staffMutation(
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
    );
  });

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
      business: { select: { displayName: true, slug: true, sellsKind: true } },
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
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
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
