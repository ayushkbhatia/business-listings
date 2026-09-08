"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { assertCanEditListing } from "@/lib/auth/guards";
import { allowance } from "@/lib/plan/entitlements";
import { effectiveFor } from "@/lib/billing/entitlements-service";
import { checkImage, MEDIA_BUCKET, mediaPath, signUpload } from "@/lib/storage";
import * as media from "@/lib/media/service";
import type { DeletePreview } from "@/lib/media/service";
import { t } from "@/lib/i18n";
import { getSellerSeat } from "../_shell";

/**
 * Media mutations.
 *
 * The browser uploads straight to Storage with a signed URL. The permission is
 * the signature, and it is issued here — after checking the seller owns the
 * business the path is under and that they have room left on their plan. There
 * is no bucket-wide write policy to get wrong, and no eight-megabyte request
 * body through a server action.
 *
 * Every rule that decides what may happen to a file lives in `lib/media/`;
 * these are the entry points, and each one re-checks the seat. A server action
 * is a URL: the screen not rendering a control is not the same as the action
 * refusing it.
 */

export type SignResult =
  | { ok: true; path: string; token: string; url: string }
  | { ok: false; error: string };

const KINDS = ["logo", "cover", "gallery", "product", "storefront"] as const;
type Kind = (typeof KINDS)[number];

async function seatOrThrow() {
  const seat = await getSellerSeat();
  if (!seat) throw new Error(t("dev.no_seat_title"));
  assertCanEditListing(seat.actor);
  return seat;
}

const refresh = () => {
  revalidatePath("/dashboard/media");
  // A file's alt text, its gallery position and whether it exists at all are
  // all read by public surfaces, so the storefront is revalidated with it.
  revalidatePath("/dashboard/products");
  revalidatePath("/", "layout");
};

/* ── Upload ──────────────────────────────────────────────────────────────── */

export async function signMediaUpload(formData: FormData): Promise<SignResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };
  assertCanEditListing(seat.actor);

  const filename = String(formData.get("filename") ?? "photo.jpg");
  const type = String(formData.get("type") ?? "");
  const bytes = Number(formData.get("bytes") ?? 0);
  const kind = String(formData.get("kind") ?? "gallery");

  // Refused before a byte moves, and the message says the limit and the size.
  const check = checkImage(type, bytes);
  if (!check.ok) return { ok: false, error: check.reason };

  const plan = await effectiveFor(seat.businessId);
  if (plan) {
    /*
       Two caps, and the refusal names whichever bites.

       `photoLimit` counts photographs and `storageMb` counts bytes; a datasheet
       costs storage and is not a photograph, so neither subsumes the other.
       Per board 3f §6 and 3i §1 the limit is stated before it bites and never
       destroys a record: at the cap uploads stop, nothing is deleted and
       nothing comes off the seller's listing.
    */
    const photos = await prisma.media.count({
      where: { businessId: seat.businessId, reviewId: null },
    });
    const photoRoom = allowance(plan, "photos", photos);
    if (photoRoom.atCap) {
      return {
        ok: false,
        error: t("media.at_cap", {
          cap: String(photoRoom.cap ?? 0),
          plan: plan.name,
          next: "Pro",
          cap_next: "200",
        }),
      };
    }

    const room = await media.storageRoom(seat.businessId, plan, bytes);
    if (room.atCap) {
      return {
        ok: false,
        error: t("media.cap_reached", {
          cap: `${room.cap} MB`,
          plan: plan.name,
        }),
      };
    }
  }

  // The path is built from the seat's own businessId, never from the form.
  const path = mediaPath(
    seat.businessId,
    (KINDS as readonly string[]).includes(kind) ? kind : "gallery",
    filename,
  );

  try {
    const signed = await signUpload(MEDIA_BUCKET, path);
    return { ok: true, ...signed };
  } catch {
    return { ok: false, error: t("media.storage_off") };
  }
}

export type RecordResult = { ok: true; id: string } | { ok: false; error: string };

