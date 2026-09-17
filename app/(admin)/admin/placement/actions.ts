"use server";

import { revalidatePath } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import { setBandPrice, setCurve } from "@/lib/placement/rate-card";
import { t } from "@/lib/i18n";

/**
 * The two ways to move a placement price, and they do not fight.
 *
 * The curve regenerates every rung nobody has tuned; a rung is set by hand and
 * held against the next curve change. Both are audited under `placement_priced`
 * rather than under the plan-entitlement action they share a capability with.
 */

export type RateResult = { ok: true; message: string } | { ok: false; error: string };

export async function saveCurve(formData: FormData): Promise<RateResult> {
  const seat = await requireStaff();
  try {
    const result = await setCurve({
      actor: seat.actor,
      basePriceAed: Number(String(formData.get("basePriceAed") ?? "").trim()),
      // Typed as a percentage, stored as basis points: "10" is a tenth.
      stepBps: Math.round(Number(String(formData.get("stepPercent") ?? "").trim()) * 100),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.message };
    revalidatePath("/admin/placement");
    return { ok: true, message: t("admin.placement.curve_saved", { count: String(result.bandsChanged) }) };
  } catch (error) {
    return refusal(error);
  }
}

export async function saveBandPrice(formData: FormData): Promise<RateResult> {
  const seat = await requireStaff();
  try {
    const result = await setBandPrice({
      actor: seat.actor,
      band: Number(String(formData.get("band") ?? "").trim()),
      monthlyPriceAed: Number(String(formData.get("monthlyPriceAed") ?? "").trim()),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.message };
    revalidatePath("/admin/placement");
    return { ok: true, message: t("admin.placement.band_saved") };
  } catch (error) {
    return refusal(error);
  }
}

function refusal(error: unknown): RateResult {
  if (error instanceof PermissionError) return { ok: false, error: t("admin.placement.not_yours") };
  if (error instanceof AuditReasonError) {
    return { ok: false, error: t("admin.plans.needs_reason") };
  }
  throw error;
}
