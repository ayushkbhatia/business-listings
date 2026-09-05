import "server-only";
import { prisma } from "@/lib/db/client";
import { tabWhere } from "@/lib/leads/inbox";
import { medianResponseMs, windowStart } from "@/lib/metrics/response-time";
import { allowance, type Allowance, type PlanCaps } from "@/lib/plan/entitlements";
import { effectiveFor } from "@/lib/billing/entitlements-service";
import { reachabilityFor, type SeatReachability } from "./reachability";

/**
 * Board 7d — everything the team screen states, read once.
 *
 * The screen makes six numeric claims and every one of them is checkable against
 * another screen the same seller already has open. That is the whole design
 * problem here: 7d §3 says "if these two numbers disagree, one of the screens is
 * lying and the seller will find out", and the board it was drawn from summed
 * its own `OPEN` column to 21 over an inbox showing 12.
 *
 * So none of it is recomputed. The open counts come through `tabWhere` — board
 * 3j's own definition, the same function the sidebar badge reads — and the
 * medians come through `medianResponseMs`, the function the storefront band and
 * board 3a already use. A second definition of "open" or of "median" in this
 * file is how the disagreement gets built.
 *
 * ## The one number that is not the sum of the column
 *
 * A lead with no assignee is in `3j`'s `Open` tab and in nobody's row. So the
 * per-seat column alone cannot sum to the inbox, and the honest render is the
 * unassigned count beside the seats rather than a footnote explaining a gap.
 * `UNASSIGNED` is a real row here for that reason, not a residual.
 *
 * ## Medians of subsets do not compose
 *
 * 7d §5: "these medians do not average to the business median, and a developer
 * or an analyst will eventually try to reconcile them. Say it once in the data
 * layer." This is that once. Four seats each with a median of 40 minutes can
 * belong to a business whose median is 40, or 12, or 300 — the median of a union
 * is not a function of the medians of its parts, and there is no weighting that
 * makes it one. The screen says so too, because the person who tries the
 * reconciliation is usually reading the screen rather than this file.
 */

/** 7d §5. Not 90, which is the storefront band's window, and not "this month". */
export const SEAT_WINDOW_DAYS = 30;

export type SeatStatus = "active" | "suspended";

export interface RosterSeat {
  userId: string;
  name: string;
  /** The address or mobile under the name. Never shown to a buyer. */
  contact: string | null;
  roles: string[];
  isOwner: boolean;
  isYou: boolean;
  /** Null is every branch. 7d §2 — a scoped seat is limited to its own. */
  branch: { id: string; name: string } | null;
  /** Open leads assigned to this seat, by board 3j's definition of open. */
  open: number;
  reach: SeatReachability;
  status: SeatStatus;
  /** Whether the screen offers a remove control. The service refuses too. */
  removable: boolean;
}

export interface RosterInvite {
  id: string;
  /** Whichever channel it went to. Both columns exist since board 8d. */
  contact: string;
  roles: string[];
  branch: { id: string; name: string } | null;
  expiresAt: Date;
  lastSentAt: Date | null;
  /** Past its seven days. Re-sendable rather than silently gone (7d §7). */
  expired: boolean;
}

export interface SeatPerformance {
  /** Null on the unassigned row, which is a row rather than a residual. */
  userId: string | null;
  name: string | null;
  /** Leads that reached this seat in the window. The bar's value. */
  leads: number;
  /** Median first reply, in milliseconds. Null below the sample floor. */
  medianReplyMs: number | null;
}

export interface Roster {
  seats: RosterSeat[];
  invites: RosterInvite[];
  /** Open leads nobody owns. Part of 3j's `Open`, part of no seat's row. */
  unassignedOpen: number;
  /** Every open lead, by board 3j's count. The column plus the unassigned row. */
  totalOpen: number;
  /** Seats and pending invites against the plan. An invite holds a seat. */
  allowance: Allowance;
  plan: PlanCaps | null;
  /** One branch means the scope column is hidden entirely (8d §2). */
  branchCount: number;
  performance: SeatPerformance[];
  /** Leads in the window, across every row above. The stated total. */
  performanceTotal: number;
  windowDays: number;
}

