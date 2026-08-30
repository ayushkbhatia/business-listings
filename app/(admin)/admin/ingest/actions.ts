"use server";

import { revalidatePath } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import { assertCan } from "@/lib/auth/can";
import { approveRun, stageRun } from "@/lib/ingest/service";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Approving a run is the moment listings appear. It is the audited event, and
 * the only path here that writes a `Business`.
 */

export type ActionResult =
  | { ok: true; message: string; runId?: string }
  | { ok: false; error: string };

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

/**
 * Staging a file. Not audited, and gated here rather than in the service.
 *
 * `stageRun` deliberately sits outside `staffMutation` — staging changes no
 * platform state a buyer or seller can see, and the audited event is the
 * approval that follows. The cost of that choice is that the service asserts
 * no capability at all, so this action is the only gate: without the
 * `assertCan` below, any staff seat could post to it even though the screen
 * 404s for them.
 */
export async function stage(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    assertCan(seat.actor, "queue.decide");

    const result = await stageRun({
      actor: seat.actor,
      source: String(formData.get("source") ?? ""),
      filename: String(formData.get("filename") ?? ""),
      text: String(formData.get("text") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.message };

    revalidatePath("/admin/ingest");
    return {
      ok: true,
      runId: result.runId,
      /*
         The truncation is named when it happens. A run that quietly stopped at
         the ceiling and reported a tidy number would be a lie about what was
         staged, and the rows it dropped are the ones nobody would go looking
         for.
      */
      message:
        result.truncated > 0
          ? t("admin.ingest.staged_capped", {
              count: formatCount(result.totals.staged),
              dropped: formatCount(result.truncated),
            })
          : t("admin.ingest.staged", { count: formatCount(result.totals.staged) }),
    };
  } catch (error) {
    if (error instanceof PermissionError) return { ok: false, error: t("admin.queue.not_yours") };
    throw error;
  }
}
