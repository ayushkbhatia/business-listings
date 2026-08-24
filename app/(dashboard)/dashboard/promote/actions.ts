"use server";

import { revalidatePath } from "next/cache";
import { leaveQueue, takeSlot } from "@/lib/placement/service";
import { t } from "@/lib/i18n";
import { getSellerSeat } from "../_shell";

export type PromoteResult =
  | { ok: true; queued: boolean }
  | { ok: false; error: string };

export async function takePlacementSlot(formData: FormData): Promise<PromoteResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const result = await takeSlot(seat.actor, seat.businessId, String(formData.get("categoryId") ?? ""));
  if (result.ok) revalidatePath("/dashboard/promote");
  return result;
}

export async function leavePlacementQueue(formData: FormData): Promise<PromoteResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const result = await leaveQueue(seat.actor, seat.businessId, String(formData.get("categoryId") ?? ""));
  if (result.ok) revalidatePath("/dashboard/promote");
  return result;
}
