import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { assertReason, staffMutation } from "@/lib/audit";
import { can } from "@/lib/auth/can";
import type { Actor } from "@/lib/auth/roles";
import type { $Enums } from "@/lib/db/generated/client";
import { canDisputeReview, isDisputeGround, type DisputeGround } from "./eligibility";
import { removeReview } from "./service";
import { onReviewDisputeDecided } from "@/lib/notify/events";

/**
 * Board 11c `B5` — the review-dispute queue.
 *
 * *"The 2-day decision needs a queue."* The board promised a decision in about
 * two working days and named nowhere for the work to go; the spec ties it to
 * `4h` Reports & flags, which is drawn, shipped and reads
 * `lib/reports/service.ts`. This is the type that was missing.
 *
 * ## Why this is not a row in `SupplierReport`
 *
 * The obvious build was a fifth `ReportKind`, and it is wrong in all four of
 * the table's own columns. A supplier report is filed **against** a business,
 * by a buyer or by the platform, carries a free-text `subjectField` that feeds
 * the three-strikes auto-flag, and resolves to one of `seller_corrected`,
 * `upheld`, `no_action`. A dispute is filed **by** the business, about a
 * review, on one of four fixed grounds, and resolves to one of two — a review
 * cannot be "corrected". Sharing the table would have made
 * `subjectBusinessId` mean the complainant on some rows and the accused on
 * others, and `priorsFor()` would have counted a seller's own disputes as
 * reports against them.
 *
 * So it is its own table, rendered beside the conduct queue on the same screen.
 * A moderator sees one page; the two row shapes stay honest.
 *
 * ## Two ranks, one queue
 *
 * Refusing a dispute is `report.resolve` — moderator or ops lead. **Upholding
 * one removes a review**, and removing a buyer's published words is
 * `review.remove`, which docs/permissions.md holds at ops lead alone. So a
 * moderator can clear the queue of the disputes that fail and cannot grant one.
 * That falls out of the matrix rather than being invented here, and it is
 * checked before the transaction opens so a moderator gets a refusal rather
 * than a thrown capability error.
 */

export type DisputeOutcome = $Enums.ReviewDisputeOutcome;

export const DISPUTE_OUTCOMES = ["upheld", "refused"] as const satisfies readonly DisputeOutcome[];

/** What a seller writes with the ground. Short enough to be a claim, not a file. */
export const MIN_DETAIL = 20;
export const MAX_DETAIL = 2000;

export type OpenDisputeResult =
  | { ok: true; disputeId: string }
  | {
      ok: false;
      error:
        | "not_found"
        | "not_yours"
        | "already_removed"
        | "already_held"
        | "already_disputed"
        | "invalid_ground"
        | "detail_too_short";
    };

/**
 * A seller raises a dispute, from a specific review.
 *
 * Criterion 7: **no dispute can be started from the rail.** The rail explains
 * the grounds and has no form on it — the board's own render had a radio button
 * pre-selected on the first ground, for a dispute that had not been started
 * against a review that had not been chosen, which is a choice presented as
 * already made. This function requires a `reviewId` and there is no overload
 * that does not.
 *
 * The detail is required. A ground on its own is a checkbox, and a moderator
 * deciding inside two working days needs to know what the seller is actually
 * claiming — *"this is the competitor two units down"* is a case; `abuse` is a
 * label.
 */
export async function openDispute(input: {
  businessId: string;
  raisedById: string;
  reviewId: string;
  ground: string;
  detail: string;
}): Promise<OpenDisputeResult> {
  if (!isDisputeGround(input.ground)) return { ok: false, error: "invalid_ground" };

  const detail = input.detail.trim();
  if (detail.length < MIN_DETAIL) return { ok: false, error: "detail_too_short" };

  const review = await prisma.review.findUnique({
    where: { id: input.reviewId },
    select: {
      businessId: true,
      removedAt: true,
      heldAt: true,
      disputes: { where: { resolvedAt: null }, select: { id: true } },
    },
  });
  if (!review) return { ok: false, error: "not_found" };

  const verdict = canDisputeReview(
    {
      businessId: review.businessId,
      removedAt: review.removedAt,
      heldAt: review.heldAt,
      hasOpenDispute: review.disputes.length > 0,
    },
    input.businessId,
  );
  if (!verdict.ok) return { ok: false, error: verdict.reason };

  try {
    const dispute = await prisma.reviewDispute.create({
      data: {
        reviewId: input.reviewId,
        businessId: input.businessId,
        raisedById: input.raisedById,
        ground: input.ground as DisputeGround,
        detail: detail.slice(0, MAX_DETAIL),
      },
      select: { id: true },
    });
    return { ok: true, disputeId: dispute.id };
  } catch {
    /*
       The partial unique index caught what the read above missed.

       Two tabs, or two taps on a slow connection. Without the index the second
       write succeeds and one case is decided twice, on the queue whose whole
       promise to a seller is a single answer in two working days.
    */
    return { ok: false, error: "already_disputed" };
  }
}

