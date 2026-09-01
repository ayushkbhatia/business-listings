"use server";

import { revalidatePath } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import { assertCan } from "@/lib/auth/can";
import { prisma } from "@/lib/db/client";
import { attachVisitPhoto, recordVisit, withinTheUae } from "@/lib/visits/service";
import { checkImage, DOCUMENT_BUCKET, mediaPath, signUpload } from "@/lib/storage";
import { t } from "@/lib/i18n";

/**
 * Board 4h — filing a site visit report.
 *
 * `recordVisit` has been written, audited and capability-checked since it was
 * added and nothing called it. It is the last of the eight, and it was last
 * because it needs something none of the others did: a way for staff to upload
 * a photograph. The only `FileDrop` wiring on the platform was seller-side and
 * gated on a seller seat.
 *
 * Photographs are evidence, not content:
 *
 *   - `kind: "visit"`, a media kind added for this. Filing them under an
 *     existing kind would have published a verifier's photographs of somebody's
 *     warehouse on that supplier's own storefront — `lib/storefront/blocks.ts`
 *     renders `gallery`.
 *   - Written to the **private** document bucket, beside trade licences, and
 *     read back through a signed URL that expires.
 *
 * Both actions assert `visit.record` themselves. `recordVisit` asserts it again
 * at the fence, but `signVisitPhoto` never reaches the fence — it writes no
 * platform state — so without the assert here any staff seat could obtain a
 * signed upload URL into a business's private folder.
 */

export type SignResult =
  | { ok: true; path: string; token: string; url: string }
  | { ok: false; error: string };

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

function refused(error: unknown): ActionResult {
  if (error instanceof PermissionError) return { ok: false, error: t("admin.queue.not_yours") };
  if (error instanceof AuditReasonError) return { ok: false, error: t("admin.queue.needs_reason") };
  throw error;
}

export async function signVisitPhoto(formData: FormData): Promise<SignResult> {
  const seat = await requireStaff();
  try {
    assertCan(seat.actor, "visit.record");
  } catch {
    return { ok: false, error: t("admin.queue.not_yours") };
  }

  const businessId = String(formData.get("businessId") ?? "");
  const filename = String(formData.get("filename") ?? "photo.jpg");

  // Refused before a byte moves, and the message says the limit and the size.
  const check = checkImage(String(formData.get("type") ?? ""), Number(formData.get("bytes") ?? 0));
  if (!check.ok) return { ok: false, error: check.reason };

  // The business comes from the request being reported on, not from the form,
  // so a signed URL cannot be obtained for somebody else's folder.
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true },
  });
  if (!business) return { ok: false, error: t("admin.visit.not_found") };

  try {
    const signed = await signUpload(DOCUMENT_BUCKET, mediaPath(business.id, "visit", filename));
    return { ok: true, ...signed };
  } catch {
    return { ok: false, error: t("media.storage_off") };
  }
}

/**
 * The `Media` row for an uploaded photograph, written once the bytes are in
 * storage so a failed upload leaves nothing behind.
 *
 * Returns the id the report form holds until it is filed. A photograph with no
 * report is an orphan row and a wasted object; both are cheaper than a report
 * that references bytes which never arrived.
 */
export async function recordVisitPhoto(formData: FormData): Promise<
  { ok: true; mediaId: string } | { ok: false; error: string }
> {
  const seat = await requireStaff();
  try {
    assertCan(seat.actor, "visit.record");
  } catch {
    return { ok: false, error: t("admin.queue.not_yours") };
  }

  const result = await attachVisitPhoto({
    businessId: String(formData.get("businessId") ?? ""),
    path: String(formData.get("path") ?? ""),
    bytes: Number(formData.get("bytes") ?? 0) || null,
  });

  // The folder check lives in the service with the write it guards, so it
  // cannot be skipped by a second caller.
  if (!result.ok) return { ok: false, error: t("media.storage_off") };
  return { ok: true, mediaId: result.mediaId };
}

export async function fileReport(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();

  let photos: { mediaId: string; lat: number; lng: number; takenAt: Date }[];
  try {
    const raw = JSON.parse(String(formData.get("photos") ?? "[]")) as unknown[];
    photos = raw.map((entry) => {
      const photo = entry as Record<string, unknown>;
      return {
        mediaId: String(photo["mediaId"]),
        lat: Number(photo["lat"]),
        lng: Number(photo["lng"]),
        takenAt: new Date(String(photo["takenAt"])),
      };
    });
  } catch {
    // Written by the form, so a parse failure means something else posted it.
    return { ok: false, error: t("admin.visit.photos_unreadable") };
  }

  /*
     Checked here as well as in the service.

     `withinTheUae` runs at the fence and a CHECK constraint runs in Postgres
     under that, so this changes no outcome — it changes when somebody finds
     out. A verifier who has typed a report and uploaded four photographs
     should not learn on submit that one of them is in the wrong country.
  */
  const stray = photos.find((photo) => !Number.isFinite(photo.lat) || !withinTheUae(photo));
  if (stray) return { ok: false, error: t("admin.visit.outside_uae") };

  try {
    const result = await recordVisit({
      actor: seat.actor,
      businessId: String(formData.get("businessId") ?? ""),
      ...(String(formData.get("requestId") ?? "")
        ? { requestId: String(formData.get("requestId")) }
        : {}),
      visitedAt: new Date(String(formData.get("visitedAt") ?? "")),
      premisesFound: formData.get("premisesFound") === "on",
      signageMatches: formData.get("signageMatches") === "on",
      stockPresent: formData.get("stockPresent") === "on",
      ...(String(formData.get("notes") ?? "") ? { notes: String(formData.get("notes")) } : {}),
      photos,
      reason: String(formData.get("reason") ?? ""),
    });

    // The service's refusals are already written in the right voice — the
    // photo floor and the bounding box both name the number.
    if (!result.ok) return { ok: false, error: result.message };

    revalidatePath("/admin/visits");
    revalidatePath("/admin/businesses");
    revalidatePath("/admin");
    return { ok: true, message: t("admin.visit.filed") };
  } catch (error) {
    return refused(error);
  }
}
