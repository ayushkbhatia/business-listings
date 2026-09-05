import "server-only";
import { prisma } from "@/lib/db/client";
import { assertCan, can } from "@/lib/auth/can";
import type { Actor } from "@/lib/auth/roles";

/**
 * Board 3j — routing one lead to one seat.
 *
 * ## Why this did not exist
 *
 * `Business.leadRouting` has been stored since the init migration and applied
 * nowhere: round robin routed nothing, because there was no column to route
 * *to*. `withinScope`, `canRespondToEnquiry` and `canSendQuote` have been
 * declared in lib/auth/subject.ts since handoff 0 with zero production callers,
 * and would have answered true for everything if called — no enquiry table
 * carried an actor to compare against.
 *
 * So this is the first writer of an assignee, and the scope filter on the inbox
 * is its first reader.
 *
 * ## Who may assign
 *
 * `routing.manage` — owner and manager, board 7d's "Set lead routing rules"
 * row. A sales seat answering their own leads does not get to hand one to a
 * colleague, and a finance seat has no business in the queue at all.
 *
 * ## Who may be assigned
 *
 * A seat on this business, and nothing else. The check is a query rather than a
 * trusted id: `assignedToId` is a plain uuid with a foreign key to `user`, so
 * without it any user in the system could be named — including a buyer, who
 * would then appear in the inbox's scope filter as one of the team.
 */

export type AssignResult =
  | { ok: true; assignedToId: string | null }
  | { ok: false; error: "not_your_lead" | "not_your_seat" | "decided" };

export async function assignLead(
  actor: Actor,
  businessId: string,
  input: { enquiryId: string; assignedToId: string | null; now?: Date },
): Promise<AssignResult> {
  assertCan(actor, "routing.manage");
  const now = input.now ?? new Date();

  const recipient = await prisma.enquiryRecipient.findUnique({
    where: { enquiryId_businessId: { enquiryId: input.enquiryId, businessId } },
    select: { outcome: true },
  });
  // An unknown enquiry and somebody else's give the same answer, so the action
  // cannot be used to find out which enquiries exist.
  if (!recipient) return { ok: false, error: "not_your_lead" };

  /*
     A decided lead is not work, and assigning one puts a name against a job
     nobody is going to do. Clearing the outcome is the way back — the same
     door 3j §7 gives for reopening a composer.
  */
  if (recipient.outcome) return { ok: false, error: "decided" };

  if (input.assignedToId !== null) {
    const seat = await prisma.user.findFirst({
      where: { id: input.assignedToId, businessId },
      select: { id: true },
    });
    if (!seat) return { ok: false, error: "not_your_seat" };
  }

  await prisma.enquiryRecipient.update({
    where: { enquiryId_businessId: { enquiryId: input.enquiryId, businessId } },
    data:
      input.assignedToId === null
        ? { assignedToId: null, assignedAt: null, assignedById: null }
        : { assignedToId: input.assignedToId, assignedAt: now, assignedById: actor.id },
  });

  return { ok: true, assignedToId: input.assignedToId };
}

export interface SeatOption {
  id: string;
  /** What the picker shows. Empty where a seat has never given a name. */
  name: string;
  /** True for the actor reading the screen, so the picker can say "you". */
  isSelf: boolean;
}

/**
 * The seats a lead may be routed to.
 *
 * Only those with `enquiry.respond`: board 7d gives a finance seat no reply
 * capability, so offering one in the picker would route work to somebody who
 * cannot open it. Sorted by name, with unnamed seats last — a blank sorting to
 * the top reads as a broken list.
 */
export async function assignableSeats(actor: Actor, businessId: string): Promise<SeatOption[]> {
  const seats = await prisma.user.findMany({
    where: { businessId },
    select: { id: true, fullName: true, roles: true },
  });

  return seats
    .filter((seat) => can({ ...actor, id: seat.id, roles: seat.roles }, "enquiry.respond"))
    .map((seat) => ({
      id: seat.id,
      name: seat.fullName ?? "",
      isSelf: seat.id === actor.id,
    }))
    .sort((a, b) => {
      if (!a.name) return 1;
      if (!b.name) return -1;
      return a.name.localeCompare(b.name);
    });
}
