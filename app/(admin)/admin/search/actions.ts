"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import { boostListing, setWeights } from "@/lib/search/settings";
import { RANKING_CACHE_TAG } from "@/lib/db/queries/pricing";
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
    /*
       Board 1l criterion 6: moving the plan-tier weight changes what `/pricing`
       claims a paid plan does to a supplier's ranking. That page reads the live
       weights through a tagged cache, so the claim only moves if this line
       clears it — otherwise the results reorder and the page keeps quoting the
       share the weights used to have.
    */
    revalidateTag(RANKING_CACHE_TAG, { expire: 0 });
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
