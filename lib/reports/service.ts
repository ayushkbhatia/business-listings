import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import { auditScopeFor } from "@/lib/auth/subject";
import type { Actor } from "@/lib/auth/roles";
import type { $Enums } from "@/lib/db/generated/client";

/**
 * Board 4h — supplier reports.
 *
 * *"A supplier-conduct queue, not a payment-dispute queue."* The distinction is
 * the whole screen: outcomes are `seller_corrected`, `upheld` and `no_action`,
 * each with a reason, and there is no outcome that moves money because there is
 * no money here to move. CLAUDE.md's vocabulary table calls this a **supplier
 * report** rather than a dispute for exactly that reason.
 *
 * This queue already has a producer and has never had a drain.
 * `lib/messaging/service.ts` has been writing a report with `reporterId: null`
 * since handoff 2 every time it detects off-platform payment steering in a
 * thread — the third queue in this project to be filled by code and read by
 * nobody.
 *
 * ## Off-platform payment reports skip the queue
 *
 * The README says so outright, and the reason is that they are not a judgement
 * call. A message asking a buyer to pay an IBAN before contact release is
 * either there or it is not; the platform detected it, and what a moderator
 * adds is the decision about the *account*, not about the message. So they are
 * flagged separately and land in front of ops lead with the suspension control,
 * rather than in the conduct queue with the wrong-phone-number reports.
 */

export type ReportOutcome = $Enums.ReportOutcome;

/**
 * The queue: open reports, oldest first, excluding the ones that skip it.
 *
 * Age before volume, the same as every other queue in this console.
 */
export async function openReports(limit = 100) {
  const rows = await prisma.supplierReport.findMany({
    where: { outcome: null, kind: { not: "off_platform_payment" } },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: {
      id: true,
      kind: true,
      subjectField: true,
      detail: true,
      createdAt: true,
      reporter: { select: { id: true, fullName: true } },
      subjectBusiness: {
        select: {
          id: true,
          displayName: true,
          slug: true,
          verificationTier: true,
          suspendedAt: true,
        },
      },
    },
  });

  const now = new Date();
  return rows.map((row) => ({
    ...row,
    ageDays: Math.floor((now.getTime() - row.createdAt.getTime()) / 86_400_000),
    /*
     * A report nobody filed is one the platform filed. The distinction matters
     * on screen: an automatic report is evidence we produced, and a moderator
     * reading it should know that nobody is waiting for a reply.
     */
    automatic: row.reporter === null,
  }));
}

/** The ones that skip the queue, for the ops-lead surface that handles them. */
export async function offPlatformReports(limit = 50) {
  return prisma.supplierReport.findMany({
    where: { outcome: null, kind: "off_platform_payment" },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: {
      id: true,
      detail: true,
      subjectField: true,
      createdAt: true,
      subjectBusiness: {
        select: { id: true, displayName: true, slug: true, suspendedAt: true },
      },
    },
  });
}

/**
 * How many times this business has been reported for the same thing.
 *
 * `subjectField` exists for the three-strikes auto-flag the data model names.
 * Three separate buyers reporting the same wrong phone number is not three
 * opinions, it is one fact — and a moderator seeing "third report of this
 * field" decides differently from one seeing "a report".
 */
export async function priorsFor(businessId: string, subjectField: string | null) {
  const [onBusiness, onField] = await Promise.all([
    prisma.supplierReport.count({
      where: { subjectBusinessId: businessId, outcome: { not: null } },
    }),
    subjectField
      ? prisma.supplierReport.count({
          where: { subjectBusinessId: businessId, subjectField },
        })
      : Promise.resolve(0),
  ]);
  return { onBusiness, onField };
}

export type ResolveResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "already_resolved"; message: string };

export interface ResolveReportInput {
  actor: Actor;
  reportId: string;
  outcome: ReportOutcome;
  reason: string;
}

/**
 * Resolve one, with an outcome and a reason.
 *
 * `report.resolve` is moderator or ops lead. The outcome is one of three and
 * none of them is "refund": that word does not appear in this file, in the
 * enum, or anywhere a supplier report can reach, because the platform holds no
 * buyer money and a queue that implies otherwise is a queue that will be asked
 * to move some.
 */
export async function resolveReport(
  input: ResolveReportInput,
  now = new Date(),
): Promise<ResolveResult> {
  const report = await prisma.supplierReport.findUnique({
    where: { id: input.reportId },
    select: { id: true, outcome: true, subjectBusinessId: true, kind: true },
  });
  if (!report) {
    return { ok: false, error: "not_found", message: "That report is not in the queue." };
  }
  if (report.outcome) {
    return {
      ok: false,
      error: "already_resolved",
      message: `That report was already resolved as ${report.outcome}.`,
    };
  }

  await prisma.$transaction(async (tx) => {
    await staffMutation(
      {
        actor: input.actor,
        capability: "report.resolve",
        subject: `SupplierReport:${report.id}`,
        reason: input.reason,
        tx,
      },
      async () => {
        const after = await tx.supplierReport.update({
          where: { id: report.id },
          data: {
            outcome: input.outcome,
            outcomeReason: input.reason,
            resolvedAt: now,
          },
          select: { outcome: true, resolvedAt: true },
        });
        return { result: true, before: { outcome: null }, after };
      },
    );
  });

  return { ok: true };
}

/* ── The audit log ───────────────────────────────────────────────────────── */

/**
 * Board 4i's log, scoped.
 *
 * §07: ops lead reads all of it, every other staff role reads **their own
 * actions**. `auditScopeFor` has implemented that since handoff 3 step 4 and
 * has never been called — so the narrowing existed and narrowed nothing.
 *
 * It returns a scope rather than a boolean for the reason its own comment
 * gives: a caller handed a yes shows the whole log to a moderator.
 */
export async function auditLog(
  actor: Actor,
  options: { limit?: number; action?: string; subject?: string } = {},
) {
  const scope = auditScopeFor(actor);
  if (!scope) return null;

  return prisma.auditEvent.findMany({
    where: {
      ...(scope.kind === "own" ? { actorId: scope.actorId } : {}),
      ...(options.action ? { action: options.action } : {}),
      ...(options.subject ? { subject: { contains: options.subject } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: options.limit ?? 100,
    select: {
      id: true,
      action: true,
      subject: true,
      reason: true,
      before: true,
      after: true,
      createdAt: true,
      actor: { select: { id: true, fullName: true, roles: true } },
    },
  });
}

/** What the log is made of, for the filter. */
export async function auditActions(actor: Actor) {
  const scope = auditScopeFor(actor);
  if (!scope) return [];

  const rows = await prisma.auditEvent.groupBy({
    by: ["action"],
    where: scope.kind === "own" ? { actorId: scope.actorId } : {},
    _count: true,
    orderBy: { _count: { action: "desc" } },
  });
  return rows.map((row) => ({ action: row.action, count: row._count }));
}
