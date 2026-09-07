import "server-only";
import { prisma } from "@/lib/db/client";
import { openNow } from "@/lib/trade/open-now";
import type { RamadanHours, WeekHours } from "@/lib/trade/hours";
import { readRamadanCalendar } from "@/lib/trade/ramadan-calendar";
import { reachabilityFor } from "@/lib/team/reachability";
import { recordEvent } from "@/lib/telemetry/record";

/**
 * Board 7d §4 — deciding which seat a lead goes to.
 *
 * ## What was here before
 *
 * Nothing. `Business.leadRouting` has been stored since the init migration and
 * read by no code that routes — `lib/leads/assign.ts` and
 * `lib/enquiry/escalation-job.ts` both say so in prose — while the settings copy
 * told the seller "each new enquiry goes to the next sales seat in turn". Three
 * radios that changed nothing, over a sentence describing behaviour that did not
 * happen.
 *
 * ## Where it runs, and why not inside the fan-out transaction
 *
 * After the recipient rows are written, not during. The fan-out writes up to
 * eight rows with a two-key `createMany` and reads nothing per business; routing
 * needs, per recipient, the mode, the eligible seats, their verified channels
 * and their opening hours. Holding a transaction open on an enquiry the buyer is
 * waiting on to do eight businesses' worth of that is the same objection
 * `lib/enquiry/service.ts` already records against putting a carrier call there.
 *
 * So: assign, then notify. A failure to route leaves the lead unassigned, which
 * is a state the inbox already renders, rather than losing the enquiry.
 *
 * ## Unrouted is not unassigned
 *
 * Both are `assignedToId IS NULL`. Under `everyone` nobody was meant to own it;
 * under round-robin, a null means the router looked and found nobody, and 7d §9
 * calls that count the single measurement that says whether this pair of screens
 * works. `unroutedReason` is what tells them apart.
 */

export type RouteOutcome =
  | { routed: true; userId: string }
  | { routed: false; reason: "no_reachable_seat" | "outside_hours" | "no_seat_in_branch" | "routing_off" };

/**
 * Route one lead for one business.
 *
 * Idempotent by guard: a recipient that already carries an assignee or a routing
 * decision is left alone, so a retry cannot move a lead somebody is already
 * working on.
 */
export async function routeLead(input: {
  enquiryId: string;
  businessId: string;
  now?: Date;
}): Promise<RouteOutcome | null> {
  const now = input.now ?? new Date();

  const recipient = await prisma.enquiryRecipient.findUnique({
    where: { enquiryId_businessId: { enquiryId: input.enquiryId, businessId: input.businessId } },
    select: { assignedToId: true, routedAt: true },
  });
  if (!recipient) return null;
  if (recipient.assignedToId || recipient.routedAt) return null;

  const business = await prisma.business.findUnique({
    where: { id: input.businessId },
    select: { leadRouting: true, routingCursorId: true },
  });
  if (!business) return null;

  /*
     `everyone` is not a failure to route — it is the seller saying every seat
     should see every enquiry, which board 7d renders as the default and most
     suppliers want. The lead stays unassigned on purpose, and the reason says
     so rather than leaving a null that reads as a broken router.
  */
  if (business.leadRouting === "everyone") {
    return finish(input, { routed: false, reason: "routing_off" }, now);
  }

  const candidates = await eligible(input.businessId, now);
  if (candidates.length === 0) {
    return finish(input, { routed: false, reason: candidates.reason ?? "no_reachable_seat" }, now);
  }

  if (business.leadRouting === "by_branch") {
    const chosen = await byBranch(input.enquiryId, candidates.seats);
    if (!chosen) {
      /*
         7d §4: "falls back to the owner if that branch has no seat." The owner
         is not a routing target the seller chose, so it is recorded as a
         fallback rather than as a successful placement — `unroutable_lead` is
         meant to count exactly this.
      */
      return finish(input, { routed: false, reason: "no_seat_in_branch" }, now);
    }
    return finish(input, { routed: true, userId: chosen }, now);
  }

  // Round-robin: the next eligible seat after the cursor, wrapping.
  const chosen = nextAfter(candidates.seats, business.routingCursorId);
  await prisma.business.update({
    where: { id: input.businessId },
    data: { routingCursorId: chosen },
  });
  return finish(input, { routed: true, userId: chosen }, now);
}

interface Eligible {
  seats: string[];
  length: number;
  reason?: "no_reachable_seat" | "outside_hours";
}

/**
 * Who may take a lead right now.
 *
 * Two filters, and the order matters for the reason we report. A seat that
 * cannot reply or has no verified channel is *never* eligible; a seat outside
 * its working hours is eligible again tomorrow. Reporting "no reachable seat"
 * for a team that is simply asleep would send the seller to fix a channel that
 * is not broken.
 */
async function eligible(businessId: string, now: Date): Promise<Eligible> {
  const routable = await reachabilityFor(businessId);
  const canTake = [...routable.values()]
    .filter((seat) => seat.canTakeLeads && seat.reachable)
    .map((seat) => seat.userId)
    .sort();

  if (canTake.length === 0) return { seats: [], length: 0, reason: "no_reachable_seat" };

  /*
     Working hours come from the business's own published hours — the same
     `openNow` the storefront's "Open now" badge reads, in Asia/Dubai and
     Ramadan-aware. 7d §8.4 and 7e §5 both insist on one source, and a second
     copy of the working week is the contradiction that would show up first
     during Ramadan.
  */
  const open = await isOpen(businessId, now);
  if (!open) return { seats: [], length: 0, reason: "outside_hours" };

  return { seats: canTake, length: canTake.length };
}

