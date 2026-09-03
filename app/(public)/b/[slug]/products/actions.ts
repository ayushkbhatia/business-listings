"use server";

import { getActor } from "@/lib/auth/session";
import { watchProduct } from "@/lib/alerts/service";
import { t } from "@/lib/i18n";

export type WatchActionResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * Board 1e criterion 7 — "Notify me" on an out-of-stock line.
 *
 * Thin, like the alert action beside it: resolve who is asking and hand it to
 * the service. Every rule about what a watch is and when it fires lives in
 * `lib/alerts/service.ts`, where it is tested without a request.
 */
export async function watchProductAction(formData: FormData): Promise<WatchActionResult> {
  const actor = await getActor();

  const result = await watchProduct({
    productId: String(formData.get("productId") ?? ""),
    userId: actor?.id,
    contact: String(formData.get("contact") ?? ""),
    fullName: String(formData.get("fullName") ?? ""),
  });

  if (!result.ok) return { ok: false, error: result.message };
  return { ok: true, message: t("product.notify_set") };
}
