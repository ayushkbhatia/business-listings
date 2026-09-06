"use server";

import { revalidatePath } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import { approveChange, rejectChange } from "@/lib/moderation/service";
import { resolveConflict } from "@/lib/onboarding/conflict";
import { approveDocument, rejectDocument } from "@/lib/verification/review";
import type { ClaimResolution } from "@/lib/db/generated/client";
import { t } from "@/lib/i18n";

/**
 * The queue's four mutations. Every one goes through a service that goes
 * through `staffMutation`, so none of them can reach the database without an
 * audit row carrying a written reason.
 *
 * The reason is read from the form and passed straight through. It is
 * deliberately not defaulted, trimmed into existence, or composed from a
 * dropdown — `assertReason` refuses blanks, punctuation and four characters of
 * keyboard-clearing, and a default would walk straight past all three.
 */

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

/** Turns the two ways a service refuses into something a person can act on. */
function refused(error: unknown): ActionResult {
  if (error instanceof PermissionError) return { ok: false, error: t("admin.queue.not_yours") };
  if (error instanceof AuditReasonError) return { ok: false, error: t("admin.queue.needs_reason") };
  throw error;
}

export async function approve(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await approveChange({
      actor: seat.actor,
      requestId: String(formData.get("requestId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.message };
    revalidatePath("/admin/queue");
    revalidatePath("/admin");
    return { ok: true, message: t("admin.queue.approved") };
  } catch (error) {
    return refused(error);
  }
}

export async function reject(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await rejectChange({
      actor: seat.actor,
      requestId: String(formData.get("requestId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.message };
    revalidatePath("/admin/queue");
    revalidatePath("/admin");
    return { ok: true, message: t("admin.queue.rejected") };
  } catch (error) {
    return refused(error);
  }
}

const RESOLUTIONS = [
  "award_to_a",
  "award_to_b",
  "split_into_two",
  "merge_as_branches",
] as const satisfies readonly ClaimResolution[];

function isResolution(value: string): value is ClaimResolution {
  return (RESOLUTIONS as readonly string[]).includes(value);
}

export async function resolve(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const resolution = String(formData.get("resolution") ?? "");
  if (!isResolution(resolution)) {
    return { ok: false, error: t("admin.queue.pick_a_resolution") };
  }

  const secondTradeName = String(formData.get("secondTradeName") ?? "").trim();

  try {
    const result = await resolveConflict({
      actor: seat.actor,
      conflictId: String(formData.get("conflictId") ?? ""),
      resolution,
      reason: String(formData.get("reason") ?? ""),
      ...(secondTradeName ? { secondTradeName } : {}),
    });
    if (!result.ok) return { ok: false, error: result.message };
    revalidatePath("/admin/queue");
    revalidatePath("/admin");
    return { ok: true, message: t("admin.queue.resolved") };
  } catch (error) {
    return refused(error);
  }
}

/**
 * Board 3e's credential review, through the same two buttons and the same
 * required reason as every other decision on this queue.
 *
 * `approveDocument` and `rejectDocument` go through `staffMutation`, so neither
 * can reach the database without an audit row carrying the words the moderator
 * typed. Neither can reach `verificationTier`: what is decided here is whether
 * a certificate may be named on a public page, and the tier is a different kind
 * of statement with a different function and a different capability behind it.
 */
export async function approveCredential(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await approveDocument({
      actor: seat.actor,
      documentId: String(formData.get("requestId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.message };
    revalidatePath("/admin/queue");
    revalidatePath("/admin");
    return { ok: true, message: t("admin.queue.approved") };
  } catch (error) {
    return refused(error);
  }
}

export async function rejectCredential(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await rejectDocument({
      actor: seat.actor,
      documentId: String(formData.get("requestId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.message };
    revalidatePath("/admin/queue");
    revalidatePath("/admin");
    return { ok: true, message: t("admin.queue.rejected") };
  } catch (error) {
    return refused(error);
  }
}
