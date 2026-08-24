import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { assertReason, staffMutation } from "@/lib/audit";
import type { Actor } from "@/lib/auth/roles";
import {
  canRequestReview,
  canReview,
  editableUntil,
  isEditable,
  isRemovalGround,
  ratingsAreValid,
  type Ratings,
  type RemovalGround,
} from "./eligibility";

/**
 * Writing, replying to and removing a review.
 *
 * The gate is the product: a rating nobody had to earn is a rating nobody
 * reads. So `createReview` re-checks eligibility against the database rather
 * than trusting the page that offered the form, and the unique index on
 * `Review.enquiryId` is the backstop under that.
 *
 * Removal is the one path in this file that is a staff action, and it goes
 * through `staffMutation` — role, written reason, audit row, in one
 * transaction. There is no other way to remove a review, and a seller cannot
 * remove one at all.
 */

export interface CreateReviewInput {
  buyerId: string;
  enquiryId: string;
  ratings: Ratings;
  body: string;
  showCompanyName?: boolean;
}

export type CreateReviewResult =
  | { ok: true; reviewId: string; businessId: string }
  | { ok: false; error: "not_your_enquiry" | "no_accepted_quote" | "already_reviewed" | "invalid_ratings" | "empty_body" };

const MIN_BODY = 20;

export async function createReview(input: CreateReviewInput): Promise<CreateReviewResult> {
  if (!ratingsAreValid(input.ratings)) return { ok: false, error: "invalid_ratings" };

  const body = input.body.trim();
  // A rating with no words is a number somebody clicked past. The floor is low
  // enough for "Quick, correct, fair price" and high enough to stop a full stop.
  if (body.length < MIN_BODY) return { ok: false, error: "empty_body" };

  const enquiry = await prisma.enquiry.findUnique({
    where: { id: input.enquiryId },
    select: {
      id: true,
      buyerId: true,
      contactReleasedToBusinessId: true,
      contactReleasedAt: true,
      review: { select: { id: true } },
    },
  });

  const verdict = canReview(input.buyerId, enquiry && {
    id: enquiry.id,
    buyerId: enquiry.buyerId,
    contactReleasedToBusinessId: enquiry.contactReleasedToBusinessId,
    contactReleasedAt: enquiry.contactReleasedAt,
    alreadyReviewed: enquiry.review !== null,
  });
  if (!verdict.ok) return { ok: false, error: verdict.reason };

  const now = new Date();
  const review = await prisma.review.create({
    data: {
      businessId: verdict.businessId,
      buyerId: input.buyerId,
      enquiryId: input.enquiryId,
      overall: input.ratings.overall,
      quotedAccurate: input.ratings.quotedAccurate,
      onTime: input.ratings.onTime,
      asDescribed: input.ratings.asDescribed,
      responsiveness: input.ratings.responsiveness,
      body,
      showCompanyName: input.showCompanyName ?? true,
      editableUntil: editableUntil(now),
    },
    select: { id: true, businessId: true },
  });

  return { ok: true, reviewId: review.id, businessId: review.businessId };
}

export type EditReviewResult = { ok: true } | { ok: false; error: "not_yours" | "window_closed" | "invalid_ratings" | "empty_body" };

/** Editable for fourteen days. After that it is the record. */
export async function editReview(input: {
  buyerId: string;
  reviewId: string;
  ratings: Ratings;
  body: string;
  now?: Date;
}): Promise<EditReviewResult> {
  if (!ratingsAreValid(input.ratings)) return { ok: false, error: "invalid_ratings" };
  const body = input.body.trim();
  if (body.length < MIN_BODY) return { ok: false, error: "empty_body" };

  const review = await prisma.review.findUnique({
    where: { id: input.reviewId },
    select: { buyerId: true, editableUntil: true, removedAt: true },
  });
  if (!review || review.buyerId !== input.buyerId) return { ok: false, error: "not_yours" };
  if (!isEditable(review, input.now ?? new Date())) return { ok: false, error: "window_closed" };

  await prisma.review.update({
    where: { id: input.reviewId },
    data: {
      overall: input.ratings.overall,
      quotedAccurate: input.ratings.quotedAccurate,
      onTime: input.ratings.onTime,
      asDescribed: input.ratings.asDescribed,
      responsiveness: input.ratings.responsiveness,
      body,
    },
  });
  return { ok: true };
}

export type ReplyResult = { ok: true } | { ok: false; error: "not_yours" | "already_replied" | "removed" | "empty" };

/**
 * The seller's one reply.
 *
 * Not editable after posting, and never deletable by the seller. A reply a
 * seller can rewrite after the fact is a reply a buyer cannot rely on, and the
 * whole exchange stops being evidence of anything.
 */