/** Every open dispute this business has, keyed by review, for the seller's page. */
export async function openDisputesFor(businessId: string): Promise<Map<string, DisputeGround>> {
  const rows = await prisma.reviewDispute.findMany({
    where: { businessId, resolvedAt: null },
    select: { reviewId: true, ground: true },
  });
  return new Map(rows.map((row) => [row.reviewId, row.ground]));
}

export interface QueuedDispute {
  id: string;
  reviewId: string;
  businessName: string;
  businessSlug: string;
  ground: DisputeGround;
  detail: string;
  /** The words being disputed. A moderator cannot decide without them. */
  reviewBody: string;
  reviewOverall: number;
  reviewCreatedAt: Date;
  buyerName: string | null;
  /**
   * Whether the review came from an accepted quote.
   *
   * The single most useful fact on the `no_traceable_enquiry` ground, and it is
   * derived rather than stored — `provenanceOf` reads it off the enquiry. A
   * seller claiming the reviewer was never a buyer, against a review attached
   * to a quote that seller's own account accepted, has answered the dispute.
   */
  fromAcceptedQuote: boolean;
  createdAt: Date;
  ageDays: number;
}

/**
 * The queue. Open, oldest first — age before volume, like every other queue here.
 *
 * The board's SLA is "about 2 working days", and `ageDays` is what makes that
 * visible rather than aspirational.
 */
