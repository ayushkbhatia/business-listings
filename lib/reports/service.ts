import "server-only";
import { prisma } from "@/lib/db/client";
import { PROPOSAL_RECORD_SELECT, toProposalRecord } from "@/lib/quote/proposal";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import { auditScopeFor } from "@/lib/auth/subject";
import type { Actor } from "@/lib/auth/roles";
import type { $Enums } from "@/lib/db/generated/client";
import { onReportResolved } from "@/lib/notify/events";
import { collapses, reportSource } from "./collapse";

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
 * ## No kind skips the queue
 *
 * The first README had off-platform payment reports skip it, straight to an
 * ops lead with a suspension control. Board 4h put them in the one queue with
 * the shortest service level instead (`lib/reports/sla.ts`), and board 13c's
 * `B7` removed the last expedited path: urgency is a clock, not a side door.
 * `openReports` below still leaves them out, for the trust suite that reads
 * it; the queue the console renders is `lib/reports/queue.ts`.
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
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
    select: {
      id: true,
      kind: true,
      subjectField: true,
      detail: true,
      createdAt: true,
      // Board `7c`: set on a report filed from an accepted record, whose thread
      // is the evidence `reportEvidence` reads.
      enquiryId: true,
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
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
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
  | { ok: true; alsoClosed: number }
  /**
   * The reason, as a key. Never a sentence.
   *
   * This carried a `message` of raw English that `admin/reports/actions.ts`
   * returned to the screen verbatim — the one path in that file that skipped
   * `t()`, and the `already_resolved` one interpolated a raw enum value into
   * it as well ("resolved as seller_corrected"). Non-negotiable 5: every
   * user-visible string goes through the catalogue, and a service layer is not
   * where the catalogue lives.
   */
  | { ok: false; error: "not_found" }
  | { ok: false; error: "already_resolved"; outcome: ReportOutcome };

export interface ResolveReportInput {
  actor: Actor;
  reportId: string;
  outcome: ReportOutcome;
  reason: string;
}

/**
 * The outcomes a person chooses. `duplicate` is not one of them.
 *
 * A duplicate is written by the platform — either by this function, closing the
 * rest of a collapsed group along with the report a moderator decided, or by
 * `markDuplicate` in `./decide.ts`, which takes the report it duplicates as an
 * argument. Offering `duplicate` as a fourth button with nothing to point at
 * would produce rows whose `duplicateOfId` is null, which the check constraint
 * refuses and which would be meaningless if it did not.
 */
export const CHOSEN_OUTCOMES = [
  "seller_corrected",
  "upheld",
  "no_action",
] as const satisfies readonly ReportOutcome[];

export type ChosenOutcome = (typeof CHOSEN_OUTCOMES)[number];

export function isChosenOutcome(value: string): value is ChosenOutcome {
  return (CHOSEN_OUTCOMES as readonly string[]).includes(value);
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
    select: {
      id: true,
      outcome: true,
      subjectBusinessId: true,
      kind: true,
      subjectField: true,
      enquiryId: true,
      reviewId: true,
      createdAt: true,
    },
  });
  if (!report) {
    return { ok: false, error: "not_found" };
  }
  if (report.outcome) {
    return { ok: false, error: "already_resolved", outcome: report.outcome };
  }

  /*
     Board 4h `B6` — the rest of the collapsed group.

     The queue shows three buyers reporting one telephone number as one row with
     a count, so a decision on that row is a decision on all three. Recomputed
     here rather than passed in from the screen: a list of ids arriving from a
     client is a list a client could have widened, and the group is one indexed
     read.

     Only reports **filed after** this one, which is the same rule the collapse
     uses to pick the work item. A report filed earlier is its own work item and
     a decision on a later one does not reach back to close it.
  */
  const siblings = collapses(report)
    ? await prisma.supplierReport.findMany({
        where: {
          subjectBusinessId: report.subjectBusinessId,
          kind: report.kind,
          subjectField: report.subjectField,
          outcome: null,
          id: { not: report.id },
          createdAt: { gte: report.createdAt },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true },
      })
    : [];

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
            resolvedById: input.actor.id,
            /*
               Board 13c `B8`. The requester digest exists to count one source
               once while a report is open; a decided report is in no group and
               counts nothing, so the digest goes with the decision rather than
               staying on the row for as long as the row does.
            */
            reporterKey: null,
          },
          select: { outcome: true, resolvedAt: true },
        });

        /*
           The duplicates take the same decision and say whose it was. They are
           not separately audited: one decision was made, the audit row above
           records it, and `duplicateOfId` on each of these is the pointer from
           the record to that decision. A row per duplicate would say a
           moderator made three decisions in one afternoon that they did not.
        */
        if (siblings.length > 0) {
          await tx.supplierReport.updateMany({
            where: { id: { in: siblings.map((row) => row.id) } },
            data: {
              outcome: "duplicate",
              duplicateOfId: report.id,
              outcomeReason: input.reason,
              resolvedAt: now,
              resolvedById: input.actor.id,
              reporterKey: null,
            },
          });
        }

        return {
          result: true,
          before: { outcome: null },
          after: { ...after, duplicatesClosed: siblings.length },
        };
      },
    );
  });

  /*
     Board 4h `Q5` — *"does the reporter ever hear back?"*

     Until this line, no: 46 open items, a 2.4-day median and no notification in
     the model. It sends to every reporter in the group, not only the one whose
     row a moderator happened to open — three people asked and three people are
     owed the answer. Outside the transaction and fire-and-forget: a carrier
     being down must not roll back a decision.
  */
  await onReportResolved({ reportIds: [report.id, ...siblings.map((row) => row.id)] });

  return { ok: true, alsoClosed: siblings.length };
}

