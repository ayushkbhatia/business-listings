"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/session";
import { checkThrottle, recordAttempt } from "@/lib/auth/attempts";
import { submitClaim, type ClaimantRole } from "@/lib/onboarding/claim";
import { clearDraft, readDraft, saveDraft, type VerifyDraft } from "@/lib/onboarding/draft";
import { goLive } from "@/lib/onboarding/service";
import { isClaimantRole, scanLicenceDocument, type LicenceScan } from "@/lib/onboarding/verify";
import { normaliseLicenceNumber } from "@/lib/verification/licence/number";
import {
  checkDocument,
  DOCUMENT_BUCKET,
  documentPath,
  MAX_LICENCE_BYTES,
  signUpload,
} from "@/lib/storage";
import { siteUrl } from "@/lib/site";
import { t } from "@/lib/i18n";

/**
 * The funnel's mutations.
 *
 * None of them takes a `businessId` from a form except the claim itself, which
 * is the point where the seller is choosing one. After that the business comes
 * off the actor, so a half-finished funnel cannot be pointed at somebody else's
 * listing by editing a hidden field.
 */

export type ClaimActionResult =
  | { ok: true; contested: boolean }
  | { ok: false; error: string };

/**
 * Board 2b's submit.
 *
 * Queues a review and grants nothing. `verificationTier` is not touched here and
 * has no path from this file — criterion 6, and CLAUDE.md's second
 * non-negotiable underneath it. What the claimant gets immediately is a seat, so
 * the rest of the funnel and the dashboard work; what waits for a person is the
 * ownership, and it should.
 */
export async function claimListing(formData: FormData): Promise<ClaimActionResult> {
  const actor = await getActor();
  if (!actor) return { ok: false, error: t("dev.no_seat_title") };

  const businessId = String(formData.get("businessId") ?? "");
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { licenceAuthority: true },
  });
  if (!business) return { ok: false, error: t("verify.gone") };

  const route = String(formData.get("route") ?? "phone_callback");
  const role = String(formData.get("claimantRole") ?? "");

  /*
     The licence number is normalised against the authority on the record, not
     stored as typed. A claimant who wrote the digits alone and one who wrote the
     full `DED-618402` submitted the same licence, and a reviewer should not have
     to notice that. A prefix naming a *different* authority is refused here
     rather than rewritten — see lib/verification/licence/number.ts.
  */
  const typedNumber = String(formData.get("licenceNumber") ?? "").trim();
  let statedNumber: string | undefined;
  if (typedNumber) {
    const normalised = normaliseLicenceNumber(typedNumber, business.licenceAuthority);
    if (!normalised.ok) {
      return {
        ok: false,
        error:
          normalised.reason === "wrong_authority"
            ? t("verify.error.wrong_authority", {
                found: normalised.found ?? "",
                expected: business.licenceAuthority,
              })
            : t("verify.error.licence_number", { authority: business.licenceAuthority }),
      };
    }
    statedNumber = normalised.value;
  }

  const result = await submitClaim(actor, {
    businessId,
    route: route === "licence_upload" ? "licence_upload" : "phone_callback",
    ...(formData.get("documentId") ? { documentId: String(formData.get("documentId")) } : {}),
    ...(formData.get("phone") ? { phone: String(formData.get("phone")) } : {}),
    ...(formData.get("claimantName") ? { claimantName: String(formData.get("claimantName")) } : {}),
    ...(isClaimantRole(role) ? { claimantRole: role as ClaimantRole } : {}),
    ...(statedNumber ? { statedLicenceNumber: statedNumber } : {}),
    ...dateField(formData, "licenceExpiry", "statedLicenceExpiry"),
    ...(formData.get("ocrLicenceNumber")
      ? { ocrLicenceNumber: String(formData.get("ocrLicenceNumber")) }
      : {}),
    ...dateField(formData, "ocrLicenceExpiry", "ocrLicenceExpiry"),
    ...(formData.get("ocrConfidence")
      ? { ocrConfidence: Number(formData.get("ocrConfidence")) }
      : {}),
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
      businessId,
      roles: actor.roles.includes("seller_owner")
        ? [...actor.roles]
        : [...actor.roles, "seller_owner"],
    },
  });

  // The step has produced its row, so the half-finished copy of it goes. A
  // draft that outlived its submission repopulates a form the supplier has
  // already finished with, which reads as the submission having failed.
  await clearDraft(actor.id, businessId, "verify");
  revalidatePath("/onboarding/verify");

  return { ok: true, contested: result.contested };
}