export async function replyToReview(input: {
  businessId: string;
  reviewId: string;
  body: string;
}): Promise<ReplyResult> {
  const body = input.body.trim();
  if (!body) return { ok: false, error: "empty" };

  const review = await prisma.review.findUnique({
    where: { id: input.reviewId },
    select: { businessId: true, sellerReply: true, removedAt: true },
  });
  if (!review || review.businessId !== input.businessId) return { ok: false, error: "not_yours" };
  if (review.removedAt) return { ok: false, error: "removed" };
  if (review.sellerReply) return { ok: false, error: "already_replied" };

  // Guarded again in the where clause: two tabs, one reply.
  const { count } = await prisma.review.updateMany({
    where: { id: input.reviewId, businessId: input.businessId, sellerReply: null },
    data: { sellerReply: body, sellerRepliedAt: new Date() },
  });
  return count === 1 ? { ok: true } : { ok: false, error: "already_replied" };
}

export interface RemoveReviewInput {
  actor: Actor;
  reviewId: string;
  ground: RemovalGround;
  /** A sentence somebody wrote. Validated by writeAudit, not just by a form. */
  reason: string;
}

/**
 * Removing a review. Staff only, reasoned, audited.
 *
 * Criterion 9: removal without a reason throws, and removal writes an audit
 * row. Both come from `staffMutation`, which checks the capability, validates
 * the reason and writes the row — and the row joins the same transaction as
 * the update, so a removal cannot reach the database without its explanation.
 *
 * The ground is recorded separately from the reason because the four grounds
 * are a fixed list a moderator picks from and the reason is what they typed.
 * A list on its own is not an explanation; prose on its own is not reviewable.
 */
export async function removeReview(input: RemoveReviewInput): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isRemovalGround(input.ground)) return { ok: false, error: "invalid_ground" };

  /*
   * The moderator's own words have to stand up on their own.
   *
   * `staffMutation` validates the reason it is given, and it is given
   * `"${ground}: ${reason}"` — so an empty reason arrived as "abuse: ", which
   * is seven characters containing letters and passed. Composing before
   * validating quietly turned the ground into the explanation.
   */
  const written = assertReason("review_removed", input.reason);

  const existing = await prisma.review.findUnique({
    where: { id: input.reviewId },
    select: { id: true, businessId: true, overall: true, body: true, removedAt: true },
  });
  if (!existing) return { ok: false, error: "not_found" };
  if (existing.removedAt) return { ok: false, error: "already_removed" };

  await prisma.$transaction(async (tx) => {
    await staffMutation(
      {
        actor: input.actor,
        capability: "review.remove",
        subject: `Review:${input.reviewId}`,
        // The ground is part of the record, in front of the prose.
        reason: `${input.ground}: ${written}`,
        tx,
      },
      async () => {
        const after = await tx.review.update({
          where: { id: input.reviewId },
          data: {
            removedAt: new Date(),
            removalReason: `${input.ground}: ${written}`,
          },
          select: { id: true, removedAt: true, removalReason: true },
        });
        return { result: after, before: existing, after };
      },
    );
  });

  return { ok: true };
}

export type RequestReviewResult =
  | { ok: true; requestId: string }
  | { ok: false; error: "no_accepted_quote" | "too_old" | "already_asked" | "already_reviewed" };

/**
 * A seller asking for a review.
 *
 * One per buyer ever, about a deal inside the window, and no incentives — an
 * incentivised review is removed and logged against the account, which is a
 * moderation matter rather than something this function can prevent. What it
 * can prevent is the asking becoming nagging.
 */
export async function requestReview(input: {
  businessId: string;
  enquiryId: string;
  now?: Date;
}): Promise<RequestReviewResult> {
  const now = input.now ?? new Date();

  const enquiry = await prisma.enquiry.findUnique({
    where: { id: input.enquiryId },
    select: {
      buyerId: true,
      contactReleasedToBusinessId: true,
      contactReleasedAt: true,
      review: { select: { id: true } },
    },
  });
  if (!enquiry || enquiry.contactReleasedToBusinessId !== input.businessId) {
    return { ok: false, error: "no_accepted_quote" };
  }

  const alreadyAsked = await prisma.reviewRequest.findUnique({
    where: { businessId_buyerId: { businessId: input.businessId, buyerId: enquiry.buyerId } },
    select: { id: true },
  });

  const verdict = canRequestReview(
    {
      acceptedAt: enquiry.contactReleasedAt,
      alreadyAsked: alreadyAsked !== null,
      alreadyReviewed: enquiry.review !== null,
    },
    now,
  );
  if (!verdict.ok) return { ok: false, error: verdict.reason };

  const request = await prisma.reviewRequest.create({
    data: {
      businessId: input.businessId,
      buyerId: enquiry.buyerId,
      enquiryId: input.enquiryId,
      sentAt: now,
    },
    select: { id: true },
  });

  return { ok: true, requestId: request.id };
}