export async function openDisputes(limit = 100, now = new Date()): Promise<QueuedDispute[]> {
  const rows = await prisma.reviewDispute.findMany({
    where: { resolvedAt: null },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: {
      id: true,
      reviewId: true,
      ground: true,
      detail: true,
      createdAt: true,
      business: { select: { displayName: true, slug: true } },
      review: {
        select: {
          body: true,
          overall: true,
          createdAt: true,
          businessId: true,
          buyer: { select: { fullName: true } },
          enquiry: { select: { contactReleasedToBusinessId: true } },
        },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    reviewId: row.reviewId,
    businessName: row.business.displayName,
    businessSlug: row.business.slug,
    ground: row.ground,
    detail: row.detail,
    reviewBody: row.review.body,
    reviewOverall: row.review.overall,
    reviewCreatedAt: row.review.createdAt,
    buyerName: row.review.buyer.fullName,
    fromAcceptedQuote:
      row.review.enquiry.contactReleasedToBusinessId === row.review.businessId,
    createdAt: row.createdAt,
    ageDays: Math.floor((now.getTime() - row.createdAt.getTime()) / 86_400_000),
  }));
}

export type ResolveDisputeResult =
  | { ok: true }
  | {
      ok: false;
      error: "not_found" | "already_resolved" | "not_permitted" | "removal_failed";
      message: string;
    };

/**
 * Decide one. Two outcomes, a written reason on both, and an audit row each.
 *
 * An upheld dispute writes **two** audit rows — `review_dispute_resolved` and
 * `review_removed` — because two things happened and the log is read by
 * subject. Somebody asking "what happened to that review" greps
 * `Review:clx…` and finds the removal; somebody asking "how do we decide abuse
 * disputes" reads the resolutions. One row filed under either name would hide
 * the other question.
 *
 * Both commit in one transaction with the row they describe, so a review cannot
 * be removed against a dispute that is still open in the queue.
 */
export async function resolveDispute(
  input: { actor: Actor; disputeId: string; outcome: DisputeOutcome; reason: string },
  now = new Date(),
): Promise<ResolveDisputeResult> {
  const written = assertReason("review_dispute_resolved", input.reason);

  const dispute = await prisma.reviewDispute.findUnique({
    where: { id: input.disputeId },
    select: { id: true, reviewId: true, ground: true, outcome: true },
  });
  if (!dispute) {
    return { ok: false, error: "not_found", message: "That dispute is not in the queue." };
  }
  if (dispute.outcome) {
    return {
      ok: false,
      error: "already_resolved",
      message: `That dispute was already ${dispute.outcome}.`,
    };
  }

  /*
     Checked before the transaction opens.

     `removeReview` would throw on the capability inside it, which rolls back
     cleanly and reaches a moderator as a five-hundred. The matrix answer —
     a moderator may refuse a dispute and may not grant one — is a thing to say
     on screen, so it is asked here and rendered as a refusal.
  */
  if (input.outcome === "upheld" && !can(input.actor, "review.remove")) {
    return {
      ok: false,
      error: "not_permitted",
      message: "Upholding a dispute removes the review, which an ops lead does.",
    };
  }

  let removalFailed: string | null = null;

  await prisma.$transaction(async (tx) => {
    await staffMutation(
      {
        actor: input.actor,
        capability: "report.resolve",
        action: "review_dispute_resolved",
        subject: `ReviewDispute:${dispute.id}`,
        // The outcome and the ground in front of the prose, so the log answers
        // "what did we decide" without opening the row it points at.
        reason: `${input.outcome} (${dispute.ground}): ${written}`,
        tx,
      },
      async () => {
        const after = await tx.reviewDispute.update({
          where: { id: dispute.id },
          data: {
            outcome: input.outcome,
            outcomeReason: written,
            resolvedAt: now,
            decidedById: input.actor.id,
          },
          select: { outcome: true, resolvedAt: true },
        });
        return { result: true, before: { outcome: null }, after };
      },
    );

    if (input.outcome !== "upheld") return;

    // The one route to a removal, joined to this transaction rather than
    // duplicated inside it. Its own capability check, reason and audit row all
    // still apply — see `RemoveReviewInput.tx`.
    const removed = await removeReview({
      actor: input.actor,
      reviewId: dispute.reviewId,
      ground: dispute.ground,
      reason: written,
      tx,
    });
    if (!removed.ok) {
      removalFailed = removed.error;
      // Roll the resolution back with it. A dispute marked upheld over a review
      // that is still standing is the worst of the three possible states.
      throw new Error(`review removal failed: ${removed.error}`);
    }
  }).catch((cause: unknown) => {
    if (removalFailed === null) throw cause;
  });

  if (removalFailed !== null) {
    return {
      ok: false,
      error: "removal_failed",
      message:
        removalFailed === "already_removed"
          ? "That review has already been removed. Refuse the dispute instead."
          : "The review could not be removed, so nothing was changed.",
    };
  }

  /*
     The half of the promise that leaves the platform.

     The rail says "decided by our team in about 2 working days — the outcome
     and the reason are logged and sent to you", and a seller who has to keep
     reopening the page to find out has been told something untrue. Outside the
     transaction and fire-and-forget: a carrier being down must not roll back a
     moderator's decision.
  */
  await onReviewDisputeDecided({ disputeId: dispute.id });

  return { ok: true };
}

/**
 * Board 11c `B6` — the incentivised-review log.
 *
 * The request panel says, at the moment of sending: *"We never offer an
 * incentive for a review and neither can you: an incentivised review is removed
 * and logged against your account."* Until this function the second half was a
 * bluff — `ReportKind.review_integrity` existed with nothing to join it to, and
 * `lib/reviews/service.ts` had already written down that a review nobody had
 * reported could not be reached at all.
 *
 * One record per finding, against the account, in `4h`. It is a
 * `SupplierReport` and not a dispute, and that is the right way round: this is
 * conduct, filed against the business, by us. Which is exactly the shape the
 * table already has, and exactly the shape a dispute does not.
 *
 * Removing the review is a separate, deliberate act on the `incentivised`
 * ground — the finding and the takedown are two decisions, and a moderator who
 * logs one without the other has recorded something true.
 */
export async function logIncentiveFinding(input: {
  actor: Actor;
  reviewId: string;
  reason: string;
}): Promise<{ ok: true; reportId: string } | { ok: false; error: "not_found" | "already_logged" }> {
  const written = assertReason("incentive_logged", input.reason);

  const review = await prisma.review.findUnique({
    where: { id: input.reviewId },
    select: { id: true, businessId: true },
  });
  if (!review) return { ok: false, error: "not_found" };

  const existing = await prisma.supplierReport.findFirst({
    where: { reviewId: input.reviewId, kind: "review_integrity" },
    select: { id: true },
  });
  if (existing) return { ok: false, error: "already_logged" };

  let reportId = "";

  await prisma.$transaction(async (tx) => {
    await staffMutation(
      {
        actor: input.actor,
        capability: "report.resolve",
        // Not `report_resolved`: this *opens* a queue item where resolving
        // closes one, and a log that files them under one name says the
        // opposite of what happened on half the rows.
        action: "incentive_logged",
        subject: `Review:${input.reviewId}`,
        reason: `incentivised: ${written}`,
        tx,
      },
      async () => {
        const report = await tx.supplierReport.create({
          data: {
            subjectBusinessId: review.businessId,
            reporterId: input.actor.id,
            kind: "review_integrity",
            reviewId: input.reviewId,
            detail: written,
          },
          select: { id: true },
        });
        reportId = report.id;
        return { result: report, after: report };
      },
    );
  });

  return { ok: true, reportId };
}
