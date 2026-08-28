"use server";

import { revalidatePath } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import { publishAreaPage, saveAreaIntro, unpublishAreaPage } from "@/lib/seo/area";
import { editCategory } from "@/lib/taxonomy/service";
import { t } from "@/lib/i18n";

/**
 * Board 6f's one mutation: the copy on a landing page.
 *
 * Through `editCategory`, so it writes the same audited row a threshold change
 * does. A paragraph that decides whether a page publishes is a change somebody
 * should have to explain.
 */

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

export async function saveIntro(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await editCategory({
      actor: seat.actor,
      categoryId: String(formData.get("categoryId") ?? ""),
      intro: String(formData.get("intro") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.message };

    revalidatePath("/admin/content/matrix");
    revalidatePath("/admin/categories");
    return { ok: true, message: t("matrix.saved") };
  } catch (error) {
    if (error instanceof PermissionError) return { ok: false, error: t("matrix.not_yours") };
    if (error instanceof AuditReasonError) return { ok: false, error: t("builder.needs_reason") };
    throw error;
  }
}

/**
 * Board 6a's three: write the paragraph, publish, unpublish.
 *
 * The publish gate is in `lib/seo/area.ts` and not here, which is what
 * criterion 1's "cannot be published, by API or by admin action" means — this
 * action is one caller of a service that refuses, not a second place the rule
 * is written down.
 */
function areaPaths(formData: FormData) {
  revalidatePath("/admin/content/matrix");
  const path = String(formData.get("path") ?? "");
  if (path.startsWith("/")) revalidatePath(path);
}

export async function saveAreaCopy(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await saveAreaIntro({
      actor: seat.actor,
      areaId: String(formData.get("areaId") ?? ""),
      categoryId: String(formData.get("categoryId") ?? ""),
      intro: String(formData.get("intro") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.message };
    areaPaths(formData);
    return { ok: true, message: t("matrix.saved") };
  } catch (error) {
    return refusedBy(error);
  }
}

export async function publishArea(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await publishAreaPage(
      seat.actor,
      String(formData.get("areaId") ?? ""),
      String(formData.get("categoryId") ?? ""),
      String(formData.get("reason") ?? ""),
    );
    if (!result.ok) return { ok: false, error: result.message };
    areaPaths(formData);
    return { ok: true, message: t("matrix.area_published") };
  } catch (error) {
    return refusedBy(error);
  }
}

export async function unpublishArea(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await unpublishAreaPage(
      seat.actor,
      String(formData.get("areaId") ?? ""),
      String(formData.get("categoryId") ?? ""),
      String(formData.get("reason") ?? ""),
    );
    if (!result.ok) return { ok: false, error: result.message };
    areaPaths(formData);
    return { ok: true, message: t("matrix.area_unpublished") };
  } catch (error) {
    return refusedBy(error);
  }
}

function refusedBy(error: unknown): ActionResult {
  if (error instanceof PermissionError) return { ok: false, error: t("matrix.not_yours") };
  if (error instanceof AuditReasonError) return { ok: false, error: t("builder.needs_reason") };
  throw error;
}
