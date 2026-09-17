import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import { assertCan, can } from "@/lib/auth/can";
import type { Actor } from "@/lib/auth/roles";

/**
 * Board 4h — the writes this queue makes, other than closing a report.
 *
 * Three of them, and what is missing is the point:
 *
 *   - **assign**, which is `B4`'s owner column;
 *   - **escalate**, which is `B2` — the thing the board drew as a red `Suspend`;
 *   - **mark a duplicate**, which is `B6` for the two reports a collapse cannot
 *     see because a moderator has read them and knows they are the same problem.
 *
 * There is **no suspension here, and no archive**. `12c` dropped its own build
 * note rather than put a second route to a suspension on this board, and wrote
 * down why: *a second route to an outcome that already has one keeps none of
 * the first one's guarantees.* `business.suspend` is ops-lead-only, audited,
 * reason-coded and honoured by storefronts, search, product counts, the metrics
 * jobs and quote extension. `giveLicenceLapseNotice` is the same for a business
 * that has gone. Both live on `/admin/businesses`, both are held by a role this
 * queue's own moderators do not have, and this board's answer is to escalate
 * the row and link to them.
 */

export type DecideError = "not_found" | "already_resolved" | "not_staff" | "not_a_duplicate";

export type DecideResult = { ok: true } | { ok: false; error: DecideError };

/** The seats a row may be handed to: the ones that can work this queue. */
export async function reportStaff() {
  const rows = await prisma.user.findMany({
    where: { roles: { hasSome: ["staff_moderator", "staff_ops_lead"] } },
    orderBy: [{ fullName: "asc" }, { id: "asc" }],
    select: { id: true, fullName: true, roles: true },
  });
  return rows.map((row) => ({ id: row.id, name: row.fullName, roles: row.roles }));
}

async function assignableTo(assigneeId: string): Promise<boolean> {
  const seat = await prisma.user.findUnique({
    where: { id: assigneeId },
    select: { id: true, roles: true },
  });
  return seat !== null && can({ id: seat.id, roles: seat.roles }, "report.resolve");
}

/* ── The owner column ──────────────────────────────────────────────────────── */

export interface AssignReportInput {
  actor: Actor;
  /** `report:<id>` or `dispute:<id>` — the queue's own ref. */
  ref: string;
  /** Null unassigns. */
  assigneeId: string | null;
  reason: string;
}

export function parseReportRef(ref: string): { table: "report" | "dispute"; id: string } | null {
  const [table, id, extra] = ref.split(":");
  if (extra !== undefined || !id) return null;
  if (table !== "report" && table !== "dispute") return null;
  return { table, id };
}

/**
 * Hand a row to somebody, or take it back.
 *
 * Assignment is a staff state change like any other: it carries a written
 * reason and writes an audit row. That reads heavy for *"taking the fraud
 * one"*, and it is the same weight board 4b puts on the same act — the reason
 * on a reassignment is usually the interesting one, because the interesting
 * case is a row moving off somebody's list rather than onto it.
 */
export async function assignReport(
  input: AssignReportInput,
  now = new Date(),
): Promise<DecideResult> {
  assertCan(input.actor, "report.resolve");
  const parsed = parseReportRef(input.ref);
  if (!parsed) return { ok: false, error: "not_found" };
  if (input.assigneeId && !(await assignableTo(input.assigneeId))) {
    return { ok: false, error: "not_staff" };
  }

  const assignment = input.assigneeId
    ? { assigneeId: input.assigneeId, assignedAt: now, assignedById: input.actor.id }
    : { assigneeId: null, assignedAt: null, assignedById: input.actor.id };

  if (parsed.table === "report") {
    const report = await prisma.supplierReport.findUnique({
      where: { id: parsed.id },
      select: { id: true, outcome: true, assigneeId: true },
    });
    if (!report) return { ok: false, error: "not_found" };
    if (report.outcome) return { ok: false, error: "already_resolved" };

    await prisma.$transaction(async (tx) =>
      staffMutation(
        {
          actor: input.actor,
          capability: "report.resolve",
          action: "report_assigned",
          subject: `SupplierReport:${report.id}`,
          reason: input.reason,
          tx,
        },
        async () => {
          const after = await tx.supplierReport.update({
            where: { id: report.id },
            data: assignment,
            select: { assigneeId: true },
          });
          return { result: true, before: { assigneeId: report.assigneeId }, after };
        },
      ),
    );
    return { ok: true };
  }

  const dispute = await prisma.reviewDispute.findUnique({
    where: { id: parsed.id },
    select: { id: true, resolvedAt: true, assigneeId: true },
  });
  if (!dispute) return { ok: false, error: "not_found" };
  if (dispute.resolvedAt) return { ok: false, error: "already_resolved" };

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "report.resolve",
        action: "report_assigned",
        subject: `ReviewDispute:${dispute.id}`,
        reason: input.reason,
        tx,
      },
      async () => {
        const after = await tx.reviewDispute.update({
          where: { id: dispute.id },
          data: assignment,
          select: { assigneeId: true },
        });
        return { result: true, before: { assigneeId: dispute.assigneeId }, after };
      },
    ),
  );
  return { ok: true };
}

