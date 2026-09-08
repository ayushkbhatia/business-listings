"use server";

import { revalidatePath } from "next/cache";
import { assertCanReplyToReviews, assertCanRequestReviews, assertCanDisputeReviews } from "@/lib/auth/guards";
import { openDispute } from "@/lib/reviews/disputes";
import { liveRequestChannels, replyToReview, requestReview } from "@/lib/reviews/service";
import { REQUEST_WINDOW_DAYS } from "@/lib/reviews/eligibility";
import { t } from "@/lib/i18n";
import { getSellerSeat } from "../_shell";

/**
 * The three things a seller may do about a review: reply once, ask once, and
 * dispute on one of four grounds.
 *
 * Removing one is not here and never will be — a review a supplier can delete
 * is a review nobody believes.
 *
 * ## Each action asks for the capability it actually needs
 *
 * All three used to assert `listing.edit`, which is the capability for editing
 * the listing profile. That was wrong in both directions against board 7d:
 * a **sales** seat holds "Request reviews from buyers" in the matrix and
 * `listing.edit` refused it, and board 11c's `Q4` holds a dispute one rung
 * above a reply, which one capability cannot express at all. Three rows in the
 * matrix, three guards.
 */
export type ReviewActionResult = { ok: true } | { ok: false; error: string };

export async function postReply(formData: FormData): Promise<ReviewActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };
  assertCanReplyToReviews(seat.actor);

  const result = await replyToReview({
    businessId: seat.businessId,
    reviewId: String(formData.get("reviewId") ?? ""),
    body: String(formData.get("body") ?? ""),
  });

  if (!result.ok) {
    return {
      ok: false,
      error: t(`reviews.reply_error.${result.error}` as "reviews.reply_error.already_replied"),
    };
  }

  revalidatePath("/dashboard/reviews");
  return { ok: true };
}

export type RequestResult =
  | { ok: true; sent: number; failed: number }
  | { ok: false; error: string };

/**
 * Ask the buyers the seller ticked. Criterion 1 and criterion 2.
 *
 * **The count follows the selection**, and the way it does that is that there
 * is no other number: this reads the ticked boxes and asks exactly those. The
 * board's `Send 8 requests` over two ticked buyers could only happen because
 * the button's number came from somewhere other than the selection.
 *
 * **One request per buyer, ever, enforced server-side** (criterion 2). Not by
 * the panel hiding a chip: `requestReview` re-reads `ReviewRequest` and the
 * unique index on `(businessId, buyerId)` is under that. A seller who reloads
 * an old tab and submits the same buyer twice gets one request and one refusal.
 *
 * Each send is independent. Two buyers where one is unreachable is one request
 * sent and one refused, reported as both — a single failure rolling back the
 * batch would waste the ones that worked, and there is nothing transactional
 * about asking two different people for two different things.
 */
export async function sendRequests(formData: FormData): Promise<RequestResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };
  assertCanRequestReviews(seat.actor);

  const enquiryIds = formData
    .getAll("enquiryId")
    .map((value) => String(value))
    .filter(Boolean);
  if (enquiryIds.length === 0) return { ok: false, error: t("reviews.request_none_selected") };

  // One read of the template table for the whole batch rather than one per buyer.
  const channels = await liveRequestChannels();

  let sent = 0;
  let failed = 0;
  let firstError: string | null = null;

  for (const enquiryId of enquiryIds) {
    const result = await requestReview({ businessId: seat.businessId, enquiryId, channels });
    if (result.ok) {
      sent += 1;
      continue;
    }
    failed += 1;
    firstError ??=
      result.error === "too_old"
        ? t("reviews.request_error.too_old", { days: REQUEST_WINDOW_DAYS })
        : t(`reviews.request_error.${result.error}` as "reviews.request_error.already_asked");
  }

  revalidatePath("/dashboard/reviews");
  // Every one refused and nothing sent is a failure with a reason, not a
  // "0 sent" success a seller has to work out for themselves.
  if (sent === 0 && firstError !== null) return { ok: false, error: firstError };
  return { ok: true, sent, failed };
}

/**
 * Raise a dispute, from a specific review. Criterion 7.
 *
 * `reviewId` is required and there is no path here that does not carry one —
 * the rail on the page has no form on it at all, which is the fix for the board
 * having drawn a pre-selected radio for a dispute nobody had started.
 */
export async function raiseDispute(formData: FormData): Promise<ReviewActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };
  assertCanDisputeReviews(seat.actor);

  const result = await openDispute({
    businessId: seat.businessId,
    raisedById: seat.actor.id,
    reviewId: String(formData.get("reviewId") ?? ""),
    ground: String(formData.get("ground") ?? ""),
    detail: String(formData.get("detail") ?? ""),
  });

  if (!result.ok) {
    return {
      ok: false,
      error: t(`reviews.dispute.error.${result.error}` as "reviews.dispute.error.not_found"),
    };
  }

  revalidatePath("/dashboard/reviews");
  return { ok: true };
}