/**
 * Who is on this team, what they can be reached on, and what they are holding.
 *
 * One function rather than six, because every count on the screen has to be
 * measured against the same instant: a page that reads the open leads at
 * 14:00:01 and the medians at 14:00:04 can render a seat holding a lead it
 * finished in between.
 */
export async function rosterFor(
  businessId: string,
  viewerId: string,
  now = new Date(),
): Promise<Roster> {
  const since = windowStart(now, SEAT_WINDOW_DAYS);

  /*
     Read first, alone, because the reply attribution below has to be scoped to
     the people actually on this team. `sender: { businessId }` — which is what
     `teamFor` uses — silently drops the replies of anybody who has since left,
     and those replies then read as the buyer's own messages. Here they are the
     difference between the rows and the total the card states, so they are
     counted rather than lost.
  */
  const members = await prisma.user.findMany({
    where: { businessId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      roles: true,
      suspendedAt: true,
      branch: { select: { id: true, area: { select: { name: true } } } },
    },
  });
  const seatIds = members.map((member) => member.id);

  const [invites, reach, openCounts, branches, plan, windowRecipients, windowReplies] =
    await Promise.all([
      prisma.teamInvite.findMany({
        where: { businessId, acceptedAt: null, revokedAt: null },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          email: true,
          phone: true,
          roles: true,
          expiresAt: true,
          lastSentAt: true,
          branch: { select: { id: true, area: { select: { name: true } } } },
        },
      }),
      reachabilityFor(businessId),
      /*
         Board 3j's `Open`, grouped by who holds it — one query rather than one
         per seat, and `tabWhere` rather than a copy of its four clauses. The
         `null` group is the unassigned count, which is why the group is not
         filtered to the seats: a residual computed as "total minus the column"
         would be a number with no query behind it.
      */
      prisma.enquiryRecipient.groupBy({
        by: ["assignedToId"],
        where: tabWhere(businessId, "open", { kind: "all" }),
        _count: { _all: true },
      }),
      prisma.location.count({ where: { businessId, published: true } }),
      effectiveFor(businessId),
      // The population board 3j shows, over the window this screen names.
      prisma.enquiryRecipient.count({ where: { businessId, createdAt: { gte: since } } }),
      /*
         Whose reply it was.

         `EnquiryRecipient.firstReplyAt` records that the business replied and
         not who — the sender is on the message. Only the first message from the
         supplier's side counts per enquiry, which is what `firstReplyAt`
         already means, so the two numbers describe the same event.
      */
      prisma.message.findMany({
        where: {
          businessId,
          senderId: { in: seatIds },
          /*
             Scoped to the leads the window is counting, not to messages sent in
             the window. A reply written today to an enquiry from six weeks ago
             is not one of the last thirty days' leads, and counting it would put
             the rows above the total the card states.
          */
          enquiry: { recipients: { some: { businessId, createdAt: { gte: since } } } },
        },
        orderBy: { createdAt: "asc" },
        select: {
          senderId: true,
          createdAt: true,
          enquiry: { select: { id: true, createdAt: true } },
        },
      }),
    ]);

  const openBySeat = new Map<string | null, number>();
  for (const row of openCounts) openBySeat.set(row.assignedToId, row._count._all);

  const unassignedOpen = openBySeat.get(null) ?? 0;
  const totalOpen = [...openBySeat.values()].reduce((sum, n) => sum + n, 0);

  const seats: RosterSeat[] = members.map((member) => {
    const fallback: SeatReachability = {
      userId: member.id,
      verified: [],
      unverified: [],
      reachable: false,
      slowOnly: false,
      canTakeLeads: false,
      suspended: member.suspendedAt !== null,
    };
    const isOwner = member.roles.includes("seller_owner");
    return {
      userId: member.id,
      name: member.fullName ?? member.email ?? member.phone ?? "",
      contact: member.fullName ? (member.email ?? member.phone) : null,
      roles: member.roles,
      isOwner,
      isYou: member.id === viewerId,
      branch: member.branch ? { id: member.branch.id, name: member.branch.area.name } : null,
      open: openBySeat.get(member.id) ?? 0,
      reach: reach.get(member.id) ?? fallback,
      status: member.suspendedAt ? "suspended" : "active",
      /*
         The owner's row and the reader's own offer nothing, and `removeSeat`
         refuses both for reasons it states at length. The screen not offering
         what the service will refuse is the point: a button that always errors
         teaches a seller to distrust the ones that work.
      */
      removable: !isOwner && member.id !== viewerId,
    };
  });

  const invited: RosterInvite[] = invites.map((invite) => ({
    id: invite.id,
    contact: invite.email ?? invite.phone ?? "",
    roles: invite.roles,
    branch: invite.branch ? { id: invite.branch.id, name: invite.branch.area.name } : null,
    expiresAt: invite.expiresAt,
    lastSentAt: invite.lastSentAt,
    expired: invite.expiresAt.getTime() <= now.getTime(),
  }));

  /*
     An invite holds a seat.

     7d §3: the board's header read `3 of 5` over a table of four rows. If an
     invitation does not consume a seat then a seller at the cap can invite five
     more people and the cap means nothing — `inviteSeat` has counted pending
     invitations against the cap since board 8d, so a header that did not would
     refuse an invite it had just told the seller they could send.

     Expired invitations count too, because they are re-sendable in place: the
     row is still an offer of a seat until it is revoked.
  */
  const used = seats.length + invited.length;
  const seatAllowance = plan
    ? allowance(plan, "seats", used)
    : { remaining: null, atCap: false, cap: null, used };

  /*
     Leads *handled*, not leads assigned.

     The board labels the bar "leads" beside a per-seat median, and the two have
     to share a denominator or the card is two measurements wearing one label.
     Assignment cannot be it: `everyone` is the default routing mode and most
     suppliers run it, so under assignment every bar would be zero and every
     median would belong to a seat with no leads.

     A lead is handled by whoever answered it first. That is the same event
     `firstReplyAt` records and the same event the median measures, so the bar
     and the figure describe one population per row.
  */
  const firstByEnquiry = new Map<string, { senderId: string; deliveredAt: Date; repliedAt: Date }>();
  for (const message of windowReplies) {
    if (firstByEnquiry.has(message.enquiry.id)) continue;
    firstByEnquiry.set(message.enquiry.id, {
      senderId: message.senderId,
      deliveredAt: message.enquiry.createdAt,
      repliedAt: message.createdAt,
    });
  }

  const repliesByPerson = new Map<string, { deliveredAt: Date; firstReplyAt: Date | null }[]>();
  for (const reply of firstByEnquiry.values()) {
    const list = repliesByPerson.get(reply.senderId) ?? [];
    list.push({ deliveredAt: reply.deliveredAt, firstReplyAt: reply.repliedAt });
    repliesByPerson.set(reply.senderId, list);
  }

  const performance: SeatPerformance[] = seats
    .map((seat) => {
      const replies = repliesByPerson.get(seat.userId) ?? [];
      return {
        userId: seat.userId as string | null,
        name: seat.name as string | null,
        leads: replies.length,
        medianReplyMs: medianResponseMs(replies),
      };
    })
    .filter((row) => row.leads > 0)
    .sort((a, b) => b.leads - a.leads);

  /*
     What nobody on this team answered, as a row rather than as a gap.

     The card states a total — 7d §5's "53 leads, the same 53 as your inbox" —
     and a stated count has to be the sum of what is drawn under it. This row is
     the leads still waiting plus, honestly, the ones answered by somebody who
     has since left: both are "not answered by anybody in the list above", and
     splitting them would need a column for people who are no longer here.
  */
  const handled = performance.reduce((sum, row) => sum + row.leads, 0);
  const unanswered = Math.max(0, windowRecipients - handled);
  if (unanswered > 0) {
    performance.push({ userId: null, name: null, leads: unanswered, medianReplyMs: null });
  }

  return {
    seats,
    invites: invited,
    unassignedOpen,
    totalOpen,
    allowance: seatAllowance,
    plan,
    branchCount: branches,
    performance,
    performanceTotal: windowRecipients,
    windowDays: SEAT_WINDOW_DAYS,
  };
}
