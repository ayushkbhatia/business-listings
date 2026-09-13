"use server";

import { revalidatePath } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import { addSection, setSectionSettings } from "@/lib/storefront/service";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Board `5c-s` — the library's two writes: add a section to the template, and
 * configure one already on it.
 *
 * Both go through `lib/storefront/service.ts`, and so through `staffMutation`:
 * no write without an audit row carrying a written reason and the store count.
 * The add is refused server-side for a type this template's listings cannot
 * populate, whatever the screen offered — the disabled card is an opinion, and
 * this is a URL.
 */

export type LibraryActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

function refused(error: unknown): LibraryActionResult {
  if (error instanceof PermissionError) return { ok: false, error: t("builder.not_yours") };
  if (error instanceof AuditReasonError) return { ok: false, error: t("builder.needs_reason") };
  throw error;
}

function done(templateId: string) {
  revalidatePath(`/admin/storefront-templates/${templateId}/sections`);
  revalidatePath(`/admin/storefront-templates/${templateId}`);
  revalidatePath("/admin/storefront-templates");
}

export async function addFromLibrary(formData: FormData): Promise<LibraryActionResult> {
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
    return {
      ok: true,
      message: t("section.library.added", { count: formatCount(result.storeCount) }),
    };
  } catch (error) {
    return refused(error);
  }
}

export async function saveSectionSettings(formData: FormData): Promise<LibraryActionResult> {
  const seat = await requireStaff();
  const templateId = String(formData.get("templateId") ?? "");

  /*
     The form posts one JSON value. A malformed one is a refusal in words, not a
     500 — and it reaches `checkSettings` as nothing rather than as a string,
     because a string is exactly what no setting may hold.
  */
  let settings: unknown = null;
  try {
    settings = JSON.parse(String(formData.get("settings") ?? ""));
  } catch {
    return { ok: false, error: t("section.library.settings_unreadable") };
  }

  try {
    const result = await setSectionSettings({
      actor: seat.actor,
      templateId,
      sectionId: String(formData.get("sectionId") ?? ""),
      settings,
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.message };
    done(templateId);
    return {
      ok: true,
      message: t("section.library.settings_saved", { count: formatCount(result.storeCount) }),
    };
  } catch (error) {
    return refused(error);
  }
}
