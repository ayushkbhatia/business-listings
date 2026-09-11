"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import { addressesFor, deleteCategory, renameCategory } from "@/lib/taxonomy/rename";
import {
  setTradeKindBulk,
  TAXONOMY_CACHE_TAG,
  tradeKindBulkImpact,
} from "@/lib/taxonomy/service";
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

/** The three values the bulk bar can post, and nothing else. */
function kindOf(raw: string): "goods" | "services" | null | undefined {
  if (raw === "goods" || raw === "services") return raw;
  if (raw === "inherit") return null;
  return undefined;
}

/**
 * What a bulk change would move — board `4d-s` B5, shown before the button.
 *
 * Three numbers rather than one: what is written, what follows by inheritance,
 * and how many published listings render differently afterwards. The third is
 * the one that decides whether this is a routine edit or a consequential one.
 */
export async function previewTradeKindBulk(
  categoryIds: readonly string[],
  kind: string,
): Promise<{ rows: number; alsoInheriting: number; listings: number }> {
  await requireStaff();
  const next = kindOf(kind);
  if (next === undefined || categoryIds.length === 0) {
    return { rows: 0, alsoInheriting: 0, listings: 0 };
  }
  return tradeKindBulkImpact(categoryIds, next);
}

/**
 * Set, override or clear a selection of trades in one transaction.
 *
 * Returns an `ActionResult` rather than throwing: a refusal here — a stale id,
 * a selection already holding the value, a missing reason — is an ordinary
 * outcome and the bar has somewhere to render it.
 */
export async function setKindBulk(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const kind = kindOf(String(formData.get("kind") ?? ""));
    if (kind === undefined) return { ok: false, error: t("taxonomy.kind_hint") };

    const categoryIds = String(formData.get("categoryIds") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    const result = await setTradeKindBulk({
      actor: seat.actor,
      categoryIds,
      tradeKind: kind,
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.message };

    /*
       The cached resolved map, dropped here rather than in the service.

       `revalidateTag` needs a request context, so the service — which a job or
       a test must be able to call — cannot do it. Every screen that reads a
       trade kind reads it through that cache, so a write that did not drop it
       would leave suppliers on the wrong version of about forty screens until
       the day-long backstop expired.
    */
    revalidateTag(TAXONOMY_CACHE_TAG, { expire: 0 });
    revalidatePath("/admin/categories");
    return {
      ok: true,
      message: t("taxonomy.kind_saved_bulk", { count: result.changed ?? categoryIds.length }),
    };
  } catch (error) {
    return refused(error);
  }
}
