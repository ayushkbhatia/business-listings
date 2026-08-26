"use server";

import { revalidatePath } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import { createPage, editPage, publishPage, renamePage } from "@/lib/storefront/pages";
import { readBlocks } from "@/lib/storefront/blocks";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";

/** Board 5d's four mutations, all audited through the service. */

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

function refused(error: unknown): ActionResult {
  if (error instanceof PermissionError) return { ok: false, error: t("builder.not_yours") };
  if (error instanceof AuditReasonError) return { ok: false, error: t("builder.needs_reason") };
  throw error;
}

function done(templateId: string) {
  revalidatePath(`/admin/storefront-templates/${templateId}/pages`);
}

export async function addPage(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const templateId = String(formData.get("templateId") ?? "");
  try {
    const result = await createPage({
      actor: seat.actor,
      templateId,
      slug: String(formData.get("slug") ?? ""),
      title: String(formData.get("title") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.message };
    done(templateId);
    return { ok: true, message: t("pages.added") };
  } catch (error) {
    return refused(error);
  }
}

export async function savePage(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const templateId = String(formData.get("templateId") ?? "");
  try {
    const raw = String(formData.get("blocks") ?? "[]");
    const result = await editPage({
      actor: seat.actor,
      pageId: String(formData.get("pageId") ?? ""),
      title: String(formData.get("title") ?? ""),
      metaDescription: String(formData.get("metaDescription") ?? "") || null,
      // Parsed and filtered, never trusted. A block kind nobody built would
      // render as nothing on every storefront in the sector.
      blocks: readBlocks(JSON.parse(raw)),
      showInNav: formData.get("showInNav") === "on",
      allowIndexing: formData.get("allowIndexing") === "on",
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.message };
    done(templateId);
    return { ok: true, message: t("builder.saved") };
  } catch (error) {
    return refused(error);
  }
}

export async function goLive(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const templateId = String(formData.get("templateId") ?? "");
  try {
    const result = await publishPage(
      seat.actor,
      String(formData.get("pageId") ?? ""),
      String(formData.get("reason") ?? ""),
    );
    if (!result.ok) return { ok: false, error: result.message };
    done(templateId);
    return {
      ok: true,
      message: t("pages.published", { count: formatCount(result.storeCount) }),
    };
  } catch (error) {
    return refused(error);
  }
}

export async function movePage(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const templateId = String(formData.get("templateId") ?? "");
  try {
    const result = await renamePage({
      actor: seat.actor,
      pageId: String(formData.get("pageId") ?? ""),
      slug: String(formData.get("slug") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.message };
    done(templateId);
    return {
      ok: true,
      message:
        result.redirects === 0
          ? t("pages.renamed")
          : t("pages.renamed_with_redirects", { count: formatCount(result.redirects) }),
    };
  } catch (error) {
    return refused(error);
  }
}
