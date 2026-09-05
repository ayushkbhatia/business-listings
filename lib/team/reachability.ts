import "server-only";
import { prisma } from "@/lib/db/client";
import { can } from "@/lib/auth/can";
import type { Actor } from "@/lib/auth/roles";
import type { SeatChannelKind } from "@/lib/db/generated/client";

/**
 * Whether a seat can be reached, and on what.
 *
 * The rule that spans boards 7d and 7e, and the reason they are one handoff:
 *
 *   > A seat with no verified notification channel cannot be a routing target.
 *
 * Four surfaces read this one answer — 7d's `REACHABLE ON` column, 7d §4's
 * routing skip, 7e §3's reachability rail, and 7e's promise that an unverified
 * number receives nothing. Four copies of the predicate would be four ways for
 * the screens to disagree about whether a lead can be delivered, which is the
 * silent dead end the pair exists to close.
 *
 * ## What counts as reachable
 *
 * One **verified addressable** channel: WhatsApp, SMS or email. In-app is not
 * one, and that is deliberate — it needs no address and no verification, and
 * 7e §2 keeps it always on for anything with a deadline. Counting it would make
 * every seat trivially reachable and the rule would mean nothing.
 *
 * ## Why a Finance seat is never reachable
 *
 * Not because it has no channels — it may well have verified ones for the
 * licence-expiry event. It is not a *lead* target because board 7d §2 says
 * Finance cannot reply to an enquiry or send a quote, and routing a lead to
 * somebody who cannot open it is the same dead end by a different door. The two
 * questions are separate and this module answers both, separately.
 */

/** The order routing tries them in. Fastest to answer first. */
export const CHANNEL_ORDER: readonly SeatChannelKind[] = ["whatsapp", "sms", "email"];

export interface SeatReachability {
  userId: string;
  /** Verified channels, in the order routing would try them. */
  verified: SeatChannelKind[];
  /** Entered but unproven. Rendered so the seller knows what to finish. */
  unverified: SeatChannelKind[];
  /** At least one verified addressable channel. */
  reachable: boolean;
  /**
   * True when the only verified channel is email.
   *
   * 7d §3 renders this amber: a working seat on a slow channel. It is not a
   * failure — the lead arrives — but it is the difference between an answer in
   * minutes and an answer tomorrow, and reply time is 18 of the 100 ranking
   * points.
   */
  slowOnly: boolean;
  /** False for Finance and for anybody who cannot reply. Never a lead target. */
  canTakeLeads: boolean;
}

/**
 * Every seat's reachability, in one query.
 *
 * Keyed by user id. A seat with no rows at all is present in the map and
 * unreachable — absent from the map would make "unknown" and "unreachable"
 * indistinguishable to a caller, and they are not the same thing.
 */
export async function reachabilityFor(
  businessId: string,
): Promise<Map<string, SeatReachability>> {
  const [seats, channels] = await Promise.all([
    prisma.user.findMany({
      where: { businessId },
      select: { id: true, roles: true },
    }),
    prisma.seatChannel.findMany({
      where: { businessId },
      select: { userId: true, kind: true, verifiedAt: true },
    }),
  ]);

  const byUser = new Map<string, { verified: SeatChannelKind[]; unverified: SeatChannelKind[] }>();
  for (const seat of seats) byUser.set(seat.id, { verified: [], unverified: [] });

  for (const channel of channels) {
    const entry = byUser.get(channel.userId);
    // A channel whose seat has left the business. `removeSeat` nulls
    // `User.businessId` rather than deleting the row, so this is reachable in
    // practice rather than defensive.
    if (!entry) continue;
    (channel.verifiedAt ? entry.verified : entry.unverified).push(channel.kind);
  }

  const out = new Map<string, SeatReachability>();
  for (const seat of seats) {
    const entry = byUser.get(seat.id) ?? { verified: [], unverified: [] };
    const verified = CHANNEL_ORDER.filter((kind) => entry.verified.includes(kind));
    const unverified = CHANNEL_ORDER.filter((kind) => entry.unverified.includes(kind));

    out.set(seat.id, {
      userId: seat.id,
      verified,
      unverified,
      reachable: verified.length > 0,
      slowOnly: verified.length === 1 && verified[0] === "email",
      canTakeLeads: can({ id: seat.id, roles: seat.roles, businessId }, "enquiry.respond"),
    });
  }

  return out;
}

/** One seat. The verification screen and the invite flow read this. */
export async function reachabilityOf(
  businessId: string,
  userId: string,
): Promise<SeatReachability | null> {
  const all = await reachabilityFor(businessId);
  return all.get(userId) ?? null;
}

/**
 * The seats routing may hand a lead to.
 *
 * Both halves of the rule, in one place: a seat that can reply *and* has a
 * verified channel. Ordered by id so round-robin has a stable sequence to walk
 * — `createdAt` would reorder the rotation every time somebody's row was
 * touched, and the cursor points into this order.
 */
export async function routableSeats(businessId: string): Promise<string[]> {
  const reach = await reachabilityFor(businessId);
  return [...reach.values()]
    .filter((seat) => seat.canTakeLeads && seat.reachable)
    .map((seat) => seat.userId)
    .sort();
}

/**
 * Whether an actor may see another seat's channels.
 *
 * 7d §6.1: "not show one seat's numbers to another seat." A sales seat manages
 * its own channels on board 7e and sees nobody else's; owner and manager see the
 * team, because they are the ones who have to fix an unreachable seat.
 */
export function maySeeOtherSeats(actor: Actor): boolean {
  return can(actor, "team.manage");
}