/* ── One report, in full ──────────────────────────────────────────────────── */

/**
 * Board 4h `B5` — *"`Investigate` needs a destination."*
 *
 * The board's primary action on its oldest, reddest row went nowhere: `4b` has
 * `4c` at `/admin/queue/:id` and this queue had a detail route that answered
 * only for the one report kind carrying an enquiry — every other row 404'd.
 *
 * This is the read behind the destination, and it answers for every kind. What
 * a moderator needs and nothing more: the claim, the measurement, who filed it,
 * what else has been said about this business and this field, the rest of the
 * group the row stands for, and — where the report is about one — the review or
 * the accepted record. The decision itself is taken here and audited by the same
 * `resolveReport` the queue has always used, so there is still one place a
 * report is closed and one audit trail for it.
 */
export async function reportDetail(reportId: string) {
  const report = await prisma.supplierReport.findUnique({
    where: { id: reportId },
    select: {
      id: true,
      kind: true,
      subjectField: true,
      detail: true,
      evidence: true,
      detector: true,
      outcome: true,
      outcomeReason: true,
      resolvedAt: true,
      escalatedAt: true,
      escalationReason: true,
      createdAt: true,
      reviewId: true,
      enquiryId: true,
      duplicateOfId: true,
      subjectBusinessId: true,
      /* Board 13c — what the modal now captures. */
      reference: true,
      subjectValue: true,
      subjectValueKey: true,
      suggestedValue: true,
      suggestedCategory: { select: { id: true, name: true } },
      reporterId: true,
      reporterKey: true,
      reporterEmail: true,
      reporterEmailedAt: true,
      reporter: { select: { id: true, fullName: true } },
      assignee: { select: { id: true, fullName: true } },
      escalatedBy: { select: { id: true, fullName: true } },
      resolvedBy: { select: { id: true, fullName: true } },
      subjectBusiness: {
        select: {
          id: true,
          displayName: true,
          slug: true,
          suspendedAt: true,
          closedAt: true,
          closureRequestedAt: true,
          licenceExpiry: true,
          verificationTier: true,
        },
      },
      enquiry: { select: { ref: true } },
      review: {
        select: {
          id: true,
          overall: true,
          body: true,
          createdAt: true,
          removedAt: true,
          removalReason: true,
          heldAt: true,
          sellerReply: true,
          replyRemovedAt: true,
          buyer: { select: { fullName: true } },
        },
      },
    },
  });
  if (!report) return null;

  const [priors, group, duplicatesClosed, valueGroup] = await Promise.all([
    priorsFor(report.subjectBusinessId, report.subjectField),
    /*
       The rest of the work item. Same rule as the collapse and the resolve: the
       group is the open reports about this business, this kind and this field
       filed no earlier than this one.
    */
    collapses(report)
      ? prisma.supplierReport.findMany({
          where: {
            subjectBusinessId: report.subjectBusinessId,
            kind: report.kind,
            subjectField: report.subjectField,
            outcome: null,
            id: { not: report.id },
            createdAt: { gte: report.createdAt },
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            detail: true,
            createdAt: true,
            detector: true,
            reporter: { select: { fullName: true } },
          },
        })
      : Promise.resolve([]),
    /* What this report already closed, where it has been decided. */
    prisma.supplierReport.count({ where: { duplicateOfId: report.id } }),
    /*
       Board 13c `B2` — the same value, open, on other listings. `4h`'s
       `SAME NUMBER ON 4 LISTINGS`, made into links: a moderator deciding one
       of them should see the other three before deciding the first.
    */
    report.subjectValueKey
      ? prisma.supplierReport.findMany({
          where: {
            kind: report.kind,
            subjectField: report.subjectField,
            subjectValueKey: report.subjectValueKey,
            outcome: null,
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: 200,
          select: {
            id: true,
            reporterId: true,
            reporterKey: true,
            detector: true,
            subjectBusinessId: true,
            subjectBusiness: { select: { displayName: true, slug: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  /*
     The address itself stays in the row, for the one message it buys; the
     screen is told only that there is one. A moderator deciding a report has
     no use for a stranger's mailbox, and a field nobody renders is a field
     nobody copies into a ticket.
  */
  const replyTo: "account" | "email" | "emailed" | "none" = report.reporterId
    ? "account"
    : report.reporterEmail
      ? "email"
      : report.reporterEmailedAt
        ? "emailed"
        : "none";
  const shown = { ...report, reporterEmail: null, reporterKey: null };

  const otherListings = new Map<string, { businessName: string; slug: string; reportId: string }>();
  for (const row of valueGroup) {
    if (row.subjectBusinessId === report.subjectBusinessId || otherListings.has(row.subjectBusinessId)) continue;
    otherListings.set(row.subjectBusinessId, {
      businessName: row.subjectBusiness.displayName,
      slug: row.subjectBusiness.slug,
      reportId: row.id,
    });
  }
  const sources = new Set([...valueGroup, report].map(reportSource)).size;

  return {
    report: shown,
    replyTo,
    priors,
    group,
    duplicatesClosed,
    valueGroup: {
      /** Distinct sources across the value group, this report included. */
      sources,
      /** One row per other listing carrying the value, oldest report first. */
      otherListings: [...otherListings.values()],
    },
  };
}

export type ReportDetail = NonNullable<Awaited<ReturnType<typeof reportDetail>>>;

/**
 * One dispute, in full, for the detail screen beside it.
 *
 * A separate read from `reportDetail` and a separate route, because the two
 * rows are different in every field. What they share is the frame: the same
 * breadcrumb, the same owner control, the same audit promise.
 */
export async function disputeDetail(disputeId: string) {
  const dispute = await prisma.reviewDispute.findUnique({
    where: { id: disputeId },
    select: {
      id: true,
      ground: true,
      detail: true,
      outcome: true,
      outcomeReason: true,
      resolvedAt: true,
      createdAt: true,
      reviewId: true,
      raisedBy: { select: { id: true, fullName: true } },
      decidedBy: { select: { id: true, fullName: true } },
      assignee: { select: { id: true, fullName: true } },
      business: {
        select: { id: true, displayName: true, slug: true, suspendedAt: true },
      },
      review: {
        select: {
          id: true,
          overall: true,
          quotedAccurate: true,
          onTime: true,
          asDescribed: true,
          responsiveness: true,
          body: true,
          createdAt: true,
          removedAt: true,
          removalReason: true,
          heldAt: true,
          sellerReply: true,
          sellerRepliedAt: true,
          replyRemovedAt: true,
          businessId: true,
          buyer: { select: { fullName: true } },
          enquiry: { select: { ref: true, contactReleasedToBusinessId: true } },
        },
      },
    },
  });
  if (!dispute) return null;

  /*
     Board 11c `B6`, read where the spec asks for it (`B9`): whether this review
     already carries an incentive finding. The seller's dispute and our own
     finding about the same review are two different records, and a moderator
     deciding one should be able to see the other.
  */
  const incentiveFinding = await prisma.supplierReport.findFirst({
    where: { reviewId: dispute.reviewId, kind: "review_integrity" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, detail: true, createdAt: true, outcome: true },
  });

  return {
    dispute,
    incentiveFinding,
    fromAcceptedQuote:
      dispute.review.enquiry.contactReleasedToBusinessId === dispute.review.businessId,
  };
}

export type DisputeDetail = NonNullable<Awaited<ReturnType<typeof disputeDetail>>>;

/**
 * Board 11c `B6` — the incentivised-review log, readable here (`B9`).
 *
 * *"One record per finding, against the account. Without it the sentence is a
 * bluff."* The sentence is the one every review request carries: *we never
 * offer an incentive for a review and neither can you — an incentivised review
 * is removed and logged against your account.* `logIncentiveFinding` writes the
 * record and `/admin/reviews` could see it; this board, which the build note
 * names, could not.
 *
 * Open and closed together, newest first. A finding that has been acted on is
 * still the log — the whole point of the promise is that it outlives the
 * removal.
 */
export async function incentiveFindings(limit = 25) {
  const rows = await prisma.supplierReport.findMany({
    where: { kind: "review_integrity", reviewId: { not: null } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      id: true,
      detail: true,
      outcome: true,
      createdAt: true,
      reporter: { select: { fullName: true } },
      subjectBusiness: { select: { displayName: true, slug: true } },
      review: { select: { id: true, overall: true, removedAt: true } },
    },
  });
  const total = await prisma.supplierReport.count({
    where: { kind: "review_integrity", reviewId: { not: null } },
  });
  return { rows, total };
}

/* ── Evidence: the thread behind an accepted-quote report ─────────────────── */

/**
 * Board `7c` `B8` — *"goes to the trust team with the thread attached"*.
 *
 * The thread is attached by reference: `SupplierReport.enquiryId`, read here,
 * rather than a copy pasted into `detail` at filing time. A copy would be a
 * second record of the conversation that stopped matching the first the moment
 * a message was flagged.
 *
 * What a moderator needs to judge conduct and nothing more: the report, the
 * accepted quote as it was accepted, and the messages between the buyer and
 * that one supplier — not the other suppliers' threads, which are about other
 * businesses. Null for a report that carries no enquiry, which the route turns
 * into a 404: listing reports have no thread to attach.
 */
export async function reportEvidence(reportId: string) {
  const report = await prisma.supplierReport.findUnique({
    where: { id: reportId },
    select: {
      id: true,
      kind: true,
      detail: true,
      outcome: true,
      outcomeReason: true,
      resolvedAt: true,
      createdAt: true,
      subjectBusinessId: true,
      subjectBusiness: { select: { displayName: true, slug: true, suspendedAt: true } },
      reporter: { select: { fullName: true } },
      enquiry: {
        select: {
          id: true,
          ref: true,
          requirement: true,
          contactReleasedToBusinessId: true,
          contactReleasedAt: true,
          buyerReference: true,
        },
      },
    },
  });
  if (!report?.enquiry) return null;

  const [quote, messages] = await Promise.all([
    prisma.quote.findFirst({
      where: {
        enquiryId: report.enquiry.id,
        businessId: report.subjectBusinessId,
        status: "accepted",
      },
      orderBy: [{ acceptedAt: "desc" }, { revision: "desc" }, { id: "asc" }],
      select: {
        ref: true,
        revision: true,
        acceptedAt: true,
        paymentTerms: true,
        delivery: true,
        note: true,
        lines: {
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          select: { id: true, description: true, qty: true, unitPrice: true, leadTimeDays: true },
        },
        // Board `3j-s`: a report about an accepted proposal is judged against the
        // scope and the exclusions, which are the whole of what was agreed.
        proposal: { select: PROPOSAL_RECORD_SELECT },
      },
    }),
    prisma.message.findMany({
      where: { enquiryId: report.enquiry.id, businessId: report.subjectBusinessId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        body: true,
        automatic: true,
        flaggedAt: true,
        createdAt: true,
        authorSide: true,
      },
    }),
  ]);

  return {
    report,
    enquiry: report.enquiry,
    quote: quote ? { ...quote, proposal: toProposalRecord(quote.proposal) } : null,
    messages: messages.map((message) => ({
      id: message.id,
      body: message.body,
      automatic: message.automatic,
      flagged: message.flaggedAt !== null,
      createdAt: message.createdAt,
      // Board `10h` B5: the evidence reads as it was written, whoever has left the team since.
      fromSupplier: message.authorSide === "seller",
    })),
  };
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
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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
