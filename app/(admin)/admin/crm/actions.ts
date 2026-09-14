"use server";

import { revalidatePath } from "next/cache";
import { PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import {
  buildCallList,
  logCall,
  refreshSignals,
  releaseTask,
  revealContact,
  type CrmError,
} from "@/lib/crm/service";
import { formatCount } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";

/**
 * Board 12d — the wire between the call board and `lib/crm/service.ts`.
 *
 * The service asserts `crm.work` on every call; nothing is re-checked here, so
 * there is one place the rule lives. What this file owns is the sentence a
 * refusal comes back as.
 */

export type CrmActionResult = { ok: true; message: string } | { ok: false; error: string };
export type RevealActionResult = { ok: true; display: string; tel: string } | { ok: false; error: string };

function errorText(error: CrmError, holder?: string | null): string {
  if (error === "taken" && holder) return t("admin.crm.error.taken_by", { name: holder });
  return t(`admin.crm.error.${error}` as MessageKey);
}

function refused(error: unknown): { ok: false; error: string } {
  if (error instanceof PermissionError) return { ok: false, error: t("admin.queue.not_yours") };
  throw error;
}

function done() {
  revalidatePath("/admin/crm");
}

export async function revealContactAction(taskId: string): Promise<RevealActionResult> {
  const seat = await requireStaff();
  try {
    const result = await revealContact(seat.actor, taskId);
    done();
    return result.ok ? { ok: true, display: result.display, tel: result.tel } : { ok: false, error: errorText(result.error, result.holder) };
  } catch (error) {
    return refused(error);
  }
}

export async function logCallAction(formData: FormData): Promise<CrmActionResult> {
  const seat = await requireStaff();
  const taskId = String(formData.get("taskId") ?? "");
  const name = String(formData.get("businessName") ?? "");
  const outcome = String(formData.get("outcome") ?? "");
  if (!outcome) return { ok: false, error: t("admin.crm.log.pick_outcome") };
  const rawDate = String(formData.get("callBackOn") ?? "").trim();
  // A date picked in Dubai, kept at 10:00 that day: a call-back is due on its
  // day, and the hour only has to be inside it.
  const callBackAt = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? new Date(`${rawDate}T10:00:00+04:00`) : null;

  try {
    const result = await logCall(seat.actor, { taskId, outcome, note: String(formData.get("note") ?? ""), callBackAt });
    if (!result.ok) return { ok: false, error: errorText(result.error, result.holder) };
    done();
    const closed = ["lost", "parked", "won", "cleared"].includes(result.state);
    return { ok: true, message: t(closed ? "admin.crm.log.done_closed" : "admin.crm.log.done", { name }) };
  } catch (error) {
    return refused(error);
  }
}

export async function releaseTaskAction(taskId: string): Promise<CrmActionResult> {
  const seat = await requireStaff();
  try {
    const result = await releaseTask(seat.actor, taskId);
    if (!result.ok) return { ok: false, error: errorText(result.error) };
    done();
    return { ok: true, message: "" };
  } catch (error) {
    return refused(error);
  }
}

export async function buildCallListAction(signalRef: string): Promise<CrmActionResult> {
  const seat = await requireStaff();
  try {
    const result = await buildCallList(seat.actor, signalRef);
    if (!result.ok) return { ok: false, error: errorText(result.error) };
    done();
    return { ok: true, message: t("admin.crm.banner.mine", { count: result.assigned, n: formatCount(result.assigned) }) };
  } catch (error) {
    return refused(error);
  }
}

export async function refreshSignalsAction(): Promise<CrmActionResult> {
  const seat = await requireStaff();
  try {
    const result = await refreshSignals(seat.actor);
    if (!result.ok) return { ok: false, error: errorText(result.error) };
    done();
    return {
      ok: true,
      message: t("admin.crm.refreshed_now", { count: result.result.derived, n: formatCount(result.result.derived) }),
    };
  } catch (error) {
    return refused(error);
  }
}
