"use server";

import { revalidatePath } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import {
  addSection,
  publishTemplate,
  reorderSections,
  setSectionEnabled,
  setSellerEditableFields,
} from "@/lib/storefront/service";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * The builder's five mutations.
 *
 * Every one goes through `lib/storefront/service.ts`, which goes through
 * `staffMutation`, so none can reach the database without an audit row carrying
 * a written reason and the affected store count. Criterion 11 is satisfied in
 * the service rather than here — which is what stops the sixth screen forgetting.
 *
 * The reason is read from the form and passed straight through. Not defaulted,
 * not composed from a dropdown: `assertReason` refuses blanks and four
 * characters of keyboard-clearing, and a default walks past both.
 */

export type ActionResult =
  | { ok: true; message?: string; storeCount?: number }
  | { ok: false; error: string };

function refused(error: unknown): ActionResult {
  if (error instanceof PermissionError) return { ok: false, error: t("builder.not_yours") };
  if (error instanceof AuditReasonError) return { ok: false, error: t("builder.needs_reason") };
  throw error;
}

function done(templateId: string) {
  revalidatePath(`/admin/storefront-templates/${templateId}`);
  revalidatePath("/admin/storefront-templates");
}

export async function toggleSection(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const templateId = String(formData.get("templateId") ?? "");
  try {
    const result = await setSectionEnabled({
      actor: seat.actor,
      templateId,
      sectionId: String(formData.get("sectionId") ?? ""),
      enabled: formData.get("enabled") === "on",
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.message };
    done(templateId);
    return { ok: true, message: t("builder.saved"), storeCount: result.storeCount };
  } catch (error) {
    return refused(error);
  }
}

export async function reorder(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const templateId = String(formData.get("templateId") ?? "");
  try {
    const result = await reorderSections({
      actor: seat.actor,
      templateId,
      orderedIds: String(formData.get("orderedIds") ?? "").split(",").filter(Boolean),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.message };
    done(templateId);
    return { ok: true, message: t("builder.saved"), storeCount: result.storeCount };
  } catch (error) {
    return refused(error);
  }
}

export async function addToTemplate(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const templateId = String(formData.get("templateId") ?? "");
  try {
    const result = await addSection({
      actor: seat.actor,
      templateId,
      type: String(formData.get("type") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.message };
    done(templateId);
    return { ok: true, message: t("builder.saved"), storeCount: result.storeCount };
  } catch (error) {
    return refused(error);
  }
}

export async function setFields(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const templateId = String(formData.get("templateId") ?? "");
  try {
    const result = await setSellerEditableFields({
      actor: seat.actor,
      templateId,
      sectionId: String(formData.get("sectionId") ?? ""),
      fields: String(formData.get("fields") ?? "").split(",").filter(Boolean),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.message };
    done(templateId);
    return { ok: true, message: t("builder.saved"), storeCount: result.storeCount };
  } catch (error) {
    return refused(error);
  }
}

/**
 * The second step of the two-step publish.
 *
 * The first step is a diff the reader sees; this is the confirm. The store
 * count travels back with the result so the message afterwards names the same
 * number the confirm did — a confirm that says 1,842 and a message that only
 * says "published" leaves somebody wondering whether it did what it said.
 */
export async function publish(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const templateId = String(formData.get("templateId") ?? "");
  try {
    const result = await publishTemplate({
      actor: seat.actor,
      templateId,
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.message };
    done(templateId);
    revalidatePath("/admin");
    return {
      ok: true,
      message: t("builder.published", {
        count: formatCount(result.storeCount),
        version: String(result.version),
      }),
      storeCount: result.storeCount,
    };
  } catch (error) {
    return refused(error);
  }
}
