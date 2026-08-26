"use server";

import { revalidatePath } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import { promoteTemplate, saveTemplate } from "@/lib/notify/templates";
import { t } from "@/lib/i18n";

/** Board 12g's two mutations. Both audited through the service. */

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

function refused(error: unknown): ActionResult {
  if (error instanceof PermissionError) return { ok: false, error: t("notifications.not_yours") };
  if (error instanceof AuditReasonError) return { ok: false, error: t("builder.needs_reason") };
  throw error;
}

export async function saveDraft(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await saveTemplate({
      actor: seat.actor,
      templateId: String(formData.get("templateId") ?? ""),
      subject: String(formData.get("subject") ?? "") || null,
      body: String(formData.get("body") ?? ""),
      actionLabel: String(formData.get("actionLabel") ?? "") || null,
      actionPath: String(formData.get("actionPath") ?? "") || null,
      metaTemplateName: String(formData.get("metaTemplateName") ?? "") || null,
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.message };

    revalidatePath("/admin/notifications");
    return {
      ok: true,
      message: t("notifications.saved", { version: String(result.version) }),
    };
  } catch (error) {
    return refused(error);
  }
}

export async function promote(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await promoteTemplate(
      seat.actor,
      String(formData.get("templateId") ?? ""),
      String(formData.get("reason") ?? ""),
    );
    if (!result.ok) return { ok: false, error: result.message };

    revalidatePath("/admin/notifications");
    return {
      ok: true,
      message:
        result.status === "pending_meta"
          ? t("notifications.submitted")
          : t("notifications.live"),
    };
  } catch (error) {
    return refused(error);
  }
}
