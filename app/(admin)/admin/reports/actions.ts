"use server";

import { revalidatePath } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import { isChosenOutcome, resolveReport } from "@/lib/reports/service";
import { assignReport, escalateReport, markDuplicate, type DecideError } from "@/lib/reports/decide";
import { applyDetectorRules } from "@/lib/reports/detector-settings";
import { DEFAULT_DETECTOR_RULES, type DetectorRules } from "@/lib/reports/detector-rules";
import { resolveDispute, type DisputeOutcome } from "@/lib/reviews/disputes";
import { removeSellerReply as removeSellerReplyService } from "@/lib/reviews/service";
import { t } from "@/lib/i18n";

/**
 * Board 4h — every write this board makes, and the shape of a refusal.
 *
 * `fix` on a failure is not decoration: design system §08 says an error states
 * what is wrong **and what correct looks like**, and half of these refusals are
 * a permission the seat does not hold, where the fix is naming the seat that
 * does rather than telling somebody to try again.
 */

export type ActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string; fix: string };

function refused(error: string, fix: string): ActionResult {
  return { ok: false, error, fix };
}

/** The two every write here can throw, answered once. */
function thrown(error: unknown): ActionResult | null {
  if (error instanceof PermissionError) {
    return refused(t("admin.queue.not_yours"), t("admin.reports.fix.not_yours"));
  }
  if (error instanceof AuditReasonError) {
    return refused(t("admin.queue.needs_reason"), t("admin.review.reason_hint"));
  }
  return null;
}

const DECIDE_ERRORS: Record<DecideError, { error: string; fix: string }> = {
  not_found: { error: "admin.reports.error.not_found", fix: "admin.reports.fix.not_found" },
  already_resolved: {
    error: "admin.reports.error.gone",
    fix: "admin.reports.fix.not_found",
  },
  not_staff: { error: "admin.reports.error.not_staff", fix: "admin.reports.fix.not_staff" },
  not_a_duplicate: {
    error: "admin.reports.error.not_a_duplicate",
    fix: "admin.reports.fix.not_a_duplicate",
  },
};

function decideFailure(error: DecideError): ActionResult {
  const message = DECIDE_ERRORS[error];
  return refused(
    t(message.error as "admin.reports.error.not_found"),
    t(message.fix as "admin.reports.fix.not_found"),
  );
}

/** Everything this board changes is stale on both the queue and the console. */
function revalidateQueue(): void {
  revalidatePath("/admin/reports");
  revalidatePath("/admin");
}

/* ── Closing a report ──────────────────────────────────────────────────────── */