/* ── Escalation, which is `B2` ─────────────────────────────────────────────── */

export interface EscalateInput {
  actor: Actor;
  reportId: string;
  reason: string;
}

/**
 * Put a row in front of an ops lead, and leave it open.
 *
 * Escalation is **not** an outcome. The report is still waiting, still counted,
 * still somebody's; what has changed is who it is waiting for. That is why it
 * is a timestamp beside the queue state rather than a fourth `ReportOutcome` —
 * a report closed as *escalated* would leave the rail's shares describing
 * decisions that had not been made.
 *
 * It writes nothing about the business. The ops lead who picks it up decides
 * whether to suspend on `/admin/businesses`, where suspension has its reason
 * codes, its audit entry and its appeal path, and the detail screen links
 * straight there.
 */
export async function escalateReport(
  input: EscalateInput,
  now = new Date(),
): Promise<DecideResult> {
  assertCan(input.actor, "report.resolve");
  const report = await prisma.supplierReport.findUnique({
    where: { id: input.reportId },
    select: { id: true, outcome: true, escalatedAt: true },
  });
  if (!report) return { ok: false, error: "not_found" };
  if (report.outcome) return { ok: false, error: "already_resolved" };

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "report.resolve",
        action: "report_escalated",
        subject: `SupplierReport:${report.id}`,
        reason: input.reason,
        tx,
      },
      async () => {
        const after = await tx.supplierReport.update({
          where: { id: report.id },
          data: {
            escalatedAt: now,
            escalatedById: input.actor.id,
            escalationReason: input.reason,
            /*
               Unassigned on the way up. A row escalated to a role is not a row
               assigned to the person who escalated it, and leaving their name
               on it is how an escalation sits in somebody's list for a week
               looking answered.
            */
            assigneeId: null,
            assignedAt: null,
            assignedById: input.actor.id,
          },
          select: { escalatedAt: true, escalatedById: true },
        });
        return { result: true, before: { escalatedAt: report.escalatedAt }, after };
      },
    ),
  );
  return { ok: true };
}

/* ── A duplicate a person spotted ──────────────────────────────────────────── */

export interface MarkDuplicateInput {
  actor: Actor;
  reportId: string;
  /** The open report this one duplicates. */
  duplicateOfId: string;
  reason: string;
}

/**
 * Two reports that are one problem, where the collapse could not tell.
 *
 * `lib/reports/queue.ts` collapses on `(business, kind, subjectField)`, which
 * catches three buyers reporting the same field and misses a photograph
 * reported once as `content` and once as `wrong_details`. A moderator who has
 * read both knows; this is how they say so.
 *
 * Both reports must be open and about the same business. Pointing a duplicate
 * at a report that is itself a duplicate is refused: a chain would turn *how
 * many people reported this* into a graph walk.
 */
export async function markDuplicate(
  input: MarkDuplicateInput,
  now = new Date(),
): Promise<DecideResult> {
  assertCan(input.actor, "report.resolve");
  if (input.reportId === input.duplicateOfId) return { ok: false, error: "not_a_duplicate" };

  const [report, original] = await Promise.all([
    prisma.supplierReport.findUnique({
      where: { id: input.reportId },
      select: { id: true, outcome: true, subjectBusinessId: true },
    }),
    prisma.supplierReport.findUnique({
      where: { id: input.duplicateOfId },
      select: { id: true, outcome: true, subjectBusinessId: true, duplicateOfId: true },
    }),
  ]);
  if (!report || !original) return { ok: false, error: "not_found" };
  if (report.outcome) return { ok: false, error: "already_resolved" };
  if (original.duplicateOfId !== null) return { ok: false, error: "not_a_duplicate" };
  if (report.subjectBusinessId !== original.subjectBusinessId) {
    return { ok: false, error: "not_a_duplicate" };
  }

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "report.resolve",
        action: "report_resolved",
        subject: `SupplierReport:${report.id}`,
        reason: input.reason,
        tx,
      },
      async () => {
        const after = await tx.supplierReport.update({
          where: { id: report.id },
          data: {
            outcome: "duplicate",
            duplicateOfId: original.id,
            outcomeReason: input.reason,
            resolvedAt: now,
            resolvedById: input.actor.id,
          },
          select: { outcome: true, duplicateOfId: true, resolvedAt: true },
        });
        return { result: true, before: { outcome: null }, after };
      },
    ),
  );
  return { ok: true };
}
