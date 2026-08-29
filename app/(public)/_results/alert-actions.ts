"use server";

import { getActor } from "@/lib/auth/session";
import { createAlert } from "@/lib/alerts/service";
import { t } from "@/lib/i18n";
import type { Emirate } from "@/lib/db/generated/enums";
import type { AlertActionResult } from "./AlertForm";

/**
 * Criterion 8 — setting an alert from a zero-result page.
 *
 * Thin, like the RFQ action: resolve who is asking and hand it to the service.
 * Every rule about what counts as a match lives in `lib/alerts/service.ts`,
 * where it is tested without a request.
 */
export async function setAlert(formData: FormData): Promise<AlertActionResult> {
  const actor = await getActor();

  const result = await createAlert({
    query: String(formData.get("query") ?? ""),
    categoryId: String(formData.get("categoryId") ?? "") || null,
    emirate: (String(formData.get("emirate") ?? "") || null) as Emirate | null,
    userId: actor?.id ?? null,
    contact: String(formData.get("contact") ?? ""),
    fullName: String(formData.get("fullName") ?? ""),
  });

  if (!result.ok) return { ok: false, error: result.message };
  return { ok: true, message: t("alert.set") };
}
