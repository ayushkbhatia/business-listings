import "server-only";
import { prisma } from "@/lib/db/client";
import type { Prisma } from "@/lib/db/generated/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import { sendReinstatedEmail, sendSuspensionEmail } from "@/lib/auth/email";
import { isStaffRole, type Actor } from "@/lib/auth/roles";
import { endSessions } from "@/lib/closure/sessions";

/**
 * Suspending a person's account — board 7a `B7`, and the "Suspend an account"
 * row of §07's staff table.
 *
 * `User.suspendedAt` has existed since the auth flow was built, every sign-in
 * path has refused it, and nothing ever wrote it. Board 7a's suspended state
 * reads *contact support — the reason is in your email*, and that sentence is
 * only true if the one function that suspends an account also sends the reason.
 * So the three things happen here, together, and nowhere else:
 *
 *   1. **The state change and its audit row**, in one transaction, with the
 *      written reason staff gave (CLAUDE.md non-negotiable 3). The reason lives
 *      on the audit row and nowhere on `user` — the schema says why.
 *   2. **Every session ends.** `getActor` refuses a suspended profile on every
 *      request as well, so this is the second door, not the first.
 *   3. **The reason is emailed to the account holder**, verbatim. The sign-in
 *      screen never shows it: a reason is a sentence about a person, and the
 *      screen is what anybody holding the phone sees.
 *
 * Distinct from suspending a *business* (`lib/business/service.ts`): that takes
 * a listing out of the directory and leaves its team signed in. This stops a
 * person signing in at all, on every role they hold — buyer and seller alike,
 * because board 7a `B1` makes them one account.
 *
 * No console screen calls this yet. `/admin/users` is named `later` in
 * docs/routes.md; the service is here so that screen is a form over one call,
 * and so the promise on the sign-in screen is kept by code that exists.
 */

export interface AccountSuspensionInput {
  actor: Actor;
  userId: string;
  reason: string;
  now?: Date;
}

export type SuspendAccountResult =
  | { ok: true; suspendedAt: Date; emailed: boolean; sessionsEnded: number | null }
  | { ok: false; error: "not_found" }
  | { ok: false; error: "self" }
  /** Staff seats are deactivated through board 4i, which keeps the last-ops-lead rule. */
  | { ok: false; error: "staff_seat" }
  | { ok: false; error: "already_suspended"; since: Date };

export async function suspendAccount(input: AccountSuspensionInput): Promise<SuspendAccountResult> {
  if (input.actor.id === input.userId) return { ok: false, error: "self" };

  const person = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, email: true, roles: true, suspendedAt: true },
  });
  if (!person) return { ok: false, error: "not_found" };
  if (person.roles.some((role) => isStaffRole(role))) return { ok: false, error: "staff_seat" };
  if (person.suspendedAt) return { ok: false, error: "already_suspended", since: person.suspendedAt };

  const suspendedAt = input.now ?? new Date();

  const applied = await inTransactionUnlessLost((tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "account.suspend",
        action: "account_suspended",
        subject: `User:${person.id}`,
        reason: input.reason,
        tx,
      },
      async () => {
        // Conditional, so two ops leads suspending at once write one row and
        // one audit event between them, not two: the loser's update matches
        // nothing and its transaction — audit row included — is rolled back.
        const { count } = await tx.user.updateMany({
          where: { id: person.id, suspendedAt: null },
          data: { suspendedAt },
        });
        if (count !== 1) throw LOST;
        return { result: true, before: { suspendedAt: null }, after: { suspendedAt } };
      },
    ),
  );

  if (!applied) {
    const now = await prisma.user.findUniqueOrThrow({ where: { id: person.id }, select: { suspendedAt: true } });
    return { ok: false, error: "already_suspended", since: now.suspendedAt ?? suspendedAt };
  }

  const sessionsEnded = await endSessions([person.id]);
  const emailed = await sendSuspensionEmail(person.email, input.reason);

  return { ok: true, suspendedAt, emailed, sessionsEnded };
}

export type LiftAccountSuspensionResult =
  | { ok: true; emailed: boolean }
  | { ok: false; error: "not_found" }
  | { ok: false; error: "not_suspended" };

/**
 * Lifting it. Same capability, the paired action, and its own reason — "we were
 * wrong" and "they put it right" are different facts about the same person.
 */
export async function liftAccountSuspension(input: AccountSuspensionInput): Promise<LiftAccountSuspensionResult> {
  const person = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, email: true, suspendedAt: true },
  });
  if (!person) return { ok: false, error: "not_found" };
  if (!person.suspendedAt) return { ok: false, error: "not_suspended" };

  const before = { suspendedAt: person.suspendedAt };
  const lifted = await inTransactionUnlessLost((tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "account.suspend",
        action: "account_reinstated",
        subject: `User:${person.id}`,
        reason: input.reason,
        tx,
      },
      async () => {
        const { count } = await tx.user.updateMany({
          where: { id: person.id, suspendedAt: { not: null } },
          data: { suspendedAt: null },
        });
        if (count !== 1) throw LOST;
        return { result: true, before, after: { suspendedAt: null } };
      },
    ),
  );

  if (!lifted) return { ok: false, error: "not_suspended" };
  return { ok: true, emailed: await sendReinstatedEmail(person.email) };
}

/** Thrown inside a transaction whose conditional update lost a race. */
const LOST = Symbol("lost the race");

/**
 * Run a staff mutation in a transaction, and report a lost race as `false`.
 *
 * `staffMutation` writes its audit row after `run` returns, so a `run` that
 * found nothing to change has to throw to keep that row from being written —
 * the log records decisions that took effect, not ones that arrived second.
 */
async function inTransactionUnlessLost(
  work: (tx: Prisma.TransactionClient) => Promise<boolean>,
): Promise<boolean> {
  try {
    return await prisma.$transaction(work);
  } catch (error) {
    if (error === LOST) return false;
    throw error;
  }
}
