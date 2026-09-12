"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import {
  checkDocument,
  DOCUMENT_BUCKET,
  DOCUMENT_TYPES,
  MAX_DOCUMENT_BYTES,
  documentPath,
  removeObject,
  signUpload,
} from "@/lib/storage";
import { formatCount } from "@/lib/format";
import { addCredential, removeCredential, type RegisterNote } from "@/lib/credentials/service";
import { isCredentialKind } from "@/lib/credentials/kinds";
import { t } from "@/lib/i18n";
import { requireSellerSeat } from "../../_shell";

/**
 * Board `8b-s`'s writers.
 *
 * Thin, like every action here: resolve the seat, hand it to the service,
 * revalidate. What a tier is allowed to say and which kinds reach a register
 * live in `lib/credentials/`, where they are testable without a request.
 *
 * ## The only refusals in this file are structural
 *
 * B1 and AC1: nothing on this screen is required. A credential with no number,
 * no issuer, no expiry and no file saves as exactly what it is. The refusals
 * that remain are a kind that is not a kind, a file the bucket will not take,
 * and a path outside the seat's own folder — none of which a seller can hit by
 * leaving a field alone.
 */

/**
 * Every refusal carries its way out.
 *
 * `Alert` refuses a `bad` or `warn` notice with no `action` and no `fix` in
 * development, and it is right to: a message that says only what failed is an
 * apology. So the fix travels with the error rather than being guessed at by
 * the component that renders it — the server is the only thing that knows
 * which of the three refusals happened.
 */
export interface Refusal {
  ok: false;
  error: string;
  fix: string;
}

export type CredentialSignResult = { ok: true; path: string; url: string } | Refusal;

export async function signCredentialUpload(formData: FormData): Promise<CredentialSignResult> {
  const seat = await requireSellerSeat();

  const filename = String(formData.get("filename") ?? "credential.pdf");
  const type = String(formData.get("type") ?? "");
  const bytes = Number(formData.get("bytes") ?? 0);

  const accepted = checkDocument(type, bytes);
  if (!accepted.ok) {
    return {
      ok: false,
      error: accepted.reason,
      fix: t("credentials.error.file_fix", {
        mb: formatCount(Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024))),
      }),
    };
  }

  // Built from the seat's own businessId, never from the form.
  const path = documentPath(seat.businessId, "certificate", filename);

  try {
    const signed = await signUpload(DOCUMENT_BUCKET, path);
    return { ok: true, path: signed.path, url: signed.url };
  } catch {
    return {
      ok: false,
      error: t("media.storage_off"),
      fix: t("credentials.error.storage_fix"),
    };
  }
}

export type AddCredentialResult = { ok: true; registerNote: RegisterNote | null } | Refusal;

/**
 * One credential, and its certificate where the seller had one to hand.
 *
 * The file becomes a private `Document` in the same bucket
 * `/dashboard/verification` writes to, because it is the same kind of object
 * and a second store for it would be a second place to get privacy wrong. It
 * lands with `isPublic` false, which is the column's default and board 3e's
 * rule: *a document becomes public because somebody said so.* B10 and AC9 are
 * that default plus `publicCredentialsFor`, which never selects the path.
 */
export async function addCredentialAction(formData: FormData): Promise<AddCredentialResult> {
  const seat = await requireSellerSeat();

  const kind = String(formData.get("kind") ?? "");
  if (!isCredentialKind(kind)) {
    return {
      ok: false,
      error: t("credentials.error.kind"),
      fix: t("credentials.error.kind_fix"),
    };
  }

  /*
     The document row is written first and deleted again if the credential
     write fails, so a failed save cannot leave an orphaned private file
     nothing points at. The reverse order would leave a credential claiming a
     certificate that does not exist.
  */
  let documentId: string | null = null;
  const path = String(formData.get("path") ?? "").trim();
  if (path !== "") {
    if (!path.startsWith(`${seat.businessId}/`)) {
      return {
        ok: false,
        error: t("media.storage_off"),
        fix: t("credentials.error.storage_fix"),
      };
    }
    const mimeType = String(formData.get("type") ?? "");
    const created = await prisma.document.create({
      data: {
        businessId: seat.businessId,
        kind: "certificate",
        storagePath: path,
        filename: String(formData.get("filename") ?? "credential"),
        bytes: Number(formData.get("bytes") ?? 0) || null,
        mimeType: (DOCUMENT_TYPES as readonly string[]).includes(mimeType) ? mimeType : null,
      },
      select: { id: true },
    });
    documentId = created.id;
  }

  const saved = await addCredential(seat.actor, seat.businessId, {
    kind,
    identifier: String(formData.get("identifier") ?? ""),
    issuer: String(formData.get("issuer") ?? ""),
    expiresOn: String(formData.get("expiresOn") ?? ""),
    documentId,
  });

  if (!saved.ok) {
    if (documentId !== null) {
      await prisma.document.delete({ where: { id: documentId } }).catch(() => undefined);
      await removeObject(DOCUMENT_BUCKET, path).catch(() => undefined);
    }
    return {
      ok: false,
      error: t("credentials.error.kind"),
      fix: t("credentials.error.kind_fix"),
    };
  }

  revalidatePath("/dashboard/setup/credentials");
  revalidatePath("/dashboard/setup");
  return { ok: true, registerNote: saved.registerNote };
}

export type RemoveCredentialResult = { ok: true } | Refusal;

/**
 * Remove one, and the certificate with it.
 *
 * Unlike `/dashboard/verification`, nothing here is undeletable: the one
 * document that screen refuses to remove is the trade licence a tier rests on,
 * and the trade licence is not a credential row at all. A claim the seller
 * withdraws is theirs to withdraw.
 */
export async function removeCredentialAction(
  formData: FormData,
): Promise<RemoveCredentialResult> {
  const seat = await requireSellerSeat();
  const id = String(formData.get("id") ?? "");

  const row = await prisma.credential.findFirst({
    where: { id, businessId: seat.businessId },
    select: { id: true, document: { select: { id: true, storagePath: true } } },
  });
  const missing: Refusal = {
    ok: false,
    error: t("credentials.error.gone"),
    fix: t("credentials.error.gone_fix"),
  };
  if (!row) return missing;

  const gone = await removeCredential(seat.actor, seat.businessId, row.id);
  if (!gone.ok) return missing;

  if (row.document) {
    await prisma.document.delete({ where: { id: row.document.id } }).catch(() => undefined);
    await removeObject(DOCUMENT_BUCKET, row.document.storagePath).catch(() => undefined);
  }

  revalidatePath("/dashboard/setup/credentials");
  revalidatePath("/dashboard/setup");
  return { ok: true };
}
