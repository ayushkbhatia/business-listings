"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { assertCanEditListing } from "@/lib/auth/guards";
import {
  checkDocument,
  DOCUMENT_BUCKET,
  documentPath,
  removeObject,
  signUpload,
} from "@/lib/storage";
import { t } from "@/lib/i18n";
import { getSellerSeat } from "../_shell";

/**
 * Verification documents.
 *
 * A seller uploads; nothing here changes their tier, and there is no code path
 * that could. `Business.verificationTier` is `ops_lead`-only — CLAUDE.md
 * non-negotiable 2 — and the absence of an `assertCanChangeVerificationTier`
 * call in this file is the whole of criterion 11's other half for this screen.
 *
 * The private bucket is the other half of the trust. A trade licence handed
 * over to be verified is not a licence consented to be published, so these
 * objects have no public URL at all and are read through a short-lived signed
 * link when staff open one.
 */

const KINDS = ["trade_licence", "vat_certificate", "certificate", "catalogue", "datasheet"] as const;

export type SignResult =
  | { ok: true; path: string; token: string; url: string }
  | { ok: false; error: string };

export async function signDocumentUpload(formData: FormData): Promise<SignResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };
  assertCanEditListing(seat.actor);

  const filename = String(formData.get("filename") ?? "document.pdf");
  const type = String(formData.get("type") ?? "");
  const bytes = Number(formData.get("bytes") ?? 0);
  const kind = String(formData.get("kind") ?? "trade_licence");

  const check = checkDocument(type, bytes);
  if (!check.ok) return { ok: false, error: check.reason };

  // Built from the seat's own businessId, never from the form.
  const path = documentPath(
    seat.businessId,
    (KINDS as readonly string[]).includes(kind) ? kind : "certificate",
    filename,
  );

  try {
    const signed = await signUpload(DOCUMENT_BUCKET, path);
    return { ok: true, ...signed };
  } catch {
    return { ok: false, error: t("media.storage_off") };
  }
}

export type RecordResult = { ok: true; id: string } | { ok: false; error: string };

export async function recordDocument(formData: FormData): Promise<RecordResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };
  assertCanEditListing(seat.actor);

  const path = String(formData.get("path") ?? "");
  if (!path.startsWith(`${seat.businessId}/`)) {
    return { ok: false, error: t("media.storage_off") };
  }

  const kind = String(formData.get("kind") ?? "trade_licence");
  const created = await prisma.document.create({
    data: {
      businessId: seat.businessId,
      kind: ((KINDS as readonly string[]).includes(kind) ? kind : "certificate") as (typeof KINDS)[number],
      storagePath: path,
      filename: String(formData.get("filename") ?? "document"),
      bytes: Number(formData.get("bytes") ?? 0) || null,
      mimeType: String(formData.get("type") ?? "") || null,
    },
    select: { id: true },
  });

  revalidatePath("/dashboard/verification");
  return { ok: true, id: created.id };
}

export type DeleteResult = { ok: true } | { ok: false; error: string };

export async function deleteDocument(formData: FormData): Promise<DeleteResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };
  assertCanEditListing(seat.actor);

  const document = await prisma.document.findUnique({
    where: { id: String(formData.get("id") ?? "") },
    select: { id: true, businessId: true, storagePath: true },
  });
  if (!document || document.businessId !== seat.businessId) {
    return { ok: false, error: t("product.not_found") };
  }

  await prisma.document.delete({ where: { id: document.id } });
  await removeObject(DOCUMENT_BUCKET, document.storagePath).catch(() => undefined);

  revalidatePath("/dashboard/verification");
  return { ok: true };
}
