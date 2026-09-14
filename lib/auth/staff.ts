import "server-only";
import { prisma } from "@/lib/db/client";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { recordStaffActivity } from "@/lib/staff/activity";
import { getActor } from "@/lib/auth/session";
import { type Actor, isStaff, isStaffRole, type Role } from "@/lib/auth/roles";

/**
 * Who is acting in the console, and what they may see.
 *
 * The seller side has had `requireSellerSeat()` since handoff 2 and the console
 * has had nothing, which has not mattered only because there were no admin
 * pages to leave open. There are about to be thirty.
 *
 * Two rules, both narrower than they look:
 *
 *   - **A missing staff role is a 404, not a 403.** A signed-in seller who
 *     guesses `/admin/queue` should learn that the URL does not exist, not that
 *     it exists and is guarded. `notFound()` is what the seller shell already
 *     does for the same reason.
 *   - **A staff seat is not a capability.** This resolves who is acting; every
 *     screen still asks `can(actor, …)` for what it renders and every mutation
 *     still goes through `staffMutation`. Reaching the console grants nothing.
 *
 * There is deliberately no development seat here. `lib/auth/dev-seller.ts`
 * exists because a seller dashboard is unusable without a business, and it is
 * inert in production. An equivalent for staff would be a way to become an ops
 * lead by setting an environment variable, and the blast radius of that is
 * every audited capability in the matrix.
 */

export interface StaffSeat {
  actor: Actor;
  /** The staff roles they hold, in matrix order. Never empty. */
  roles: readonly Role[];
  /** Ops lead reads the whole audit log; the other two read their own rows. */
  isOpsLead: boolean;
  /**
   * Who this is, for the pinned sidebar footer — board 6f §1.
   *
   * On the seat rather than on `Actor`, deliberately. `Actor` is the object a
   * hundred and fifty permission checks read, and a display name has no
   * business on a permission boundary. This is the console's own lookup, paid
   * once per admin render.
   */
  name: string;
}

export async function getStaffSeat(): Promise<StaffSeat | null> {
  const actor = await getActor();
  if (!actor || !isStaff(actor)) return null;

  const profile = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { fullName: true, email: true },
  });

  return {
    actor,
    roles: actor.roles.filter(isStaffRole),
    isOpsLead: actor.roles.includes("staff_ops_lead"),
    // The em dash rather than the id: a UUID in the footer tells the person
    // reading it nothing they did not already know.
    name: profile?.fullName ?? profile?.email ?? "—",
  };
}

/**
 * The seat, or a 404. Every admin page starts here.
 *
 * It is also where board 4i's "Last active" is measured: every console page and
 * action passes through, so it is the one place that sees staff use the console.
 * Written after the response, at most once per five minutes per person — see
 * `lib/staff/activity.ts`.
 */
export async function requireStaff(): Promise<StaffSeat> {
  const seat = await getStaffSeat();
  if (!seat) notFound();
  const staffId = seat.actor.id;
  try {
    after(() => recordStaffActivity(staffId));
  } catch {
    // Outside a request — a script or a test calling this directly. There is no
    // console visit to record, and no reason to refuse the seat over it.
  }
  return seat;
}
