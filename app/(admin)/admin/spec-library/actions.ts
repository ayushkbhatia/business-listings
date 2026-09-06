"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/staff";
import { assertCan } from "@/lib/auth/can";
import {
  createTemplate,
  discardDraft,
  publishDraft,
  setFieldRequired,
  stageAddField,
  stageChange,
} from "@/lib/spec/versions";
import type { DraftField } from "@/lib/spec/changes";

/**
 * Board 4e's writes, from the screen.
 *
 * Two of them are the point of the board — `publish` and `require` — and they
 * are separate server actions rather than one with a flag, for the same reason
 * the spec splits the button: they have different consequences, their reviews
 * name different counts, and a single entry point is how they end up sharing a
 * confirmation that describes neither.
 *
 * Every one of them re-checks `taxonomy.write`. A server action is a URL: the
 * screen not rendering a control is not the same as the action refusing it,
 * and `staffMutation` inside the service is the second check rather than the
 * only one.
 */

function reasonFrom(formData: FormData): string {
  const reason = String(formData.get("reason") ?? "").trim();
  // `AuditEvent.reason` is NOT NULL because the log records decisions. A blank
  // reason is refused here rather than defaulted to something the person did
  // not write — CLAUDE.md non-negotiable 3.
  if (!reason) throw new Error("Say why this is changing. It is recorded on the audit row.");
  return reason;
}

function optionsFrom(raw: FormDataEntryValue | null): string[] {
  return String(raw ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function createTemplateAction(formData: FormData): Promise<void> {
  const seat = await requireStaff();
  assertCan(seat.actor, "taxonomy.write");

  const result = await createTemplate({
    actor: seat.actor,
    name: String(formData.get("name") ?? "").trim(),
    categoryId: String(formData.get("categoryId") ?? ""),
    reason: reasonFrom(formData),
  });
  if (!result.ok) throw new Error(result.message);

  revalidatePath("/admin/spec-library");
  redirect(`/admin/spec-library/${result.value}`);
}

export async function stageFieldAction(formData: FormData): Promise<void> {
  const seat = await requireStaff();
  assertCan(seat.actor, "taxonomy.write");

  const templateId = String(formData.get("templateId") ?? "");
  const field: DraftField = {
    key: String(formData.get("key") ?? "").trim(),
    label: String(formData.get("label") ?? "").trim(),
    type: (String(formData.get("type") ?? "text") as DraftField["type"]) ?? "text",
    unit: String(formData.get("unit") ?? "").trim() || null,
    options: optionsFrom(formData.get("options")),
    isFilterable: formData.get("isFilterable") === "on",
    variesByVariant: formData.get("variesByVariant") === "on",
  };

  const result = await stageAddField(seat.actor, templateId, field);
  if (!result.ok) throw new Error(result.message);

  revalidatePath(`/admin/spec-library/${templateId}`);
}

export async function stageFieldFlagAction(formData: FormData): Promise<void> {
  const seat = await requireStaff();
  assertCan(seat.actor, "taxonomy.write");

  const templateId = String(formData.get("templateId") ?? "");
  const fieldId = String(formData.get("fieldId") ?? "");
  const flag = String(formData.get("flag") ?? "");
  const value = formData.get("value") === "true";

  const result = await stageChange(seat.actor, templateId, (draft) => ({
    ...draft,
    edited: {
      ...draft.edited,
      [fieldId]: {
        ...draft.edited[fieldId],
        ...(flag === "facet" ? { isFilterable: value } : {}),
        ...(flag === "varies" ? { variesByVariant: value } : {}),
      },
    },
  }));
  if (!result.ok) throw new Error(result.message);

  revalidatePath(`/admin/spec-library/${templateId}`);
}

export async function stageRemovalAction(formData: FormData): Promise<void> {
  const seat = await requireStaff();
  assertCan(seat.actor, "taxonomy.write");

  const templateId = String(formData.get("templateId") ?? "");
  const fieldId = String(formData.get("fieldId") ?? "");
  const undo = formData.get("undo") === "true";

  const result = await stageChange(seat.actor, templateId, (draft) => ({
    ...draft,
    removed: undo
      ? draft.removed.filter((id) => id !== fieldId)
      : [...new Set([...draft.removed, fieldId])],
  }));
  if (!result.ok) throw new Error(result.message);

  revalidatePath(`/admin/spec-library/${templateId}`);
}

export async function discardDraftAction(formData: FormData): Promise<void> {
  const seat = await requireStaff();
  assertCan(seat.actor, "taxonomy.write");

  const templateId = String(formData.get("templateId") ?? "");
  const result = await discardDraft(seat.actor, templateId);
  if (!result.ok) throw new Error(result.message);

  revalidatePath(`/admin/spec-library/${templateId}`);
}

/** Action one. Additive and safe — it cannot put a product in violation. */
export async function publishDraftAction(formData: FormData): Promise<void> {
  const seat = await requireStaff();
  assertCan(seat.actor, "taxonomy.write");

  const templateId = String(formData.get("templateId") ?? "");
  const result = await publishDraft({
    actor: seat.actor,
    templateId,
    reason: reasonFrom(formData),
  });
  if (!result.ok) throw new Error(result.message);

  /*
     The facet rail and the spec table both read the platform template, and a
     publish can change which fields are facets. Revalidating only this screen
     would leave the buyer-facing pages on the old field set until their own
     cache expired.
  */
  revalidatePath("/admin/spec-library");
  revalidatePath(`/admin/spec-library/${templateId}`);
  revalidatePath("/", "layout");
}

/** Action two. Flags and blocks the next save; never delists, no deadline. */
export async function setRequiredAction(formData: FormData): Promise<void> {
  const seat = await requireStaff();
  assertCan(seat.actor, "taxonomy.write");

  const templateId = String(formData.get("templateId") ?? "");
  const result = await setFieldRequired({
    actor: seat.actor,
    fieldId: String(formData.get("fieldId") ?? ""),
    required: formData.get("required") === "true",
    reason: reasonFrom(formData),
  });
  if (!result.ok) throw new Error(result.message);

  revalidatePath(`/admin/spec-library/${templateId}`);
}
