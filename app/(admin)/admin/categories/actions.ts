"use server";

import { revalidatePath } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import { addressesFor, deleteCategory, renameCategory } from "@/lib/taxonomy/rename";
import { setTradeKind, tradeKindImpact } from "@/lib/taxonomy/service";
import { setCategoryDefaultTemplate } from "@/lib/spec/versions";
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

/**
 * Which template this subcategory offers a seller first.
 *
 * Board 4e criterion 6. The relation is many-to-many, so this is a **default**
 * and not an assignment: the other templates serving the subcategory stay
 * available on `3h`'s `CLONE FROM LIBRARY` rail. Audited like every other
 * taxonomy change, because it decides which fields a seller's whole catalogue
 * is described by.
 */
export async function setDefaultTemplate(formData: FormData): Promise<void> {
  const seat = await requireStaff();
  const categoryId = String(formData.get("categoryId") ?? "");
  const templateId = String(formData.get("templateId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  const result = await setCategoryDefaultTemplate({
    actor: seat.actor,
    categoryId,
    templateId,
    reason,
  });
  if (!result.ok) throw new Error(result.message);

  revalidatePath("/admin/categories");
  revalidatePath("/admin/spec-library");
}

/**
 * How many trades one trade-kind write would actually move — board `4d-s`.
 *
 * The parallel of `previewRename`, and shown in the same place for the same
 * reason. Setting a sector is the bulk action here, so the number can be large.
 */
export async function previewTradeKind(
  categoryId: string,
  kind: string,
): Promise<{ moved: number; overridden: number }> {
  await requireStaff();
  if (!categoryId || !kind) return { moved: 0, overridden: 0 };
  return tradeKindImpact(categoryId, kind === "inherit" ? null : kind === "services" ? "services" : "goods");
}

/**
 * Set, override or clear how a trade is sold.
 *
 * Returns an `ActionResult` rather than throwing, unlike `setDefaultTemplate`
 * beside it: a refusal here is an ordinary outcome — a missing reason, a value
 * already set — and the panel has somewhere to render it.
 */
export async function setKind(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const raw = String(formData.get("kind") ?? "");
    if (raw !== "goods" && raw !== "services" && raw !== "inherit") {
      return { ok: false, error: t("taxonomy.kind_hint") };
    }

    const categoryId = String(formData.get("categoryId") ?? "");
    const kind = raw === "inherit" ? null : raw;
    // Counted before the write, because afterwards the answer is zero.
    const { moved } = await tradeKindImpact(categoryId, kind);

    const result = await setTradeKind({
      actor: seat.actor,
      categoryId,
      tradeKind: kind,
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.message };

    revalidatePath("/admin/categories");
    return { ok: true, message: t("taxonomy.kind_saved", { count: moved }) };
  } catch (error) {
    return refused(error);
  }
}
