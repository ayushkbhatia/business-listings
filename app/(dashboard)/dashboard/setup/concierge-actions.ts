"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import {
  cancelCatalogueImport,
  requestCatalogueImport,
} from "@/lib/catalogue-import/service";
import { checkCatalogueFile, MAX_CATALOGUE_BYTES } from "@/lib/catalogue-import/pricing";
import { DOCUMENT_BUCKET, documentPath, signUpload } from "@/lib/storage";
import { formatBytes, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getSellerSeat } from "../_shell";

/**
 * Board 8a's right rail — sending us a catalogue.
 *
 * Thin, as every action in this repo is: read the form, call the service,
 * revalidate. The refusals a seller can act on are the service's discriminated
 * results turned into the `concierge.error.*` sentences; anything else is a bug
 * and is allowed to throw.
 *
 * The upload takes the path `dashboard/verification` already uses — a signed
 * URL straight to the **private** bucket, and a `Document` row written only
 * once the bytes have landed. A price list is commercially sensitive and
 * belongs nowhere public, and posting twenty megabytes through a server action
 * would be twenty megabytes of base64 held in memory.
 *
 * `documentPath` is built from the seat's own `businessId`, never from the
 * form, so a signed URL cannot be obtained for somebody else's folder.
 */

export type SignResult =
  | { ok: true; path: string; token: string; url: string }
  | { ok: false; error: string };

export type RecordResult = { ok: true; documentId: string } | { ok: false; error: string };

export type ConciergeResult = { ok: true } | { ok: false; error: string };

export async function signCatalogueUpload(formData: FormData): Promise<SignResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const filename = String(formData.get("filename") ?? "");
  const type = String(formData.get("type") ?? "");
  const bytes = Number(formData.get("bytes") ?? 0);

  if (!filename || bytes <= 0) return { ok: false, error: t("concierge.error.no_file") };

  const check = checkCatalogueFile(type, bytes, filename);
  if (!check.ok) {
    // The message names the file's own size and type, because "that file is
    // wrong" sends a seller back to a folder with nothing to go on.
    return check.error === "too_big"
      ? {
          ok: false,
          error: t("concierge.error.too_big", {
            size: formatBytes(bytes),
            limit: formatBytes(MAX_CATALOGUE_BYTES),
          }),
        }
      : {
          ok: false,
          error: t("concierge.error.wrong_type", { type: type || filename }),
        };
  }

  try {
    const signed = await signUpload(
      DOCUMENT_BUCKET,
      documentPath(seat.businessId, "catalogue", filename),
    );
    return { ok: true, ...signed };
  } catch {
    return { ok: false, error: t("concierge.error.upload_failed") };
  }
}

/**
 * The `Document` row, written after the bytes are in storage.
 *
 * A failed upload therefore leaves nothing behind, and a row that references
 * bytes which never arrived cannot reach the staff queue.
 */
export async function recordCatalogueFile(formData: FormData): Promise<RecordResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const path = String(formData.get("path") ?? "");
  // The signature said this path was fine; this says it belongs to this seat.
  if (!path.startsWith(`${seat.businessId}/catalogue/`)) {
    return { ok: false, error: t("concierge.error.upload_failed") };
  }

  const created = await prisma.document.create({
    data: {
      businessId: seat.businessId,
      kind: "catalogue",
      storagePath: path,
      filename: String(formData.get("filename") ?? "catalogue"),
      bytes: Number(formData.get("bytes") ?? 0) || null,
      mimeType: String(formData.get("type") ?? "") || null,
    },
    select: { id: true },
  });

  return { ok: true, documentId: created.id };
}

export async function sendCatalogue(formData: FormData): Promise<ConciergeResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const result = await requestCatalogueImport(seat.actor, seat.businessId, {
    documentId: String(formData.get("documentId") ?? ""),
    note: String(formData.get("note") ?? "") || undefined,
  });

  if (!result.ok) {
    switch (result.error) {
      case "not_offered":
        return { ok: false, error: t("concierge.error.not_offered") };
      case "already_open":
        return { ok: false, error: t("concierge.error.already_open") };
      case "no_file":
        return { ok: false, error: t("concierge.error.no_file") };
      default:
        return { ok: false, error: t("dev.no_seat_title") };
    }
  }

  revalidatePath("/dashboard/setup");
  return { ok: true };
}

export async function withdrawCatalogue(formData: FormData): Promise<ConciergeResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const id = String(formData.get("id") ?? "");
  const result = await cancelCatalogueImport(seat.actor, id);
  if (!result.ok) {
    /*
       Reachable only from a page that was open while somebody picked the row
       up. The card hides the cancel control once a request is in progress, so
       the answer here is the state the seller's screen has not caught up with —
       and it needs the due date to say it, which is why this reads the row
       rather than guessing a sentence.
    */
    if (result.error === "already_started") {
      const row = await prisma.catalogueImportRequest.findUnique({
        where: { id },
        select: { dueAt: true },
      });
      return {
        ok: false,
        error: t("concierge.in_progress", {
          due: row?.dueAt ? formatDate(row.dueAt) : t("table.not_provided"),
        }),
      };
    }
    return { ok: false, error: t("dev.no_seat_title") };
  }

  revalidatePath("/dashboard/setup");
  return { ok: true };
}
