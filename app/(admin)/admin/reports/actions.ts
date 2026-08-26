"use server";

import { revalidatePath } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import { resolveReport, type ReportOutcome } from "@/lib/reports/service";
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