/** `dd/mm/yyyy` arrives from a date input as `yyyy-mm-dd`, or not at all. */
function dateField(
  formData: FormData,
  from: string,
  to: "statedLicenceExpiry" | "ocrLicenceExpiry",
): Record<string, Date> {
  const raw = String(formData.get(from) ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return {};
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? {} : { [to]: parsed };
}

export type ScanResult = { ok: true; scan: LicenceScan } | { ok: false; error: string };

/**
 * Read an uploaded licence. Board 2b's OCR step.
 *
 * Never fails the upload. Every path that cannot read the document returns an
 * empty scan, which is the screen's designed "we couldn't read this" state
 * rather than an error over a file the claimant has already uploaded.
 */
export async function scanLicence(formData: FormData): Promise<ScanResult> {
  const actor = await getActor();
  if (!actor) return { ok: false, error: t("dev.no_seat_title") };

  const documentId = String(formData.get("documentId") ?? "");
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      storagePath: true,
      mimeType: true,
      business: { select: { licenceAuthority: true } },
    },
  });
  if (!document?.business) return { ok: false, error: t("verify.gone") };

  return {
    ok: true,
    scan: await scanLicenceDocument({
      storagePath: document.storagePath,
      mimeType: document.mimeType,
      authority: document.business.licenceAuthority,
    }),
  };
}

export type SaveExitResult =
  | { ok: true; emailed: boolean; masked: string | null }
  | { ok: false; error: string };

/**
 * Save & exit. Criterion 10.
 *
 * Two halves, and the first is the one that matters. The draft is written
 * whatever happens to the email — losing what somebody typed because a mail
 * provider was down would be the failure this feature exists to prevent.
 *
 * The link is Supabase's own sign-in link with a `next` back to this step,
 * rather than a new notification event and template. It is the path that already
 * works, it puts a session on the far side of the click, and `emailed: false`
 * says plainly when there was no address to send to instead of implying a
 * message is on its way.
 */
export async function saveAndExit(formData: FormData): Promise<SaveExitResult> {
  const actor = await getActor();
  if (!actor) return { ok: false, error: t("dev.no_seat_title") };

  const businessId = String(formData.get("businessId") ?? "");
  if (!businessId) return { ok: false, error: t("verify.gone") };

  const draft: VerifyDraft = {};
  for (const key of [
    "route",
    "documentId",
    "filename",
    "licenceNumber",
    "licenceExpiry",
    "claimantName",
    "claimantRole",
  ] as const) {
    const value = String(formData.get(key) ?? "").trim();
    if (value) draft[key] = value as never;
  }
  await saveDraft(actor.id, businessId, "verify", draft);

  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { email: true },
  });
  if (!user?.email) return { ok: true, emailed: false, masked: null };

  /*
     Our own throttle before Supabase's, and for the reason `lib/auth/throttle.ts`
     gives: Supabase enforces a limit and does not expose the counter, so
     "we could not send another one yet" cannot be a designed state without our
     own record. `otp_request` is the right bucket — this sends the same kind of
     message through the same provider, and a supplier alternating between Save &
     exit and signing in should share one allowance rather than have two.
  */
  const gate = await checkThrottle(user.email, "otp_request");
  if (!gate.allowed) {
    return { ok: true, emailed: false, masked: maskEmail(user.email) };
  }

  const next = encodeURIComponent(`/onboarding/verify?business=${businessId}`);
  let delivered = false;
  try {
    const supabase = await createClient();
    /*
       `signInWithOtp` reports a refusal in `error` rather than throwing, so a
       rate-limited or misconfigured send would otherwise be reported as
       "we have emailed you" — a promise about a message that does not exist.
    */
    const { error } = await supabase.auth.signInWithOtp({
      email: user.email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${siteUrl()}/auth/callback?next=${next}`,
      },
    });
    delivered = !error;
    if (error) console.warn("[onboarding] the resume link was refused", error.message);
  } catch (error) {
    // The draft is already saved, which is the half that matters. Telling
    // somebody an email is coming when it is not would be worse than this.
    console.warn("[onboarding] could not send a resume link", error);
  }

  await recordAttempt({ identifier: user.email, kind: "otp_request", succeeded: delivered });

  return { ok: true, emailed: delivered, masked: maskEmail(user.email) };
}

/** `s••••h@gmail.com`. Enough to recognise, not enough to read out. */
function maskEmail(email: string): string {
  const [name = "", domain = ""] = email.split("@");
  const shown = name.length <= 2 ? name : `${name[0]}${"•".repeat(Math.min(4, name.length - 2))}${name.at(-1)}`;
  return `${shown}@${domain}`;
}

/** What the claimant had typed when they last left. */
export async function loadVerifyDraft(businessId: string): Promise<Partial<VerifyDraft>> {
  const actor = await getActor();
  if (!actor) return {};
  return readDraft<Record<string, unknown>>(actor.id, businessId, "verify") as Promise<
    Partial<VerifyDraft>
  >;
}

export type SignResult =
  | { ok: true; path: string; token: string; url: string }
  | { ok: false; error: string };

export async function signLicenceUpload(formData: FormData): Promise<SignResult> {
  const actor = await getActor();
  if (!actor) return { ok: false, error: t("dev.no_seat_title") };

  const businessId = String(formData.get("businessId") ?? "");
  // Board 2b's own ceiling, not the platform's: the screen says 10 MB, so 10 MB
  // is what the server refuses above. A limit stated on a screen and not
  // enforced behind it is decoration.
  const check = checkDocument(
    String(formData.get("type") ?? ""),
    Number(formData.get("bytes") ?? 0),
    MAX_LICENCE_BYTES,
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
