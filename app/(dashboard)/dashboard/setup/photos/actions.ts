"use server";

import { revalidatePath } from "next/cache";
import { checkImage, MEDIA_BUCKET, mediaPath, signUpload } from "@/lib/storage";
import {
  attachPhoto,
  deletePhoto,
  photoUsage,
  reorderPhotos,
  setCover,
} from "@/lib/photos/service";
import { effectiveFor } from "@/lib/billing/entitlements-service";
import { allowance } from "@/lib/plan/entitlements";
import { storageRoom } from "@/lib/media/service";
import { t } from "@/lib/i18n";
import { requireSellerSeat } from "../../_shell";

/**
 * Board 8b's writers.
 *
 * Thin, like every action in this codebase: resolve the seat, hand it to the
 * service, revalidate. Every rule about covers, order, caps and what counts
 * lives in `lib/photos/service.ts`, where it is testable without a request.
 *
 * The upload itself keeps the shape every other upload on this platform uses —
 * a signed per-object URL, the browser PUTs the bytes straight to Storage, and
 * a second call writes the row. No megabyte of image ever passes through a
 * server action, and there is no bucket-wide write policy to get wrong.
 */

export type SignResult =
  | { ok: true; path: string; url: string }
  | { ok: false; error: string };

export type PhotoActionResult = { ok: true } | { ok: false; error: string };

/**
 * Issue a signed URL for one photograph.
 *
 * The size is checked here as well as in the browser, and the bucket checks it
 * a third time. The browser's number is the client's word for what it is about
 * to send; the bucket's is the only one that is a fact.
 */
export async function signPhotoUpload(formData: FormData): Promise<SignResult> {
  const seat = await requireSellerSeat();

  const filename = String(formData.get("filename") ?? "photo");
  const type = String(formData.get("type") ?? "");
  const bytes = Number(formData.get("bytes") ?? 0);

  const accepted = checkImage(type, bytes);
  if (!accepted.ok) return { ok: false, error: accepted.reason };

  const caps = await effectiveFor(seat.businessId);
  if (caps) {
    const used = await photoUsage(seat.businessId);
    const left = allowance(caps, "photos", used);
    if (left.atCap) {
      return {
        ok: false,
        error: t("photos.error.at_cap", { plan: caps.name }),
      };
    }

    /*
       And the storage cap, which this path never read.

       It checked the photo *count* and signed the URL, then wrote a `Media` row
       carrying `bytes` that `storageUsedBytes` counts — so a seller could pass
       their storage limit through the setup task and meet the refusal
       afterwards, on the media library, for bytes this screen had let in. One
       function now, and every writer of a counted byte calls it.
    */
    const room = await storageRoom(seat.businessId, caps, bytes);
    if (room.atCap) {
      return {
        ok: false,
        error: t("media.cap_reached", { cap: `${room.cap} MB`, plan: caps.name }),
      };
    }
  }

  const path = mediaPath(seat.businessId, "gallery", filename);
  const signed = await signUpload(MEDIA_BUCKET, path);
  return { ok: true, path: signed.path, url: signed.url };
}

/** Write the row once the bytes are in Storage. */
export async function attachPhotoAction(formData: FormData): Promise<PhotoActionResult> {
  const seat = await requireSellerSeat();

  const result = await attachPhoto(seat.actor, seat.businessId, {
    path: String(formData.get("path") ?? ""),
    slotKey: formData.get("slotKey") ? String(formData.get("slotKey")) : null,
    bytes: Number(formData.get("bytes") ?? 0),
    width: Number(formData.get("width") ?? 0),
    height: Number(formData.get("height") ?? 0),
    filename: String(formData.get("filename") ?? "photo"),
  });

  if (!result.ok) return result;
  revalidate();
  return { ok: true };
}

export async function setCoverAction(formData: FormData): Promise<PhotoActionResult> {
  const seat = await requireSellerSeat();
  const result = await setCover(seat.actor, seat.businessId, String(formData.get("id") ?? ""));
  if (!result.ok) return result;
  revalidate();
  return { ok: true };
}

export async function deletePhotoAction(formData: FormData): Promise<PhotoActionResult> {
  const seat = await requireSellerSeat();
  const result = await deletePhoto(seat.actor, seat.businessId, String(formData.get("id") ?? ""));
  if (!result.ok) return result;
  revalidate();
  return { ok: true };
}

export async function reorderPhotosAction(ids: string[]): Promise<PhotoActionResult> {
  const seat = await requireSellerSeat();
  const result = await reorderPhotos(seat.actor, seat.businessId, ids);
  if (!result.ok) return result;
  revalidate();
  return { ok: true };
}

/**
 * Four paths, because a photograph is on four screens.
 *
 * The task screen and the hub both count photographs, the media library lists
 * the same rows, and the storefront renders them. Revalidating only this screen
 * would leave a seller who finished the task looking at a hub that still says
 * three of five.
 */
function revalidate(): void {
  revalidatePath("/dashboard/setup/photos");
  revalidatePath("/dashboard/setup");
  revalidatePath("/dashboard/media");
  revalidatePath("/dashboard");
}
