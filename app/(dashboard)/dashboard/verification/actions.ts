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
import { isCheckedByUs, isCredential, isPublishable } from "@/lib/verification/credentials";
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

  const kind = ((KINDS as readonly string[]).includes(String(formData.get("kind") ?? ""))
    ? String(formData.get("kind"))
    : "certificate") as (typeof KINDS)[number];

  /*
     The three fields the `Uploaded by you` table has columns for.

     `displayName` is what a buyer would call it — "ISO 9001:2015", not
     "scan_0043_final.pdf" — and it is also what
     `document_public_has_a_name` requires before the row can be published, so
     it is asked for at upload rather than discovered at the moment the seller
     tries to publish. `reference` and `validUntil` fill the NUMBER and EXPIRES
     columns, which had nothing writing them.

     None of the three apply to a trade licence or a VAT certificate: those two
     read their number and expiry off the licence record, which is
     licence-locked and not the seller's to type.
  */
  const credential = isCredential(kind);
  const displayName = String(formData.get("displayName") ?? "").trim();
  const reference = String(formData.get("reference") ?? "").trim();
  const validUntil = String(formData.get("validUntil") ?? "").trim();

  if (credential && !displayName) {
    return { ok: false, error: t("verify_listing.name_required") };
  }

  const created = await prisma.document.create({
    data: {
      businessId: seat.businessId,
      kind,
      storagePath: path,
      filename: String(formData.get("filename") ?? "document"),
      bytes: Number(formData.get("bytes") ?? 0) || null,
      mimeType: String(formData.get("type") ?? "") || null,
      ...(credential
        ? {
            displayName,
            reference: reference || null,
            validUntil: validUntil ? new Date(`${validUntil}T00:00:00+04:00`) : null,
          }
        : {}),
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
    select: {
      id: true,
      kind: true,
      businessId: true,
      storagePath: true,
      business: { select: { verifiedAt: true } },
    },
  });
  if (!document || document.businessId !== seat.businessId) {
    return { ok: false, error: t("product.not_found") };
  }

  /*
     The document behind the tier is not the seller's to remove.

     A trade licence or VAT certificate we have already checked is the evidence
     the badge rests on; deleting it would leave a tier 2 listing with nothing
     recording why. Refused here rather than only hidden in the UI, because a
     button that is not drawn is not a fence — board 3i made the same
     correction about a refused delete, and the message says what to do instead
     rather than only saying no.
  */
  if (isCheckedByUs(document.kind) && document.business?.verifiedAt) {
    return { ok: false, error: t("verify_listing.cannot_delete") };
  }

  await prisma.document.delete({ where: { id: document.id } });
  await removeObject(DOCUMENT_BUCKET, document.storagePath).catch(() => undefined);

  revalidatePath("/dashboard/verification");
  return { ok: true };
}

export type VisibilityResult = { ok: true; isPublic: boolean } | { ok: false; error: string };

/**
 * Public or hidden — the seller's own choice, and only for their own uploads.
 *
 * Board 3e's fourth correction: visibility was three values with no owner.
 * `Badge only` belongs to the licence and the TRN and is not a preference,
 * because the badge is what the platform says about a business rather than what
 * the business says about itself. What a seller does control is whether a
 * certificate they uploaded is named on their storefront.
 *
 * Turning it on does not publish it. `Document.reviewedAt` is the other half of
 * the storefront query, so a credential goes to `In review · 2 working days`
 * and reaches the shop window when somebody has looked. Turning it back off
 * clears the review, because the queue holds things a seller has asked for and
 * this is them withdrawing the ask.
 *
 * Never the tier, and there is no branch here that could reach it.
 */
export async function setVisibility(formData: FormData): Promise<VisibilityResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };
  assertCanEditListing(seat.actor);

  const document = await prisma.document.findUnique({
    where: { id: String(formData.get("id") ?? "") },
    select: { id: true, kind: true, businessId: true, isPublic: true, displayName: true },
  });
  if (!document || document.businessId !== seat.businessId) {
    return { ok: false, error: t("product.not_found") };
  }

  /*
     A trade licence has no public form to choose between. The storefront query
     fences it out by kind, so allowing the flag would set a column that decides
     nothing and read, on this screen, as a choice the seller had made.
  */
  if (!isPublishable(document.kind)) {
    return { ok: false, error: t("verify_listing.who_badge_only") };
  }

  const next = String(formData.get("public") ?? "") === "true";

  /*
     `document_public_has_a_name` refuses a public row with no display name, and
     it is right to: the storefront lists the name and the month, so a
     certificate published as `scan_0043_final.pdf` would be a public page
     naming a file. Caught here so the seller reads a sentence about what to do
     rather than a constraint violation.
  */
  if (next && !document.displayName) {
    return { ok: false, error: t("verify_listing.name_required") };
  }

  await prisma.document.update({
    where: { id: document.id },
    data: {
      isPublic: next,
      // Asking again is a fresh ask. Withdrawing it takes the row out of the
      // queue rather than leaving a decision pending on something nobody wants
      // published any more.
      ...(next ? { reviewedAt: null, reviewReason: null } : {}),
    },
  });

  revalidatePath("/dashboard/verification");
  revalidatePath(`/b/${seat.businessId}`);
  return { ok: true, isPublic: next };
}
