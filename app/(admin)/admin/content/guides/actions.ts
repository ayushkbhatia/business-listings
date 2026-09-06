"use server";

import { revalidatePath } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import { readGuideBlocks } from "@/lib/guides/blocks";
import {
  deleteGuide,
  publishGuide,
  recordRegulatoryCheck,
  saveGuide,
  saveGuideSubject,
  setFeaturedGuide,
  unpublishGuide,
} from "@/lib/guides/service";
import { guideSubjects } from "@/lib/guides/subjects";
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

/**
 * Every surface the guide programme's numbers reach.
 *
 * The hub, the article, **every subject view** and the page the author strip
 * links to. Board 10b puts the same chip counts and the same author strip on
 * all of them, so revalidating only `/guides` leaves a subject page showing a
 * count the hub has already moved on from — and the subject views are the ones
 * a reader arrives on from a chip.
 */
async function revalidateGuides(slug?: string) {
  revalidatePath("/admin/content/guides");
  revalidatePath("/guides");
  revalidatePath("/guides/how-we-check");
  if (slug) revalidatePath(`/guides/${slug}`);
  for (const subject of await guideSubjects()) {
    revalidatePath(`/guides/${subject.slug}`);
  }
}

/**
 * Months, or null for an article that makes no claim about the world.
 *
 * An empty field is null and not nought: board 10b criterion 6 says a guide
 * with no cadence is never overdue, and a cadence of zero would make it
 * permanently overdue from the day it published.
 */
function cadence(raw: FormDataEntryValue | null): number | null {
  const value = String(raw ?? "").trim();
  if (value === "") return null;
  const months = Number(value);
  return Number.isInteger(months) && months > 0 ? months : null;
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
      /*
         Board 10b. Six fields board 6d added and never wired to a form, so the
         only thing that has ever set them is the seed — guide content in a
         commit, which costs a build and a cold cache to change one sentence.
         The index prints four of them.
      */
      standfirst: String(formData.get("standfirst") ?? "") || null,
      topic: String(formData.get("topic") ?? "") || null,
      bylineRole: String(formData.get("bylineRole") ?? "") || null,
      subjectId: String(formData.get("subjectId") ?? "") || null,
      sortOrder: Number(String(formData.get("sortOrder") ?? "0")) || 0,
      reviewCadenceMonths: cadence(formData.get("reviewCadenceMonths")),
      blocks,
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.message };
    await revalidateGuides(slug);
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
    await revalidateGuides(String(formData.get("slug") ?? ""));
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
    await revalidateGuides(String(formData.get("slug") ?? ""));
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
    await revalidateGuides(String(formData.get("slug") ?? ""));
    return { ok: true, message: t("guide_admin.deleted") };
  } catch (error) {
    return refused(error);
  }
}

/**
 * The `START HERE` slot — board 10b §4.
 *
 * One at a time, refused by the database as well as by the service. Passing an
 * empty id clears it, and the page then renders no hero rather than an empty
 * one.
 */
export async function setFeatured(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await setFeaturedGuide(
      seat.actor,
      String(formData.get("id") ?? "") || null,
      String(formData.get("reason") ?? ""),
      String(formData.get("note") ?? "") || null,
    );
    if (!result.ok) return { ok: false, error: result.message };
    await revalidateGuides();
    return { ok: true, message: t("guide_admin.featured_set") };
  } catch (error) {
    return refused(error);
  }
}

/** Create or rename a shelf — board 10b §3. */
export async function saveSubject(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await saveGuideSubject({
      actor: seat.actor,
      id: String(formData.get("id") ?? "") || undefined,
      slug: String(formData.get("slug") ?? ""),
      name: String(formData.get("name") ?? ""),
      blurb: String(formData.get("blurb") ?? "") || null,
      sortOrder: Number(String(formData.get("sortOrder") ?? "0")) || 0,
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.message };
    revalidatePath("/admin/content/guide-subjects");
    await revalidateGuides();
    // Every shelf is a public URL of its own.
    revalidatePath(`/guides/${String(formData.get("slug") ?? "")}`);
    return { ok: true, message: t("guide_admin.subject_saved"), id: result.id };
  } catch (error) {
    return refused(error);
  }
}

/**
 * Record that a person has re-read the regulatory detail — board 6d, board 10b.
 *
 * `recordRegulatoryCheck` shipped with board 6d and had no caller anywhere in
 * `app/`, so the date the index prints beside every guide could only ever be
 * set by the seed. The reader-facing overdue state is only defensible if staff
 * can clear it, and this is the control that clears it.
 */
export async function recordCheck(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await recordRegulatoryCheck(
      seat.actor,
      String(formData.get("id") ?? ""),
      String(formData.get("reason") ?? ""),
    );
    if (!result.ok) return { ok: false, error: result.message };
    await revalidateGuides(String(formData.get("slug") ?? ""));
    return { ok: true, message: t("guide_admin.check_recorded") };
  } catch (error) {
    return refused(error);
  }
}
