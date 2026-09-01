"use server";

import { revalidatePath } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import { removeReview } from "@/lib/reviews/service";
import { isRemovalGround } from "@/lib/reviews/eligibility";
import { t } from "@/lib/i18n";

/**
 * Criterion 9 — removing a buyer's published words.
 *
 * Held one rung higher than moderating a queue: `review.remove` is ops lead
 * alone, and a moderator who may resolve a supplier report may not remove the
 * review it is about. The fence enforces that; this file does not re-check it.
 *
 * The ground and the reason stay separate all the way down. `removeReview`
 * validates the reason *before* composing `"${ground}: ${reason}"`, because
 * composing first meant an empty reason arrived as `"abuse: "` — seven
 * characters containing letters, which passed. Do not pre-compose here.
 */

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

function refused(error: unknown): ActionResult {
  if (error instanceof PermissionError) return { ok: false, error: t("admin.queue.not_yours") };
  if (error instanceof AuditReasonError) return { ok: false, error: t("admin.queue.needs_reason") };
  throw error;
}

export async function remove(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const ground = String(formData.get("ground") ?? "");

  // Narrowed here so the service takes a `RemovalGround` rather than a string
  // it has to re-check. It re-checks anyway; a form is not a contract.
  if (!isRemovalGround(ground)) return { ok: false, error: t("admin.reviews.pick_ground") };

  try {
    const result = await removeReview({
      actor: seat.actor,
      reviewId: String(formData.get("reviewId") ?? ""),
      ground,
      reason: String(formData.get("reason") ?? ""),
    });

    if (!result.ok) {
      /*
         The service returns raw codes here rather than written messages, unlike
         most of the console. Mapped rather than passed through, so nobody reads
         `already_removed` off a screen.
      */
      const written: Record<string, string> = {
        invalid_ground: t("admin.reviews.pick_ground"),
        not_found: t("admin.reviews.not_found"),
        already_removed: t("admin.reviews.already_removed"),
      };
      return { ok: false, error: written[result.error] ?? t("admin.reviews.not_found") };
    }

    revalidatePath("/admin/reviews");
    // The storefront carries the review and its rating average.
    revalidatePath("/admin");
    return { ok: true, message: t("admin.reviews.removed") };
  } catch (error) {
    return refused(error);
  }
}