/** Whether any published branch of this business is open at this moment. */
async function isOpen(businessId: string, now: Date): Promise<boolean> {
  const [locations, ramadan] = await Promise.all([
    prisma.location.findMany({
      where: { businessId, published: true },
      select: { hours: true, ramadanHours: true },
    }),
    readRamadanCalendar(),
  ]);

  // No published hours at all is not "closed": a supplier who has never filled
  // the page in would otherwise never receive a routed lead, which is a silent
  // dead end of exactly the kind this board exists to remove.
  if (locations.length === 0) return true;

  const states = locations.map((location) =>
    openNow(
      location.hours as WeekHours | null,
      location.ramadanHours as RamadanHours | null,
      now,
      ramadan,
    ),
  );

  /*
     `unknown` is not `closed`, and it is not `open` either.

     A supplier who has never filled the hours page in has no week to be outside
     of, so treating them as shut would route nothing to them for ever — a
     silent dead end of exactly the kind this board exists to remove. But
     counting one unfilled branch as open would make every business permanently
     open, which is how the first version of this passed a Saturday test on a
     business whose counter says `sat: []`.

     So: if anybody published hours, those hours decide. Only a business with no
     stated hours anywhere falls back to "always reachable".
  */
  const known = states.filter((state) => state.state !== "unknown");
  if (known.length === 0) return true;
  return known.some((state) => state.state === "open");
}

/**
 * The nearest branch's seat.
 *
 * A seat is branch-scoped through `User.branchId`, which `acceptInvite` writes.
 * An unscoped seat serves every branch, so it is eligible for any lead; a scoped
 * one is eligible only for its own. With no location on the enquiry to compare
 * against, "nearest" is the buyer's stated delivery area matched to a branch's
 * area — and where that finds nothing, the unscoped seats take it.
 */
async function byBranch(enquiryId: string, seats: readonly string[]): Promise<string | null> {
  const [enquiry, scoped] = await Promise.all([
    prisma.enquiry.findUnique({
      where: { id: enquiryId },
      select: { deliverToArea: true },
    }),
    prisma.user.findMany({
      where: { id: { in: [...seats] } },
      select: { id: true, branchId: true },
    }),
  ]);

  const unscoped = scoped.filter((seat) => seat.branchId === null).map((seat) => seat.id).sort();
  if (!enquiry?.deliverToArea) return unscoped[0] ?? null;

  const branchIds = scoped.map((seat) => seat.branchId).filter((id): id is string => id !== null);
  if (branchIds.length > 0) {
    /*
       Published only. Board 3c criterion 2: a hidden branch receives no RFQs.

       It reads as a detail and is not. `deliverToArea` matching a hidden
       branch's area would hand the lead to that branch's scoped seat — the
       sales office the seller took off the directory precisely so that buyers
       would stop arriving through it. The seat is still a real person with a
       real inbox, so nothing looks broken; the enquiry simply lands at the desk
       the seller had decided was closed.
    */
    const branches = await prisma.location.findMany({
      where: { id: { in: branchIds }, published: true },
      select: { id: true, area: { select: { name: true } } },
    });
    const match = branches.find(
      (branch) => branch.area?.name?.toLowerCase() === enquiry.deliverToArea?.toLowerCase(),
    );
    if (match) {
      const seat = scoped.find((s) => s.branchId === match.id);
      if (seat) return seat.id;
    }
  }

  return unscoped[0] ?? null;
}

/**
 * The next seat after the cursor, wrapping.
 *
 * When the cursor's seat is gone — removed mid-rotation, which 7d §8.3 requires
 * this to survive — `indexOf` returns -1 and the rotation restarts at the first
 * eligible seat. That is the correct answer rather than an arbitrary one: an
 * integer index into a list that just got shorter points at the wrong person.
 */
function nextAfter(seats: readonly string[], cursor: string | null): string {
  const at = cursor ? seats.indexOf(cursor) : -1;
  return seats[(at + 1) % seats.length]!;
}

async function finish(
  input: { enquiryId: string; businessId: string },
  outcome: RouteOutcome,
  now: Date,
): Promise<RouteOutcome> {
  await prisma.enquiryRecipient.update({
    where: { enquiryId_businessId: { enquiryId: input.enquiryId, businessId: input.businessId } },
    data: outcome.routed
      ? { assignedToId: outcome.userId, assignedAt: now, routedAt: now, unroutedReason: null }
      : { routedAt: now, unroutedReason: outcome.reason },
  });

  if (!outcome.routed && outcome.reason !== "routing_off") {
    /*
       7d §9's number worth watching. Every one of these is a lead that arrived
       and went nowhere until the owner picked it up, and it is the only evidence
       that this pair of screens is doing its job.
    */
    await recordEvent({
      name: "unroutable_lead",
      businessId: input.businessId,
      props: { reason: outcome.reason },
    });
  }

  return outcome;
}
