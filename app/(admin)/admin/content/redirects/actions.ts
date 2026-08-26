"use server";

import { revalidatePath } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import { addRedirect, removeRedirect } from "@/lib/content/redirects";
import { t } from "@/lib/i18n";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

function refused(error: unknown): ActionResult {
  if (error instanceof PermissionError) return { ok: false, error: t("matrix.not_yours") };
  if (error instanceof AuditReasonError) return { ok: false, error: t("builder.needs_reason") };
  throw error;
}

export async function create(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await addRedirect({
      actor: seat.actor,
      fromPath: String(formData.get("fromPath") ?? ""),
      toPath: String(formData.get("toPath") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.message };
    revalidatePath("/admin/content/redirects");
    return { ok: true, message: t("redirects.added") };
  } catch (error) {
    return refused(error);
  }
}

export async function remove(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await removeRedirect(
      seat.actor,
      String(formData.get("id") ?? ""),
      String(formData.get("reason") ?? ""),
    );
    if (!result.ok) return { ok: false, error: result.message };
    revalidatePath("/admin/content/redirects");
    return { ok: true, message: t("redirects.removed") };
  } catch (error) {
    return refused(error);
  }
}