/** Called once the bytes are in Storage, so a failed upload leaves no row. */
export async function recordMedia(formData: FormData): Promise<RecordResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };
  assertCanEditListing(seat.actor);

  const path = String(formData.get("path") ?? "");
  const kind = String(formData.get("kind") ?? "gallery");
  const width = Number(formData.get("width") ?? 0);
  const height = Number(formData.get("height") ?? 0);
  const folderId = String(formData.get("folderId") ?? "") || null;

  // A path outside this seller's folder is not theirs to record, whatever the
  // signature said. Cheap, and it is the only check that survives a bug above.
  if (!path.startsWith(`${seat.businessId}/`)) {
    return { ok: false, error: t("media.storage_off") };
  }

  /*
     An upload that duplicates a file already stored is offered back rather than
     stored twice — board 3i's states. The cap is measured in bytes, so a second
     copy costs the seller their allowance for nothing.
  */
  const existing = await prisma.media.findFirst({
    where: { businessId: seat.businessId, storagePath: path, reviewId: null },
    select: { id: true },
  });
  if (existing) {
    refresh();
    return { ok: true, id: existing.id };
  }

  const created = await prisma.media.create({
    data: {
      businessId: seat.businessId,
      kind: ((KINDS as readonly string[]).includes(kind) ? kind : "gallery") as Kind,
      storagePath: path,
      alt: String(formData.get("alt") ?? "").trim() || null,
      bytes: Number(formData.get("bytes") ?? 0) || null,
      folderId,
      ...(width > 0 && height > 0 ? { width, height } : {}),
    },
    select: { id: true },
  });

  refresh();
  return { ok: true, id: created.id };
}

/* ── The board's actions ─────────────────────────────────────────────────── */

export async function previewDeleteAction(
  fileId: string,
): Promise<{ ok: true; value: DeletePreview } | { ok: false; message: string }> {
  const seat = await seatOrThrow();
  const result = await media.previewDelete(seat.businessId, fileId);
  return result.ok ? { ok: true, value: result.value } : { ok: false, message: result.message };
}

export async function deleteFileAction(formData: FormData): Promise<void> {
  const seat = await seatOrThrow();
  const result = await media.deleteFile(seat.businessId, String(formData.get("fileId") ?? ""));
  if (!result.ok) throw new Error(result.message);
  refresh();
}

export async function saveAltAction(formData: FormData): Promise<void> {
  const seat = await seatOrThrow();
  const result = await media.saveAlt(
    seat.businessId,
    String(formData.get("fileId") ?? ""),
    String(formData.get("alt") ?? ""),
  );
  if (!result.ok) throw new Error(result.message);
  refresh();
}

export async function createFolderAction(formData: FormData): Promise<void> {
  const seat = await seatOrThrow();
  const result = await media.createFolder(seat.businessId, String(formData.get("name") ?? ""));
  if (!result.ok) throw new Error(result.message);
  refresh();
}

export async function moveToFolderAction(formData: FormData): Promise<void> {
  const seat = await seatOrThrow();
  const raw = String(formData.get("folderId") ?? "");
  const result = await media.moveToFolder(
    seat.businessId,
    formData.getAll("fileId").map(String),
    raw === "" ? null : raw,
  );
  if (!result.ok) throw new Error(result.message);
  refresh();
}

export async function attachToProductAction(formData: FormData): Promise<void> {
  const seat = await seatOrThrow();
  const result = await media.attachToProduct(
    seat.businessId,
    formData.getAll("fileId").map(String),
    String(formData.get("productId") ?? ""),
  );
  if (!result.ok) throw new Error(result.message);
  refresh();
}

export async function detachFromProductAction(formData: FormData): Promise<void> {
  const seat = await seatOrThrow();
  const result = await media.detachFromProduct(
    seat.businessId,
    String(formData.get("fileId") ?? ""),
    String(formData.get("productId") ?? ""),
  );
  if (!result.ok) throw new Error(result.message);
  refresh();
}

export async function setPrimaryAction(formData: FormData): Promise<void> {
  const seat = await seatOrThrow();
  const result = await media.setPrimary(
    seat.businessId,
    String(formData.get("fileId") ?? ""),
    String(formData.get("productId") ?? ""),
  );
  if (!result.ok) throw new Error(result.message);
  refresh();
}
