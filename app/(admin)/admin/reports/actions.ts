"use server";

import { revalidatePath } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import { resolveReport, type ReportOutcome } from "@/lib/reports/service";
import { resolveDispute, type DisputeOutcome } from "@/lib/reviews/disputes";
import { t } from "@/lib/i18n";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

const OUTCOMES = ["seller_corrected", "upheld", "no_action"] as const;

function isOutcome(value: string): value is ReportOutcome {
  return (OUTCOMES as readonly string[]).includes(value);
}

export async function resolve(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const outcome = String(formData.get("outcome") ?? "");
  if (!isOutcome(outcome)) {
    // Three outcomes, and none of them moves money. There is no fourth.
    return { ok: false, error: t("admin.queue.pick_a_resolution") };
  }

  try {
    const result = await resolveReport({
      actor: seat.actor,
      reportId: String(formData.get("reportId") ?? ""),
      outcome,
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.message };
    revalidatePath("/admin/reports");
    revalidatePath("/admin");
    return { ok: true, message: t("admin.reports.resolved") };
  } catch (error) {
    if (error instanceof PermissionError) return { ok: false, error: t("admin.queue.not_yours") };
    if (error instanceof AuditReasonError) {
      return { ok: false, error: t("admin.queue.needs_reason") };
    }
    throw error;
  }
}

const DISPUTE_OUTCOMES = ["upheld", "refused"] as const;

function isDisputeOutcome(value: string): value is DisputeOutcome {
  return (DISPUTE_OUTCOMES as readonly string[]).includes(value);
}

/**
 * Board 11c `B5` — decide a review dispute.
 *
 * Two outcomes, not three. A listing can be corrected and a review cannot: it
 * comes down or it stands, and offering a moderator a third button that
 * resolves to nothing is how a queue starts producing decisions nobody can act
 * on.
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
    return { ok: false, error: t("admin.disputes.pick_an_outcome") };
  }

  try {
    const result = await resolveDispute({
      actor: seat.actor,
      disputeId: String(formData.get("disputeId") ?? ""),
      outcome,
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.message };
    revalidatePath("/admin/reports");
    revalidatePath("/admin/reviews");
    revalidatePath("/admin");
    return {
      ok: true,
      message: outcome === "upheld" ? t("admin.disputes.upheld") : t("admin.disputes.refused"),
    };
  } catch (error) {
    if (error instanceof PermissionError) return { ok: false, error: t("admin.queue.not_yours") };
    if (error instanceof AuditReasonError) {
      return { ok: false, error: t("admin.queue.needs_reason") };
    }
    throw error;
  }
}
