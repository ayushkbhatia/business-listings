"use server";

import { revalidatePath } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import { removeQuestion } from "@/lib/questions/service";
import { t } from "@/lib/i18n";

/**
 * Removing a product question.
 *
 * Nothing here re-checks the capability. `removeQuestion` asserts it and
 * `staffMutation` writes the audit row inside the same transaction — a second
 * check here would be a second place to get it wrong, and the screen gates what
 * it *offers* while the service decides what it *permits*.
 */
export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

export async function remove(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await removeQuestion({
      actor: seat.actor,
      questionId: String(formData.get("questionId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) {
      return {
        ok: false,
        error:
          result.error === "already_removed"
            ? t("admin.questions.already_removed")
            : t("admin.queue.not_yours"),
      };
    }
    revalidatePath("/admin/questions");
    return { ok: true, message: t("admin.questions.removed") };
  } catch (error) {
    if (error instanceof PermissionError) return { ok: false, error: t("admin.queue.not_yours") };
    if (error instanceof AuditReasonError) return { ok: false, error: t("admin.queue.needs_reason") };
    throw error;
  }
}
