"use server";

import { revalidatePath } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import {
  escalateConflict,
  isPartyReason,
  isResolution,
  logConflictCall,
  requestConflictDocuments,
  resolveConflict,
  type ConflictError,
} from "@/lib/claims/conflict";
import type { ClaimPartyReason } from "@/lib/db/generated/client";
import { assignRef } from "@/lib/moderation/decide";
import { refFor } from "@/lib/moderation/queue";
import { t } from "@/lib/i18n";

/**
 * Board 4c's mutations. One per decision, each a thin reader of a form around
 * one service call (`B2`): every control that resolves — the card's award, the
 * rail's *Award & notify*, *Split*, *Create a separate listing*, *Merge*, *Keep
 * the owner* — submits here, to `resolveConflict`, whichever button it was.
 *
 * Permission and reason are the services' to check (criterion 1, criterion 3);
 * this file turns their two refusals into words a person can act on.
 */

export type ConflictActionResult = { ok: true; message: string } | { ok: false; error: string; claimId?: string };

function refused(error: unknown): ConflictActionResult {
  if (error instanceof PermissionError) return { ok: false, error: t("admin.queue.not_yours") };
  if (error instanceof AuditReasonError) return { ok: false, error: t("admin.queue.needs_reason") };
  throw error;
}

function failed(error: ConflictError, claimId?: string): ConflictActionResult {
  return { ok: false, error: t(`admin.conflict.error.${error}`), ...(claimId ? { claimId } : {}) };
}

function refresh() {
  revalidatePath("/admin/queue", "layout");
  revalidatePath("/admin");
}

const field = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

export async function resolveConflictAction(form: FormData): Promise<ConflictActionResult> {
  const seat = await requireStaff();
  const resolution = field(form, "resolution");
  if (!isResolution(resolution)) return failed("not_a_claim");

  const partyReasons: Record<string, ClaimPartyReason> = {};
  for (const [name, value] of form.entries()) {
    if (!name.startsWith("reason:")) continue;
    const reason = String(value);
    if (isPartyReason(reason)) partyReasons[name.slice("reason:".length)] = reason;
  }
  const expiry = field(form, "splitExpiry");
  const splitExpiry = /^\d{4}-\d{2}-\d{2}$/.test(expiry) ? new Date(`${expiry}T00:00:00.000Z`) : null;

  try {
    const result = await resolveConflict({
      actor: seat.actor,
      conflictId: field(form, "conflictId"),
      resolution,
      claimId: field(form, "claimId") || null,
      secondClaimId: field(form, "secondClaimId") || null,
      note: String(form.get("note") ?? ""),
      partyReasons,
      split: { legalName: field(form, "splitName") || null, licenceExpiry: splitExpiry },
    });
    if (!result.ok) return failed(result.error, result.claimId);
    refresh();
    return {
      ok: true,
      message: t(
        resolution === "award"
          ? "admin.conflict.done.award"
          : resolution === "split"
            ? "admin.conflict.done.split"
            : resolution === "merge_branch"
              ? "admin.conflict.done.merge"
              : "admin.conflict.done.keep",
      ),
    };
  } catch (error) {
    return refused(error);
  }
}

export async function escalateConflictAction(form: FormData): Promise<ConflictActionResult> {
  const seat = await requireStaff();
  try {
    const result = await escalateConflict({
      actor: seat.actor,
      conflictId: field(form, "conflictId"),
      holderId: field(form, "holderId"),
      note: String(form.get("note") ?? ""),
    });
    if (!result.ok) return failed(result.error);
    refresh();
    return { ok: true, message: t("admin.conflict.escalate.done") };
  } catch (error) {
    return refused(error);
  }
}

export async function requestConflictDocumentsAction(form: FormData): Promise<ConflictActionResult> {
  const seat = await requireStaff();
  try {
    const result = await requestConflictDocuments({
      actor: seat.actor,
      conflictId: field(form, "conflictId"),
      note: String(form.get("note") ?? ""),
    });
    if (!result.ok) return failed(result.error);
    refresh();
    return { ok: true, message: t("admin.conflict.docs.done") };
  } catch (error) {
    return refused(error);
  }
}

export async function logConflictCallAction(form: FormData): Promise<ConflictActionResult> {
  const seat = await requireStaff();
  const to = field(form, "to");
  if (to !== "public_record" && to !== "claimant_supplied") return failed("not_a_claim");
  try {
    const result = await logConflictCall({
      actor: seat.actor,
      conflictId: field(form, "conflictId"),
      claimId: field(form, "claimId"),
      to,
      confirmed: field(form, "confirmed") === "yes",
      note: String(form.get("note") ?? ""),
    });
    if (!result.ok) return failed(result.error);
    refresh();
    return { ok: true, message: t("admin.conflict.call.done") };
  } catch (error) {
    return refused(error);
  }
}

/**
 * `B1`: what a moderator may do with a conflict — hand it to an ops lead. The
 * queue's own assignment, which refuses anybody who cannot resolve it.
 */
export async function assignConflictAction(form: FormData): Promise<ConflictActionResult> {
  const seat = await requireStaff();
  try {
    const result = await assignRef({
      actor: seat.actor,
      ref: refFor("conflict", field(form, "conflictId")),
      assigneeId: field(form, "assigneeId") || null,
      reason: String(form.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: t(`admin.queue.error.${result.error}`) };
    refresh();
    return { ok: true, message: t("admin.conflict.assign.done") };
  } catch (error) {
    return refused(error);
  }
}
