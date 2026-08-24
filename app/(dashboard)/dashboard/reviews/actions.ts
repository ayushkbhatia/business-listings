"use server";

import { revalidatePath } from "next/cache";
import { assertCan } from "@/lib/auth/can";
import { replyToReview, requestReview } from "@/lib/reviews/service";
import { REQUEST_WINDOW_DAYS } from "@/lib/reviews/eligibility";
import { t } from "@/lib/i18n";
import { getSellerSeat } from "../_shell";

/**
 * The two things a seller may do about a review: reply once, and ask once.
 *
 * Removing one is not here and never will be — a review a supplier can delete
 * is a review nobody believes. Reporting one goes to a person.
 */
export type ReviewActionResult = { ok: true } | { ok: false; error: string };

export async function postReply(formData: FormData): Promise<ReviewActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };
  assertCan(seat.actor, "listing.edit");

  const result = await replyToReview({
    businessId: seat.businessId,
    reviewId: String(formData.get("reviewId") ?? ""),
    body: String(formData.get("body") ?? ""),
  });

  if (!result.ok) {
    return {
      ok: false,
      error:
        result.error === "already_replied"
          ? t("reviews.reply_once")
          : result.error === "removed"
            ? t("reviews.removed")
            : t("dev.no_seat_title"),
    };
  }

  revalidatePath("/dashboard/reviews");
  return { ok: true };
}

export async function askForReview(formData: FormData): Promise<ReviewActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };
  assertCan(seat.actor, "listing.edit");

  const result = await requestReview({
    businessId: seat.businessId,
    enquiryId: String(formData.get("enquiryId") ?? ""),
  });

  if (!result.ok) {
    return {
      ok: false,
      error:
        result.error === "too_old"
          ? t("reviews.request_error.too_old", { days: REQUEST_WINDOW_DAYS })
          : t(`reviews.request_error.${result.error}` as "reviews.request_error.already_asked"),
    };
  }

  revalidatePath("/dashboard/reviews");
  return { ok: true };
}
