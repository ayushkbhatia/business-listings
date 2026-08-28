"use server";

import { revalidatePath } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import { readGuideBlocks } from "@/lib/guides/blocks";
import { deleteGuide, publishGuide, saveGuide, unpublishGuide } from "@/lib/guides/service";
import { t } from "@/lib/i18n";

/**
 * Boards 10b and 6d — guide authoring.
 *
 * Every one of these revalidates the public routes as well as the admin one.
 * That is the whole reason guides live in the database rather than in a seed
 * file: publishing an article costs a revalidation, not a deploy — and a deploy
 * would put every page on the site back into a cold cache to ship one paragraph.
 */

export type ActionResult =
  | { ok: true; message: string; id?: string }
  | { ok: false; error: string };

function refused(error: unknown): ActionResult {
  if (error instanceof PermissionError) return { ok: false, error: t("matrix.not_yours") };
  if (error instanceof AuditReasonError) return { ok: false, error: t("builder.needs_reason") };
  throw error;
}

function revalidateGuides(slug?: string) {
  revalidatePath("/admin/content/guides");
  revalidatePath("/guides");
  if (slug) revalidatePath(`/guides/${slug}`);
}

export async function save(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const id = String(formData.get("id") ?? "");
  const slug = String(formData.get("slug") ?? "");

  let blocks;
  try {
    blocks = readGuideBlocks(JSON.parse(String(formData.get("blocks") ?? "[]")));
  } catch {
    // The field is written by the editor, so a parse failure means the form was
    // submitted by something else. Refuse rather than save an empty body over
    // an article somebody wrote.
    return { ok: false, error: t("guide_admin.field.body") };
  }

  try {
    const result = await saveGuide({
      actor: seat.actor,
      id: id || undefined,
      slug,
      title: String(formData.get("title") ?? ""),
      summary: String(formData.get("summary") ?? ""),
      byline: String(formData.get("byline") ?? "") || null,
      ctaCategoryId: String(formData.get("ctaCategoryId") ?? "") || null,
      blocks,
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.message };
    revalidateGuides(slug);
    return { ok: true, message: t("guide_admin.saved"), id: result.id };
  } catch (error) {
    return refused(error);
  }
}

export async function publish(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await publishGuide(
      seat.actor,
      String(formData.get("id") ?? ""),
      String(formData.get("reason") ?? ""),
    );
    if (!result.ok) return { ok: false, error: result.message };
    revalidateGuides(String(formData.get("slug") ?? ""));
    return { ok: true, message: t("guide_admin.published") };
  } catch (error) {
    return refused(error);
  }
}

export async function unpublish(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await unpublishGuide(
      seat.actor,
      String(formData.get("id") ?? ""),
      String(formData.get("reason") ?? ""),
    );
    if (!result.ok) return { ok: false, error: result.message };
    revalidateGuides(String(formData.get("slug") ?? ""));
    return { ok: true, message: t("guide_admin.unpublished") };
  } catch (error) {
    return refused(error);
  }
}

export async function remove(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await deleteGuide(
      seat.actor,
      String(formData.get("id") ?? ""),
      String(formData.get("reason") ?? ""),
    );
    if (!result.ok) return { ok: false, error: result.message };
    revalidateGuides(String(formData.get("slug") ?? ""));
    return { ok: true, message: t("guide_admin.deleted") };
  } catch (error) {
    return refused(error);
  }
}
