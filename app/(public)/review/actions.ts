"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { t } from "@/lib/i18n";
import {
  contactDetailsIn,
  graphemeCount,
  isReviewPhotoPath,
  REVIEW_BODY_MAX,
  REVIEW_BODY_MIN,
  reviewPhotoPath,
  type ReviewFields,
  type ReviewPhotoRef,
} from "@/lib/reviews/write";
import { cleanReviewPhoto, reviewPhotoStorage, type PhotoRefusal } from "@/lib/reviews/photos";
import { createReview, editReview, saveReviewDraft, writableSubject } from "@/lib/reviews/service";
import { contactKindWords, listingReviewHref, reviewHref } from "@/lib/reviews/write-view";
import { MAX_IMAGE_BYTES } from "@/lib/storage/buckets";
import { resolveBuyerId } from "@/app/(public)/enquiry/_buyer";

/**
 * Board 10f — the five things the review form sends.
 *
 * Thin: resolve who is asking, hand it to `lib/reviews`, turn a refusal into a
 * sentence. Every rule about who may write, what may be written and which
 * photographs may be attached lives in the service, where it is tested against a
 * real database — the page offering the form is not the thing that decides.
 */

export type ActionRefusal = { ok: false; error: string };

interface Target {
  enquiryId: string;
  /** The supplier the page resolved, where a fan-out drew several replies. Re-checked. */
  businessId: string | null;
  token: string | null;
}

/** Strings, not codes: the form shows them as they come. */
function refusalWords(code: string, fields?: ReviewFields): string {
  switch (code) {
    case "body_short":
      return t("reviewwrite.error.body_short", {
        min: REVIEW_BODY_MIN,
        count: fields ? graphemeCount(fields.body.trim()) : 0,
      });
    case "body_long":
      return t("reviewwrite.error.body_long", { max: REVIEW_BODY_MAX });
    case "contact_details":
      return t("reviewwrite.error.contact_details", {
        kinds: contactKindWords(fields ? contactDetailsIn(fields.body) : ["phone"]),
      });
    default:
      return t(`reviewwrite.error.${code}` as "reviewwrite.error.invalid_ratings");
  }
}

/** Fields as the browser sent them, narrowed. A server action's argument is untrusted input. */
function readFields(value: unknown): ReviewFields | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const score = (key: string) => {
    const n = raw[key];
    return n === null || n === undefined ? null : Number(n);
  };
  const photos = Array.isArray(raw.photos) ? raw.photos : [];
  return {
    overall: score("overall"),
    quotedAccurate: score("quotedAccurate"),
    onTime: score("onTime"),
    asDescribed: score("asDescribed"),
    responsiveness: score("responsiveness"),
    body: typeof raw.body === "string" ? raw.body : "",
    showCompanyName: raw.showCompanyName !== false,
    photos: photos.slice(0, 12).flatMap((item): ReviewPhotoRef[] => {
      if (!item || typeof item !== "object") return [];
      const photo = item as Record<string, unknown>;
      if (typeof photo.path !== "string") return [];
      const int = (n: unknown) => (Number.isInteger(n) ? (n as number) : null);
      return [{ path: photo.path, width: int(photo.width), height: int(photo.height), bytes: int(photo.bytes) }];
    }),
  };
}

export async function saveReviewDraftAction(
  target: Target,
  rawFields: unknown,
): Promise<{ ok: true; savedAt: string } | ActionRefusal> {
  const buyerId = await resolveBuyerId(target.token);
  const fields = readFields(rawFields);
  if (!buyerId || !fields) return { ok: false, error: t("reviewwrite.error.not_your_enquiry") };

  const result = await saveReviewDraft({
    buyerId,
    enquiryId: target.enquiryId,
    ...(target.businessId ? { businessId: target.businessId } : {}),
    fields,
  });
  if (!result.ok) return { ok: false, error: refusalWords(result.error, fields) };
  return { ok: true, savedAt: result.savedAt.toISOString() };
}

/** The accepted type and size after the browser's resize, before a signature is issued. */
const STORED_TYPES = ["image/webp", "image/jpeg", "image/png"];

export async function signReviewPhotoAction(
  target: Target,
  file: { filename: string; type: string; bytes: number },
): Promise<{ ok: true; url: string; path: string } | ActionRefusal> {
  const buyerId = await resolveBuyerId(target.token);
  if (!buyerId) return { ok: false, error: t("reviewwrite.error.not_your_enquiry") };
  if (!STORED_TYPES.includes(file.type)) return { ok: false, error: t("reviewwrite.photo.error.type") };
  if (!Number.isFinite(file.bytes) || file.bytes <= 0 || file.bytes > MAX_IMAGE_BYTES) {
    return { ok: false, error: t("reviewwrite.photo.error.stored_size") };
  }

  const subject = await writableSubject(buyerId, target.enquiryId, target.businessId ?? undefined);
  if (!subject.ok) return { ok: false, error: refusalWords(subject.error) };

  const path = reviewPhotoPath(subject.businessId, target.enquiryId, String(file.filename || "photo"));
  try {
    const signed = await reviewPhotoStorage.sign(path);
    return { ok: true, url: signed.url, path: signed.path };
  } catch {
    return { ok: false, error: t("reviewwrite.photo.error.upload") };
  }
}

