"use server";

import { revalidatePath } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import {
  dismissCandidate,
  findCandidates,
  mergeBusinesses,
  unmergeBusinesses,
  REVERSIBLE_DAYS,
} from "@/lib/dedupe/service";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

function refused(error: unknown): ActionResult {
  if (error instanceof PermissionError) return { ok: false, error: t("admin.queue.not_yours") };
  if (error instanceof AuditReasonError) return { ok: false, error: t("admin.queue.needs_reason") };
  throw error;
}

export async function rescan(): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const scan = await findCandidates();
    revalidatePath("/admin/ingest/dedupe");
    return {
      ok: true,
      message:
        scan.dropped === 0
          ? t("admin.dedupe.rescan_done", { count: formatCount(scan.created) })
          : t("admin.dedupe.rescan_capped", {
              count: formatCount(scan.created),
              dropped: formatCount(scan.dropped),
            }),
    };
  } catch (error) {
    return refused(error);
  } finally {
    void seat;
  }
}

export async function merge(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await mergeBusinesses({
      actor: seat.actor,
      keepId: String(formData.get("keepId") ?? ""),
      absorbId: String(formData.get("absorbId") ?? ""),
      candidateId: String(formData.get("candidateId") ?? "") || undefined,
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.message };
    revalidatePath("/admin/ingest/dedupe");
    revalidatePath("/admin");
    return {
      ok: true,
      message: t("admin.dedupe.merged", { days: String(REVERSIBLE_DAYS) }),
    };
  } catch (error) {
    return refused(error);
  }
}

export async function unmerge(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await unmergeBusinesses({
      actor: seat.actor,
      mergeId: String(formData.get("mergeId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
    // `window_closed` names the date it closed, so it passes straight through
    // rather than being flattened into a generic refusal.
    if (!result.ok) return { ok: false, error: result.message };
    revalidatePath("/admin/ingest/dedupe");
    revalidatePath("/admin");
    return {
      ok: true,
      message: t("admin.dedupe.unmerged", { count: formatCount(result.restored) }),
    };
  } catch (error) {
    return refused(error);
  }
}

export async function dismiss(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await dismissCandidate({
      actor: seat.actor,
      candidateId: String(formData.get("candidateId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.error };
    revalidatePath("/admin/ingest/dedupe");
    return { ok: true, message: t("admin.dedupe.dismissed") };
  } catch (error) {
    return refused(error);
  }
}
