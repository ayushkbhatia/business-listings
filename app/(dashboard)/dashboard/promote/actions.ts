"use server";

import { revalidatePath } from "next/cache";
import type { Emirate } from "@/lib/db/generated/enums";
import { leaveQueue, takeSlot } from "@/lib/placement/service";
import { isEmirate } from "@/lib/uae";
import { t } from "@/lib/i18n";
import { getSellerSeat } from "../_shell";

export type PromoteResult =
  | { ok: true; queued: boolean; monthlyPriceAed?: number }
  | { ok: false; error: string };

/**
 * The scope, off the form.
 *
 * `null` where the emirate is missing or is not one of the seven — the service
 * refuses a country-wide purchase by name, so an unparsed value lands on a
 * refusal that says what is wrong rather than on a silent national booking,
 * which is what the old signature would have done with it.
 */
function scopeFrom(formData: FormData): { categoryId: string; emirate: Emirate | null } {
  const claimed = String(formData.get("emirate") ?? "");
  return {
    categoryId: String(formData.get("categoryId") ?? ""),
    emirate: isEmirate(claimed) ? claimed : null,
  };
}

export async function takePlacementSlot(formData: FormData): Promise<PromoteResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const scope = scopeFrom(formData);
  const result = await takeSlot(seat.actor, seat.businessId, scope.categoryId, scope.emirate);
  if (result.ok) revalidatePath("/dashboard/promote");
  return result;
}

export async function leavePlacementQueue(formData: FormData): Promise<PromoteResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const scope = scopeFrom(formData);
  const result = await leaveQueue(seat.actor, seat.businessId, scope.categoryId, scope.emirate);
  if (result.ok) revalidatePath("/dashboard/promote");
  return result;
}
