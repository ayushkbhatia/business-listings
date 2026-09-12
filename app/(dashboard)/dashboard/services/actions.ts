"use server";

import { revalidatePath } from "next/cache";
import { requireSellerSeat } from "../_shell";
import {
  createService,
  deleteService,
  reorderServices,
  setServiceStatus,
  type CreateResult,
  type PublishResult,
} from "@/lib/services/service";

/**
 * Board `3f-s`'s writes.
 *
 * Four, and that is the whole set: add, publish/unpublish, reorder, delete one.
 * There is no bulk price edit and no bulk stock adjust because there is nothing
 * on a scope sheet that is safe to bulk-edit, and no bulk delete because
 * enquiry history hangs off these rows — `3f-s` B4 and Q2.
 *
 * The seat carries the business; nothing here takes it from a form. Every
 * service call asserts `product.edit` again, because a server action is a URL.
 */

export async function addService(formData: FormData): Promise<CreateResult> {
  const seat = await requireSellerSeat();
  const result = await createService(seat.actor, seat.businessId, String(formData.get("name") ?? ""));
  if (result.ok) revalidatePath("/dashboard/services");
  return result;
}

export async function publishServices(formData: FormData): Promise<PublishResult> {
  const seat = await requireSellerSeat();
  const ids = String(formData.get("ids") ?? "").split(",").filter(Boolean);
  const status = String(formData.get("status") ?? "") === "live" ? "live" : "draft";

  const result = await setServiceStatus(seat.actor, seat.businessId, ids, status);
  if (result.ok) {
    revalidatePath("/dashboard/services");
    // The storefront renders these, so a published service should be published
    // everywhere rather than after the next deploy.
    revalidatePath(`/b/${seat.businessSlug}/services`);
  }
  return result;
}

export async function saveServiceOrder(formData: FormData): Promise<{ ok: boolean }> {
  const seat = await requireSellerSeat();
  const ids = String(formData.get("ids") ?? "").split(",").filter(Boolean);
  const result = await reorderServices(seat.actor, seat.businessId, ids);
  if (result.ok) revalidatePath(`/b/${seat.businessSlug}/services`);
  return { ok: result.ok };
}

export async function removeService(formData: FormData): Promise<{ ok: boolean }> {
  const seat = await requireSellerSeat();
  const result = await deleteService(seat.actor, seat.businessId, String(formData.get("id") ?? ""));
  if (result.ok) {
    revalidatePath("/dashboard/services");
    revalidatePath(`/b/${seat.businessSlug}/services`);
  }
  return { ok: result.ok };
}