const PHOTO_REFUSAL: Record<PhotoRefusal, string> = {
  missing: "reviewwrite.photo.error.upload",
  type: "reviewwrite.photo.error.type",
  size: "reviewwrite.photo.error.stored_size",
  too_small: "reviewwrite.photo.error.too_small_stored",
  storage: "reviewwrite.photo.error.upload",
};

/**
 * After the browser's upload: read it back, strip it, and hand the form a clean
 * reference. Only a path this enquiry's signature produced is accepted.
 */
export async function addReviewPhotoAction(
  target: Target,
  path: string,
): Promise<{ ok: true; photo: ReviewPhotoRef; url: string } | ActionRefusal> {
  const buyerId = await resolveBuyerId(target.token);
  if (!buyerId) return { ok: false, error: t("reviewwrite.error.not_your_enquiry") };
  const subject = await writableSubject(buyerId, target.enquiryId, target.businessId ?? undefined);
  if (!subject.ok) return { ok: false, error: refusalWords(subject.error) };

  if (!isReviewPhotoPath(subject.businessId, target.enquiryId, path)) {
    return { ok: false, error: t("reviewwrite.photo.error.upload") };
  }
  const cleaned = await cleanReviewPhoto(reviewPhotoStorage, path);
  if (!cleaned.ok) return { ok: false, error: t(PHOTO_REFUSAL[cleaned.error] as "reviewwrite.photo.error.upload") };
  return { ok: true, photo: cleaned.photo, url: reviewPhotoStorage.url(path) };
}

async function landing(
  businessId: string,
  reviewId: string,
  enquiryId: string,
  token: string | null,
  flash: "posted" | "saved",
): Promise<string> {
  const [business, enquiry] = await Promise.all([
    prisma.business.findUnique({
      where: { id: businessId },
      select: { slug: true, publishedAt: true, suspendedAt: true, claimStatus: true },
    }),
    prisma.enquiry.findUnique({ where: { id: enquiryId }, select: { ref: true } }),
  ]);
  if (business) {
    revalidatePath(`/b/${business.slug}/reviews`);
    revalidatePath(`/b/${business.slug}`);
  }
  revalidatePath("/dashboard/reviews");
  if (enquiry) revalidatePath(`/enquiry/${enquiry.ref}/accepted`);

  /*
     `B10`: the buyer sees the thing they made, on the page that will carry it —
     anchored, not the inbox. Where that page does not exist (the listing is not
     published) they stay on their own copy with the reason said.
  */
  if (business && business.publishedAt && !business.suspendedAt && business.claimStatus !== "unclaimed") {
    return listingReviewHref(business.slug, reviewId);
  }
  return reviewHref(enquiry?.ref ?? enquiryId, token, { [flash]: "1" });
}

export async function postReviewAction(target: Target, rawFields: unknown): Promise<ActionRefusal> {
  const buyerId = await resolveBuyerId(target.token);
  const fields = readFields(rawFields);
  if (!buyerId || !fields) return { ok: false, error: t("reviewwrite.error.not_your_enquiry") };

  const result = await createReview({
    buyerId,
    enquiryId: target.enquiryId,
    ...(target.businessId ? { businessId: target.businessId } : {}),
    ratings: {
      overall: fields.overall ?? 0,
      quotedAccurate: fields.quotedAccurate,
      onTime: fields.onTime,
      asDescribed: fields.asDescribed,
      responsiveness: fields.responsiveness,
    },
    body: fields.body,
    showCompanyName: fields.showCompanyName,
    photos: fields.photos,
  });
  if (!result.ok) return { ok: false, error: refusalWords(result.error, fields) };

  redirect(await landing(result.businessId, result.reviewId, target.enquiryId, target.token, "posted"));
}

export async function editReviewAction(
  target: Target & { reviewId: string },
  rawFields: unknown,
): Promise<ActionRefusal> {
  const buyerId = await resolveBuyerId(target.token);
  const fields = readFields(rawFields);
  if (!buyerId || !fields) return { ok: false, error: t("reviewwrite.error.not_your_enquiry") };

  const result = await editReview({
    buyerId,
    reviewId: target.reviewId,
    ratings: {
      overall: fields.overall ?? 0,
      quotedAccurate: fields.quotedAccurate,
      onTime: fields.onTime,
      asDescribed: fields.asDescribed,
      responsiveness: fields.responsiveness,
    },
    body: fields.body,
    showCompanyName: fields.showCompanyName,
    photos: fields.photos,
  });
  if (!result.ok) return { ok: false, error: refusalWords(result.error, fields) };

  redirect(await landing(result.businessId, target.reviewId, target.enquiryId, target.token, "saved"));
}
