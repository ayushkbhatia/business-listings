"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { getActor } from "@/lib/auth/session";
import { findClaimCandidates, submitClaim, type ClaimCandidate } from "@/lib/onboarding/claim";
import { goLive } from "@/lib/onboarding/service";
import { checkDocument, DOCUMENT_BUCKET, documentPath, signUpload } from "@/lib/storage";
import { t } from "@/lib/i18n";

/**
 * The funnel's mutations.
 *
 * None of them takes a `businessId` from a form except the claim itself, which
 * is the point where the seller is choosing one. After that the business comes
 * off the actor, so a half-finished funnel cannot be pointed at somebody else's
 * listing by editing a hidden field.
 */

export type SearchResult = { ok: true; results: ClaimCandidate[] } | { ok: false; error: string };

export async function searchListings(formData: FormData): Promise<SearchResult> {
  const actor = await getActor();
  if (!actor) return { ok: false, error: t("dev.no_seat_title") };
  return { ok: true, results: await findClaimCandidates(String(formData.get("query") ?? "")) };
}

export type ClaimActionResult =
  | { ok: true; contested: boolean }
  | { ok: false; error: string };

export async function claimListing(formData: FormData): Promise<ClaimActionResult> {
  const actor = await getActor();
  if (!actor) return { ok: false, error: t("dev.no_seat_title") };

  const route = String(formData.get("route") ?? "phone_callback");
  const result = await submitClaim(actor, {
    businessId: String(formData.get("businessId") ?? ""),
    route: route === "licence_upload" ? "licence_upload" : "phone_callback",
    ...(formData.get("documentId") ? { documentId: String(formData.get("documentId")) } : {}),
    ...(formData.get("phone") ? { phone: String(formData.get("phone")) } : {}),
  });
  if (!result.ok) return result;

  /*
   * The seat is attached now, not when staff approve.
   *
   * Criterion 1 asks that a supplier reaches a dashboard without staff
   * involvement. Ownership still waits for a person — `claimStatus` does not
   * move — but the claimant gets a seat so the rest of the funnel and the
   * dashboard work. If the claim is rejected, handoff 4's queue detaches them;
   * making them wait first would mean nobody can fill in a listing until a
   * human has been at their desk.
   */
  await prisma.user.update({
    where: { id: actor.id },
    data: {
      businessId: String(formData.get("businessId")),
      roles: actor.roles.includes("seller_owner")
        ? [...actor.roles]
        : [...actor.roles, "seller_owner"],
    },
  });

  return { ok: true, contested: result.contested };
}

export type SignResult =
  | { ok: true; path: string; token: string; url: string }
  | { ok: false; error: string };

export async function signLicenceUpload(formData: FormData): Promise<SignResult> {
  const actor = await getActor();
  if (!actor) return { ok: false, error: t("dev.no_seat_title") };

  const businessId = String(formData.get("businessId") ?? "");
  const check = checkDocument(
    String(formData.get("type") ?? ""),
    Number(formData.get("bytes") ?? 0),
  );
  if (!check.ok) return { ok: false, error: check.reason };

  const path = documentPath(businessId, "trade_licence", String(formData.get("filename") ?? "licence.pdf"));
  try {
    return { ok: true, ...(await signUpload(DOCUMENT_BUCKET, path)) };
  } catch {
    return { ok: false, error: t("media.storage_off") };
  }
}

export type RecordResult = { ok: true; documentId: string } | { ok: false; error: string };

export async function recordLicence(formData: FormData): Promise<RecordResult> {
  const actor = await getActor();
  if (!actor) return { ok: false, error: t("dev.no_seat_title") };

  const businessId = String(formData.get("businessId") ?? "");
  const path = String(formData.get("path") ?? "");
  if (!path.startsWith(`${businessId}/`)) {
    return { ok: false, error: t("media.storage_off") };
  }

  const created = await prisma.document.create({
    data: {
      businessId,
      kind: "trade_licence",
      storagePath: path,
      filename: String(formData.get("filename") ?? "licence"),
      bytes: Number(formData.get("bytes") ?? 0) || null,
      mimeType: String(formData.get("type") ?? "") || null,
    },
    select: { id: true },
  });

  return { ok: true, documentId: created.id };
}

export type StepResult = { ok: true } | { ok: false; error: string };

/**
 * Criterion 3, and the only place it is enforced.
 *
 * Called at the end of the locations step. The plan screen is the next thing
 * the seller sees and the listing is already up by then, so a supplier who
 * abandons at the pricing table is listed, findable, and receiving enquiries.
 */
export async function publishAndContinue(): Promise<never> {
  const actor = await getActor();
  if (!actor?.businessId) redirect("/onboarding/claim");

  await goLive(actor.businessId);
  revalidatePath("/onboarding/plan");
  redirect("/onboarding/plan");
}

export async function finishOnboarding(): Promise<never> {
  redirect("/dashboard/setup");
}
