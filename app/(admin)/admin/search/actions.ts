"use server";

import { revalidatePath } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import { boostListing, setWeights } from "@/lib/search/settings";
import { WEIGHT_KEYS } from "@/lib/search/ranking";
import type { RankingWeights } from "@/lib/search/ranking";
import { t } from "@/lib/i18n";

/** Board 12c's two mutations, on two different capabilities. */

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

function refused(error: unknown): ActionResult {
  if (error instanceof PermissionError) return { ok: false, error: t("ranking.not_yours") };
  if (error instanceof AuditReasonError) return { ok: false, error: t("builder.needs_reason") };
  throw error;
}

export async function saveWeights(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const next = Object.fromEntries(
    WEIGHT_KEYS.map((key) => [key, Number(formData.get(key) ?? 0)]),
  ) as unknown as RankingWeights;

  try {
    const result = await setWeights(
      seat.actor,
      next,
      String(formData.get("reason") ?? ""),
    );
    if (!result.ok) return { ok: false, error: result.message };

    revalidatePath("/admin/search");
    // Search is cached. Without this the weights change and the results do not.
    revalidatePath("/search");
    return { ok: true, message: t("ranking.saved") };
  } catch (error) {
    return refused(error);
  }
}

export async function addBoost(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await boostListing({
      actor: seat.actor,
      businessId: String(formData.get("businessId") ?? ""),
      points: Number(formData.get("points") ?? 0),
      reason: String(formData.get("reason") ?? ""),
      expiresAt: new Date(String(formData.get("expiresAt") ?? "")),
    });
    if (!result.ok) return { ok: false, error: result.message };

    revalidatePath("/admin/search");
    revalidatePath("/search");
    return { ok: true, message: t("ranking.boosted") };
  } catch (error) {
    return refused(error);
  }
}
