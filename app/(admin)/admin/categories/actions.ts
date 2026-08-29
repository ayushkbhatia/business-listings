"use server";

import { revalidatePath } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import { addressesFor, deleteCategory, renameCategory } from "@/lib/taxonomy/rename";
import { t } from "@/lib/i18n";

/**
 * Criterion 7's admin half.
 *
 * Thin: the rule about how many addresses one rename moves, and what blocks a
 * delete, is in `lib/taxonomy/rename.ts` where it is tested without a request.
 */

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

function refused(error: unknown): ActionResult {
  if (error instanceof PermissionError) return { ok: false, error: t("matrix.not_yours") };
  if (error instanceof AuditReasonError) return { ok: false, error: t("builder.needs_reason") };
  throw error;
}

/** How many addresses a rename would move, shown before anybody commits to it. */
export async function previewRename(categoryId: string, slug: string): Promise<number> {
  await requireStaff();
  if (!categoryId || !slug) return 0;
  return (await addressesFor(categoryId, slug)).length;
}

export async function rename(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const categoryId = String(formData.get("categoryId") ?? "");
    const slug = String(formData.get("slug") ?? "");
    const moved = (await addressesFor(categoryId, slug)).length;

    const result = await renameCategory(
      seat.actor,
      categoryId,
      slug,
      String(formData.get("reason") ?? ""),
    );
    if (!result.ok) return { ok: false, error: result.message };

    revalidatePath("/admin/categories");
    revalidatePath("/admin/content/redirects");
    return { ok: true, message: t("taxonomy.renamed", { count: moved }) };
  } catch (error) {
    return refused(error);
  }
}

export async function remove(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await deleteCategory(
      seat.actor,
      String(formData.get("categoryId") ?? ""),
      String(formData.get("reason") ?? ""),
    );
    if (!result.ok) return { ok: false, error: result.message };

    revalidatePath("/admin/categories");
    revalidatePath("/admin/content/redirects");
    return { ok: true, message: t("taxonomy.removed") };
  } catch (error) {
    return refused(error);
  }
}
