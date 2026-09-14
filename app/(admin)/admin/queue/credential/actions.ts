"use server";

import { revalidatePath } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import { REJECT_REASONS } from "@/lib/credentials/compare";
import { prisma } from "@/lib/db/client";
import {
  refetchRegister,
  rejectCredential,
  requestClearerDocument,
  verifyCredential,
  type ReviewResult,
} from "@/lib/credentials/review";
import type { CredentialRejectReason } from "@/lib/db/generated/enums";
import { t } from "@/lib/i18n";
import type { ActionResult } from "../actions";

/**
 * Board `4c-s` — the review screen's four writers. Thin: every rule is in
 * `lib/credentials/review.ts`, where each decision is a `staffMutation` with the
 * reviewer's words and the register read attached.
 */

const field = (formData: FormData, name: string) => String(formData.get(name) ?? "");

function refused(error: unknown): ActionResult {
  if (error instanceof PermissionError) return { ok: false, error: t("admin.queue.not_yours") };
  if (error instanceof AuditReasonError) return { ok: false, error: t("admin.queue.needs_reason") };
  throw error;
}

/**
 * The queue, the badge, the overview — and the storefront, where a verification
 * changes what a buyer reads and a rejection takes the row off.
 */
async function refresh(credentialId: string) {
  revalidatePath("/admin/queue", "layout");
  revalidatePath("/admin");
  const row = await prisma.credential.findUnique({
    where: { id: credentialId },
    select: { business: { select: { slug: true } } },
  });
  if (row) revalidatePath(`/b/${row.business.slug}`, "layout");
}

function answer(result: ReviewResult, message: string): ActionResult {
  return result.ok ? { ok: true, message } : { ok: false, error: t(`admin.credential_review.error.${result.error}`) };
}

export async function verifyCredentialAction(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const credentialId = field(formData, "credentialId");
  try {
    const result = await verifyCredential({ actor: seat.actor, credentialId, reason: field(formData, "reason") });
    if (result.ok) await refresh(credentialId);
    return answer(result, t("admin.credential_review.done.verified"));
  } catch (error) {
    return refused(error);
  }
}

export async function requestClearerDocumentAction(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const credentialId = field(formData, "credentialId");
  try {
    const result = await requestClearerDocument({ actor: seat.actor, credentialId, reason: field(formData, "reason") });
    if (result.ok) await refresh(credentialId);
    return answer(result, t("admin.credential_review.done.more_info"));
  } catch (error) {
    return refused(error);
  }
}

export async function rejectCredentialAction(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const credentialId = field(formData, "credentialId");
  const rejectReason = field(formData, "rejectReason");
  if (!(REJECT_REASONS as readonly string[]).includes(rejectReason)) {
    return { ok: false, error: t("admin.credential_review.error.reason_unsupported") };
  }
  try {
    const result = await rejectCredential({
      actor: seat.actor,
      credentialId,
      reason: field(formData, "reason"),
      rejectReason: rejectReason as CredentialRejectReason,
    });
    if (result.ok) await refresh(credentialId);
    return answer(result, t("admin.credential_review.done.rejected"));
  } catch (error) {
    return refused(error);
  }
}

export async function refetchRegisterAction(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const credentialId = field(formData, "credentialId");
  try {
    const result = await refetchRegister({ actor: seat.actor, credentialId });
    if (result.ok) revalidatePath("/admin/queue", "layout");
    return answer(result, t("admin.credential_review.refetched"));
  } catch (error) {
    return refused(error);
  }
}
