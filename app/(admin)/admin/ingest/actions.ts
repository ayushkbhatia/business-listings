"use server";

import { revalidatePath } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import { approveRun } from "@/lib/ingest/service";
import { t } from "@/lib/i18n";

/**
 * Approving a run is the moment listings appear. It is the audited event, and
 * the only path here that writes a `Business`.
 */

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

export async function approve(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await approveRun({
      actor: seat.actor,
      runId: String(formData.get("runId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.message };
    revalidatePath("/admin/ingest");
    revalidatePath("/admin");
    return { ok: true, message: t("admin.run.approved") };
  } catch (error) {
    if (error instanceof PermissionError) return { ok: false, error: t("admin.queue.not_yours") };
    if (error instanceof AuditReasonError) {
      return { ok: false, error: t("admin.queue.needs_reason") };
    }
    throw error;
  }
}
