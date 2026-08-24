"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { assertCanEditListing } from "@/lib/auth/guards";
import { allowance, type PlanCaps } from "@/lib/plan/entitlements";
import { checkImage, MEDIA_BUCKET, mediaPath, publicUrl, removeObject, signUpload } from "@/lib/storage";
import { t } from "@/lib/i18n";
import { getSellerSeat } from "../_shell";

/**
 * Media mutations.
 *
 * The browser uploads straight to Storage with a signed URL. The permission is
 * the signature, and it is issued here — after checking the seller owns the
 * business the path is under and that they have a photograph left on their
 * plan. There is no bucket-wide write policy to get wrong, and no eight-megabyte
 * request body through a server action.
 */

const KINDS = ["logo", "cover", "gallery", "product", "storefront"] as const;
type Kind = (typeof KINDS)[number];

export type SignResult =
  | { ok: true; path: string; token: string; url: string }
  | { ok: false; error: string };

async function planFor(businessId: string): Promise<PlanCaps | null> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      plan: {
        select: {
          id: true, name: true, monthlyPriceAed: true, enquiriesPerMonth: true,
          productLimit: true, locationLimit: true, photoLimit: true, teamSeats: true,
          rankingMultiplier: true, customDomain: true, siteVisitIncluded: true, sortOrder: true,
        },
      },
    },
  });
  if (business?.plan) return business.plan;
  return prisma.plan.findUnique({
    where: { id: "free" },
    select: {
      id: true, name: true, monthlyPriceAed: true, enquiriesPerMonth: true,
      productLimit: true, locationLimit: true, photoLimit: true, teamSeats: true,
      rankingMultiplier: true, customDomain: true, siteVisitIncluded: true, sortOrder: true,
    },
  });
}

async function photoCount(businessId: string): Promise<number> {
  return prisma.media.count({
    where: { OR: [{ businessId }, { product: { businessId } }], reviewId: null },
  });
}

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

  const plan = await planFor(seat.businessId);
  if (plan) {
    const used = await photoCount(seat.businessId);
    const left = allowance(plan, "photos", used);
    if (left.atCap) {
      return {
        ok: false,
        error: t("media.at_cap", {
          cap: String(left.cap ?? 0),
          plan: plan.name,
          next: "Pro",
          cap_next: "200",
        }),
      };
    }
  }

  // The path is built from the seat's own businessId, never from the form.
  const path = mediaPath(seat.businessId, (KINDS as readonly string[]).includes(kind) ? kind : "gallery", filename);

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

  // A path outside this seller's folder is not theirs to record, whatever the
  // signature said. Cheap, and it is the only check that survives a bug above.
  if (!path.startsWith(`${seat.businessId}/`)) {
    return { ok: false, error: t("media.storage_off") };
  }

  const created = await prisma.media.create({
    data: {
      businessId: seat.businessId,
      kind: ((KINDS as readonly string[]).includes(kind) ? kind : "gallery") as Kind,
      storagePath: path,
      alt: String(formData.get("alt") ?? "").trim() || null,
      bytes: Number(formData.get("bytes") ?? 0) || null,
    },
    select: { id: true },
  });

  revalidatePath("/dashboard/media");
  return { ok: true, id: created.id };
}

export type MediaResult = { ok: true } | { ok: false; error: string };

export async function saveAlt(formData: FormData): Promise<MediaResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };
  assertCanEditListing(seat.actor);

  const id = String(formData.get("id") ?? "");
  const { count } = await prisma.media.updateMany({
    where: { id, businessId: seat.businessId },
    data: { alt: String(formData.get("alt") ?? "").trim() || null },
  });
  if (count === 0) return { ok: false, error: t("product.not_found") };

  revalidatePath("/dashboard/media");
  return { ok: true };
}

export async function deleteMedia(formData: FormData): Promise<MediaResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };
  assertCanEditListing(seat.actor);

  const id = String(formData.get("id") ?? "");
  const media = await prisma.media.findUnique({
    where: { id },
    select: { id: true, businessId: true, storagePath: true },
  });
  if (!media || media.businessId !== seat.businessId) {
    return { ok: false, error: t("product.not_found") };
  }

  // The row first. An orphaned object costs storage; an orphaned row renders a
  // broken image on a storefront, which is the worse of the two.
  await prisma.media.delete({ where: { id: media.id } });
  await removeObject(MEDIA_BUCKET, media.storagePath).catch(() => undefined);

  revalidatePath("/dashboard/media");
  return { ok: true };
}

export async function deleteMediaForm(formData: FormData): Promise<void> {
  await deleteMedia(formData);
}

/** The public URL for one stored object. */
export async function mediaUrl(path: string): Promise<string> {
  return publicUrl(MEDIA_BUCKET, path);
}
