"use server";

import { revalidatePath } from "next/cache";
import { requireSellerSeat } from "../../_shell";
import {
  isEditableField,
  patchServiceField,
  setServiceStatus,
  type ServiceWrite,
} from "@/lib/services/service";

/**
 * Board `3g-s`'s writes — one field at a time.
 *
 * The `2c-s` autosave contract, and the half of it that matters here is
 * "patch only the changed field": two open tabs cannot have one post its stale
 * copy of the other's work over the top.
 *
 * Nothing revalidates on a keystroke. `revalidatePath` on a field save would
 * re-render the server component and replace what the seller is still typing
 * with what is on the record; the page holds its own draft and the timestamp in
 * the header is the receipt. Publishing does revalidate, because that changes
 * what a buyer can reach.
 */

const GONE: ServiceWrite = { ok: false, reason: "not_found" };

export async function saveServiceField(formData: FormData): Promise<ServiceWrite> {
  const seat = await requireSellerSeat();
  const field = String(formData.get("field") ?? "");
  if (!isEditableField(field)) return GONE;

  return patchServiceField(
    seat.actor,
    seat.businessId,
    String(formData.get("id") ?? ""),
    field,
    String(formData.get("value") ?? ""),
  );
}

export type StatusResult = { ok: boolean };

export async function setStatus(formData: FormData): Promise<StatusResult> {
  const seat = await requireSellerSeat();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "") === "live" ? "live" : "draft";

  const result = await setServiceStatus(seat.actor, seat.businessId, [id], status);
  if (result.ok) {
    revalidatePath(`/dashboard/services/${id}`);
    revalidatePath("/dashboard/services");
    revalidatePath(`/b/${seat.businessSlug}/services`);
  }
  return { ok: result.ok };
}
