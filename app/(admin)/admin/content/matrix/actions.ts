"use server";

import { revalidatePath } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import { editCategory } from "@/lib/taxonomy/service";
import { t } from "@/lib/i18n";

/**
 * Board 6f's one mutation: the copy on a landing page.
 *
 * Through `editCategory`, so it writes the same audited row a threshold change
 * does. A paragraph that decides whether a page publishes is a change somebody
 * should have to explain.
 */

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

export async function saveIntro(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await editCategory({
      actor: seat.actor,
      categoryId: String(formData.get("categoryId") ?? ""),
      intro: String(formData.get("intro") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.message };

    revalidatePath("/admin/content/matrix");
    revalidatePath("/admin/categories");
    return { ok: true, message: t("matrix.saved") };
  } catch (error) {
    if (error instanceof PermissionError) return { ok: false, error: t("matrix.not_yours") };
    if (error instanceof AuditReasonError) return { ok: false, error: t("builder.needs_reason") };
    throw error;
  }
}
