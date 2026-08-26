"use server";

import { revalidatePath } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import { setTemplateTheme } from "@/lib/storefront/service";
import { t } from "@/lib/i18n";

/** Board 5b's one mutation. Audited through the service, like every other. */

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

export async function saveTheme(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const templateId = String(formData.get("templateId") ?? "");

  try {
    const result = await setTemplateTheme({
      actor: seat.actor,
      templateId,
      offeredThemes: formData.getAll("offeredThemes").map(String),
      defaultTheme: String(formData.get("defaultTheme") ?? ""),
      allowCustomHex: formData.get("allowCustomHex") === "on",
      typePairing: String(formData.get("typePairing") ?? "clean") as "clean",
      density: String(formData.get("density") ?? "comfortable") as "comfortable",
      cornerRadius: Number(formData.get("cornerRadius") ?? 6),
      darkHeader: formData.get("darkHeader") === "on",
      badgeRemovable: formData.get("badgeRemovable") === "on",
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.message };

    revalidatePath(`/admin/storefront-templates/${templateId}`);
    revalidatePath(`/admin/storefront-templates/${templateId}/theme`);
    return { ok: true, message: t("builder.saved") };
  } catch (error) {
    if (error instanceof PermissionError) return { ok: false, error: t("builder.not_yours") };
    if (error instanceof AuditReasonError) return { ok: false, error: t("builder.needs_reason") };
    throw error;
  }
}
