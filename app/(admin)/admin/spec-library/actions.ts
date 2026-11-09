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
import type { SpecResult } from "@/lib/spec/versions";
import { t, type MessageKey } from "@/lib/i18n";

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
 *
 * ## Every refusal returns; none of them throws
 *
 * All eight of these ended in `throw new Error(...)`, seven of them re-throwing
 * an English sentence the service had written. A thrown error in a server
 * action is a page-level failure: an ops lead who left the reason blank — the
 * most likely refusal on the screen, and the one CLAUDE.md non-negotiable 3
 * guarantees — lost the draft panel to an error boundary, and the sentence
 * telling them why had never been through `t()`. The sibling file
 * `scope-actions.ts` already answered this for board `4e-s`; this is the same
 * shape, and `ActionForm` renders it beside the control that was pressed.
 */

export interface Refusal {
  ok: false;
  error: string;
  fix: string;
}

export type SpecActionResult = { ok: true } | Refusal;

/**
 * What correct looks like, per refusal.
 *
 * Every one has a line, because `Alert` with a `bad` tone and no `fix` is a
 * development error by design-system §05.1 — a notice that tells somebody they
 * are stuck and not how to get out. The default covers the three that mean the
 * row is gone: reload, because the screen is older than the database.
 */
const STALE = "admin.spec.error.stale_fix" as const;

const FIXES: Partial<Record<MessageKey, MessageKey>> = {
  "admin.spec.error.duplicate_key": "admin.spec.error.duplicate_key_fix",
  "admin.spec.error.not_live": "admin.spec.error.not_live_fix",
  "admin.spec.error.field_not_live": "admin.spec.error.not_live_fix",
  "admin.spec.error.empty_draft": "admin.spec.error.empty_draft_fix",
  "admin.spec.error.already_required": "admin.spec.error.already_fix",
  "admin.spec.error.already_optional": "admin.spec.error.already_fix",
  "admin.spec.error.already_default": "admin.spec.error.already_fix",
  "admin.spec.error.not_serving": "admin.spec.error.not_serving_fix",
};

/** A service refusal, resolved for the screen. Never called on an `ok` result. */
function refuse(result: Extract<SpecResult<never>, { ok: false }>): Refusal {
  return {
    ok: false,
    error: t(result.message, result.values ?? {}),
    fix: t(FIXES[result.message] ?? STALE),
  };
}

const NO_REASON: Refusal = {
  ok: false,
  error: t("admin.spec.error.reason"),
  fix: t("admin.spec.error.reason_fix"),
};

// `AuditEvent.reason` is NOT NULL because the log records decisions. A blank
// reason is refused rather than defaulted to something the person did not
// write — CLAUDE.md non-negotiable 3.
function reasonFrom(formData: FormData): string | null {
  const reason = String(formData.get("reason") ?? "").trim();
  return reason === "" ? null : reason;
}

function optionsFrom(raw: FormDataEntryValue | null): string[] {
  return String(raw ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function createTemplateAction(formData: FormData): Promise<SpecActionResult> {
  const seat = await requireStaff();
  assertCan(seat.actor, "taxonomy.write");

  const reason = reasonFrom(formData);
  if (reason === null) return NO_REASON;

  const result = await createTemplate({
    actor: seat.actor,
    name: String(formData.get("name") ?? "").trim(),
    categoryId: String(formData.get("categoryId") ?? ""),
    reason,
  });
  if (!result.ok) return refuse(result);

  revalidatePath("/admin/spec-library");
  // Throws its own navigation signal, so nothing after it runs and the caller
  // never sees a result — which is why this one returns on the refusal path
  // only.
  redirect(`/admin/spec-library/${result.value}`);
}

export async function stageFieldAction(formData: FormData): Promise<SpecActionResult> {
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
  if (!result.ok) return refuse(result);

  revalidatePath(`/admin/spec-library/${templateId}`);
  return { ok: true };
}

export async function stageFieldFlagAction(formData: FormData): Promise<SpecActionResult> {
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
  if (!result.ok) return refuse(result);

  revalidatePath(`/admin/spec-library/${templateId}`);
  return { ok: true };
}

export async function stageRemovalAction(formData: FormData): Promise<SpecActionResult> {
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
  if (!result.ok) return refuse(result);

  revalidatePath(`/admin/spec-library/${templateId}`);
  return { ok: true };
}

export async function discardDraftAction(formData: FormData): Promise<SpecActionResult> {
  const seat = await requireStaff();
  assertCan(seat.actor, "taxonomy.write");

  const templateId = String(formData.get("templateId") ?? "");
  const result = await discardDraft(seat.actor, templateId);
  if (!result.ok) return refuse(result);

  revalidatePath(`/admin/spec-library/${templateId}`);
  return { ok: true };
}

/** Action one. Additive and safe — it cannot put a product in violation. */
export async function publishDraftAction(formData: FormData): Promise<SpecActionResult> {
  const seat = await requireStaff();
  assertCan(seat.actor, "taxonomy.write");

  const reason = reasonFrom(formData);
  if (reason === null) return NO_REASON;

  const templateId = String(formData.get("templateId") ?? "");
  const result = await publishDraft({ actor: seat.actor, templateId, reason });
  if (!result.ok) return refuse(result);

  /*
     The facet rail and the spec table both read the platform template, and a
     publish can change which fields are facets. Revalidating only this screen
     would leave the buyer-facing pages on the old field set until their own
     cache expired.
  */
  revalidatePath("/admin/spec-library");
  revalidatePath(`/admin/spec-library/${templateId}`);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Action two. Flags and blocks the next save; never delists, no deadline. */
export async function setRequiredAction(formData: FormData): Promise<SpecActionResult> {
  const seat = await requireStaff();
  assertCan(seat.actor, "taxonomy.write");

  const reason = reasonFrom(formData);
  if (reason === null) return NO_REASON;

  const templateId = String(formData.get("templateId") ?? "");
  const result = await setFieldRequired({
    actor: seat.actor,
    fieldId: String(formData.get("fieldId") ?? ""),
    required: formData.get("required") === "true",
    reason,
  });
  if (!result.ok) return refuse(result);

  revalidatePath(`/admin/spec-library/${templateId}`);
  return { ok: true };
}