export async function resolve(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const outcome = String(formData.get("outcome") ?? "");
  if (!isChosenOutcome(outcome)) {
    // Three outcomes, and none of them moves money. There is no fourth a person
    // picks: `duplicate` is written against the report it duplicates.
    return refused(t("admin.queue.pick_a_resolution"), t("admin.reports.fix.pick_outcome"));
  }

  try {
    const result = await resolveReport({
      actor: seat.actor,
      reportId: String(formData.get("reportId") ?? ""),
      outcome,
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) {
      return result.error === "already_resolved"
        ? refused(
            t("admin.reports.error.already_resolved", {
              outcome: t(`admin.reports.outcome.${result.outcome}` as "admin.reports.outcome.upheld"),
            }),
            t("admin.reports.fix.not_found"),
          )
        : refused(t("admin.reports.error.not_found"), t("admin.reports.fix.not_found"));
    }
    revalidateQueue();
    return {
      ok: true,
      message:
        result.alsoClosed > 0
          ? t("admin.reports.resolved_with_duplicates", { count: result.alsoClosed })
          : t("admin.reports.resolved"),
    };
  } catch (error) {
    const answer = thrown(error);
    if (answer) return answer;
    throw error;
  }
}

/* ── The owner column ──────────────────────────────────────────────────────── */

export async function assign(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const assigneeId = String(formData.get("assigneeId") ?? "");
  try {
    const result = await assignReport({
      actor: seat.actor,
      ref: String(formData.get("ref") ?? ""),
      assigneeId: assigneeId === "" ? null : assigneeId,
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return decideFailure(result.error);
    revalidateQueue();
    return {
      ok: true,
      message: assigneeId === "" ? t("admin.reports.unassigned_done") : t("admin.reports.assigned"),
    };
  } catch (error) {
    const answer = thrown(error);
    if (answer) return answer;
    throw error;
  }
}

/* ── Escalation, which is not a suspension ─────────────────────────────────── */

export async function escalate(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await escalateReport({
      actor: seat.actor,
      reportId: String(formData.get("reportId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return decideFailure(result.error);
    revalidateQueue();
    return { ok: true, message: t("admin.reports.escalated_done") };
  } catch (error) {
    const answer = thrown(error);
    if (answer) return answer;
    throw error;
  }
}

/* ── A duplicate a person spotted ──────────────────────────────────────────── */

export async function duplicate(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await markDuplicate({
      actor: seat.actor,
      reportId: String(formData.get("reportId") ?? ""),
      duplicateOfId: String(formData.get("duplicateOfId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return decideFailure(result.error);
    revalidateQueue();
    return { ok: true, message: t("admin.reports.duplicate_done") };
  } catch (error) {
    const answer = thrown(error);
    if (answer) return answer;
    throw error;
  }
}

/* ── Review disputes ───────────────────────────────────────────────────────── */

const DISPUTE_OUTCOMES = ["upheld", "refused"] as const;

function isDisputeOutcome(value: string): value is DisputeOutcome {
  return (DISPUTE_OUTCOMES as readonly string[]).includes(value);
}

/**
 * Board 11c `B5` — decide a review dispute.
 *
 * Two outcomes, not three. A listing can be corrected and a review cannot: it
 * comes down or it stands, and a third button that resolves to nothing is how a
 * queue starts producing decisions nobody can act on.
 *
 * Upholding one removes the review, which is `review.remove` and therefore ops
 * lead. `resolveDispute` checks that before it opens the transaction and
 * returns a sentence rather than throwing, so a moderator who tries is told
 * where the decision lives instead of meeting a five-hundred.
 */
export async function decideDispute(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const outcome = String(formData.get("outcome") ?? "");
  if (!isDisputeOutcome(outcome)) {
    return refused(t("admin.disputes.pick_an_outcome"), t("admin.reports.fix.pick_outcome"));
  }

  try {
    const result = await resolveDispute({
      actor: seat.actor,
      disputeId: String(formData.get("disputeId") ?? ""),
      outcome,
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return refused(result.message, t("admin.reports.fix.not_yours"));
    revalidateQueue();
    revalidatePath("/admin/reviews");
    return {
      ok: true,
      message: outcome === "upheld" ? t("admin.disputes.upheld") : t("admin.disputes.refused"),
    };
  } catch (error) {
    const answer = thrown(error);
    if (answer) return answer;
    throw error;
  }
}

/* ── Board 11c `B4`, on this board (`B10`) ─────────────────────────────────── */

/**
 * Remove a seller's public reply.
 *
 * *"A reply can itself breach policy."* The service is `lib/reviews/service.ts`'s
 * `removeReply`, unchanged and unwrapped — this is the same call
 * `/admin/reviews` makes, not a second one that looks like it. The seller's
 * text is not nulled: it is the record of what was said, every reader hides it
 * behind the neutral line, and the seller does not get a second reply out of
 * it.
 */
export async function removeSellerReply(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await removeSellerReplyService({
      actor: seat.actor,
      reviewId: String(formData.get("reviewId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) {
      return result.error === "not_found"
        ? refused(t("admin.reports.error.not_found"), t("admin.reports.fix.not_found"))
        : refused(t("admin.reports.error.reply_gone"), t("admin.reports.fix.not_found"));
    }
    revalidateQueue();
    revalidatePath("/admin/reviews");
    return { ok: true, message: t("admin.reports.reply_removed") };
  } catch (error) {
    const answer = thrown(error);
    if (answer) return answer;
    throw error;
  }
}

/* ── The detector thresholds (`B11`) ───────────────────────────────────────── */

function readRules(formData: FormData): DetectorRules {
  const number = (name: string, fallback: number) => {
    const raw = Number(formData.get(name));
    return Number.isFinite(raw) ? Math.trunc(raw) : fallback;
  };
  return {
    sharedPhoneListings: number(
      "sharedPhoneListings",
      DEFAULT_DETECTOR_RULES.sharedPhoneListings,
    ),
    licenceExpiredDays: number("licenceExpiredDays", DEFAULT_DETECTOR_RULES.licenceExpiredDays),
    sweeps: {
      shared_phone: formData.get("shared_phone") === "on",
      licence_long_expired: formData.get("licence_long_expired") === "on",
    },
  };
}

export async function saveDetectorRules(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await applyDetectorRules({
      actor: seat.actor,
      rules: readRules(formData),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) {
      return refused(
        t(`admin.detectors.error.${result.problem.field}` as "admin.detectors.error.sharedPhoneListings", {
          min: String(result.problem.min),
          max: String(result.problem.max),
        }),
        t("admin.detectors.fix.bounds"),
      );
    }
    revalidatePath("/admin/reports/detectors");
    revalidateQueue();
    return { ok: true, message: t("admin.detectors.saved") };
  } catch (error) {
    const answer = thrown(error);
    if (answer) return answer;
    throw error;
  }
}
