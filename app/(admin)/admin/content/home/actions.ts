"use server";

import { revalidatePath } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import { setOnHome } from "@/lib/content/homepage";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

export async function toggleHome(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await setOnHome(
      seat.actor,
      String(formData.get("categoryId") ?? ""),
      formData.get("showOnHome") === "on",
      String(formData.get("reason") ?? ""),
    );
    if (!result.ok) return { ok: false, error: result.message };

    revalidatePath("/admin/content/home");
    // The home page is statically cached; this is what makes the change visible.
    revalidatePath("/");
    return { ok: true, message: t("home.saved", { count: formatCount(result.shown) }) };
  } catch (error) {
    if (error instanceof PermissionError) return { ok: false, error: t("matrix.not_yours") };
    if (error instanceof AuditReasonError) return { ok: false, error: t("builder.needs_reason") };
    throw error;
  }
}
