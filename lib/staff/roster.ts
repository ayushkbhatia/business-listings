import "server-only";
import { prisma } from "@/lib/db/client";
import { can } from "@/lib/auth/can";
import { RETIRED_STAFF_ROLES, STAFF_ROLES, type Actor, type StaffRole } from "@/lib/auth/roles";
import {
  DECISION_WINDOW_DAYS,
  NON_DECISION_ACTIONS,
  resendBlockedUntil,
  staffInviteState,
  staffRoleOf,
} from "./policy";

/**
 * Board 4i — who holds which staff role, who is invited, and who used to be.
 *
 * Every number on the screen is a query here (CLAUDE.md, "every number is a
 * query"): the staff count, the role count, the retired count, each person's
 * decisions in the window. None is capped. A staff list is small, and a roster
 * that paginated would owe `B10`'s "showing 5 of 9" line on every page for a
 * list that fits on one — so it returns every row and the screen says it has.
 *
 * **Two depths.** An ops lead reads everything. Every other staff seat reads who
 * holds which role — the board's "non-ops viewer sees the matrix read-only", and
 * a moderator told a control is not theirs should be able to see whose it is —
 * but not the invitations, the former staff, or anybody else's workload and last
 * sign of life. Those are a manager's instruments, and a colleague's decision
 * count is not a moderator's to read. Their own row stays whole.
 *
 * Membership is read from `User.roles`, the same column `can()` decides from.
 * Not from a separate staff table that could disagree with it: a person holding
 * a staff role who was missing from the roster would be exactly the privilege
 * nobody is watching.
 */

export interface RosterMember {
  id: string;
  name: string | null;
  email: string | null;
  role: StaffRole;
  /** Null where this viewer may not read it — see the note on depth above. */
  decisions: number | null;
  lastActiveAt: Date | null;
  /** False where `lastActiveAt` is withheld rather than never recorded. */
  activityVisible: boolean;
  suspended: boolean;
  isSelf: boolean;
}

export interface RosterInvite {
  id: string;
  email: string;
  role: StaffRole;
  state: "pending" | "expired";
  expiresAt: Date;
  lastSentAt: Date;
  sendCount: number;
  invitedByName: string | null;
  /** Null when a resend is allowed now. */
  resendAfter: Date | null;
}

export interface RosterFormer {
  id: string;
  name: string | null;
  email: string | null;
  deactivatedAt: Date;
  /** Decisions stay theirs after they go. The count is the same query as a member's. */
  decisions: number;
}

export interface StaffRoster {
  /** `full` for a viewer holding `staff.manage`; `limited` for every other staff seat. */
  depth: "full" | "limited";
  members: RosterMember[];
  invites: RosterInvite[];
  former: RosterFormer[];
  counts: {
    staff: number;
    roles: number;
    retired: number;
    /** Unsuspended ops leads, the number criterion 7's floor is measured against. */
    activeOpsLeads: number;
    byRole: Record<StaffRole, number>;
  };
  windowDays: number;
}

export async function staffRoster(actor: Actor, now: Date = new Date()): Promise<StaffRoster | null> {
  if (!can(actor, "staff.read")) return null;
  const full = can(actor, "staff.manage");

  const since = new Date(now.getTime() - DECISION_WINDOW_DAYS * 86_400_000);
  const staffRoles = [...STAFF_ROLES];

  const [users, former, invites] = await Promise.all([
    prisma.user.findMany({
      where: { roles: { hasSome: staffRoles } },
      select: {
        id: true,
        fullName: true,
        email: true,
        roles: true,
        suspendedAt: true,
        staffLastActiveAt: true,
      },
      orderBy: { id: "asc" },
    }),
    full
      ? prisma.user.findMany({
          where: { staffDeactivatedAt: { not: null }, NOT: { roles: { hasSome: staffRoles } } },
          select: { id: true, fullName: true, email: true, staffDeactivatedAt: true },
          orderBy: [{ staffDeactivatedAt: "desc" }, { id: "asc" }],
        })
      : Promise.resolve([]),
    full ? prisma.staffInvite.findMany({
      where: { acceptedAt: null, revokedAt: null },
      select: {
        id: true,
        email: true,
        role: true,
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true,
        lastSentAt: true,
        sendCount: true,
        invitedBy: { select: { fullName: true, email: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    }) : Promise.resolve([]),
  ]);

  const people = full
    ? [...users.map((u) => u.id), ...former.map((f) => f.id)]
    : [actor.id];
  const decided =
    people.length === 0
      ? []
      : await prisma.auditEvent.groupBy({
          by: ["actorId"],
          where: {
            actorId: { in: people },
            createdAt: { gte: since },
            action: { notIn: [...NON_DECISION_ACTIONS] },
          },
          _count: { _all: true },
        });
  const decisionsOf = new Map(decided.map((row) => [row.actorId, row._count._all]));

  const byRole: Record<StaffRole, number> = { staff_ops_lead: 0, staff_moderator: 0, staff_finance: 0 };

  const members: RosterMember[] = users
    .map((user) => {
      // `hasSome` guarantees one; the filter keeps the type honest.
      const role = staffRoleOf(user.roles) as StaffRole;
      byRole[role] += 1;
      const visible = full || user.id === actor.id;
      return {
        id: user.id,
        name: user.fullName,
        email: user.email,
        role,
        decisions: visible ? (decisionsOf.get(user.id) ?? 0) : null,
        lastActiveAt: visible ? user.staffLastActiveAt : null,
        activityVisible: visible,
        suspended: user.suspendedAt !== null,
        isSelf: user.id === actor.id,
      };
    })
    /*
       Widest grant first, then by name. The ops leads are the people a reader
       looks for first on a permissions screen, and within a role alphabetical is
       the order a person can scan for a name in. The id breaks a tie between two
       people with the same name, so the order never depends on the query plan.
    */
    .sort(
      (a, b) =>
        STAFF_ROLES.indexOf(a.role) - STAFF_ROLES.indexOf(b.role) ||
        (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? "") ||
        a.id.localeCompare(b.id),
    );

  return {
    depth: full ? "full" : "limited",
    members,
    invites: invites.flatMap((invite) => {
      const state = staffInviteState(invite, now);
      const role = staffRoleOf([invite.role]);
      if ((state !== "pending" && state !== "expired") || !role) return [];
      return [
        {
          id: invite.id,
          email: invite.email,
          role,
          state,
          expiresAt: invite.expiresAt,
          lastSentAt: invite.lastSentAt,
          sendCount: invite.sendCount,
          invitedByName: invite.invitedBy.fullName ?? invite.invitedBy.email,
          resendAfter: resendBlockedUntil(invite.lastSentAt, now),
        },
      ];
    }),
    former: former.map((person) => ({
      id: person.id,
      name: person.fullName,
      email: person.email,
      deactivatedAt: person.staffDeactivatedAt as Date,
      decisions: decisionsOf.get(person.id) ?? 0,
    })),
    counts: {
      staff: members.length,
      roles: STAFF_ROLES.length,
      retired: RETIRED_STAFF_ROLES.length,
      activeOpsLeads: members.filter((m) => m.role === "staff_ops_lead" && !m.suspended).length,
      byRole,
    },
    windowDays: DECISION_WINDOW_DAYS,
  };
}
