/**
 * Who may write a review, and about whom.
 *
 * "Gated on a confirmed enquiry or an accepted quote — no exceptions, and this
 * is what makes the ratings worth anything." Every other directory in this
 * market takes reviews from anybody with an email address, and everybody knows
 * it, which is why nobody reads them. The gate is the product.
 *
 * Pure. The query layer fetches, this decides.
 */

/** The four grounds. "It is unfair" is not one of them. */
export const REMOVAL_GROUNDS = [
  "no_traceable_enquiry",
  "abuse",
  "private_information",
  "provably_false",
] as const;

export type RemovalGround = (typeof REMOVAL_GROUNDS)[number];

export function isRemovalGround(value: string): value is RemovalGround {
  return (REMOVAL_GROUNDS as readonly string[]).includes(value);
}

/** Editable for a fortnight, then it is the record. */
export const EDITABLE_DAYS = 14;

/** A seller may ask for a review about a deal this recent, and no older. */
export const REQUEST_WINDOW_DAYS = 90;

export const DIMENSIONS = ["quotedAccurate", "onTime", "asDescribed", "responsiveness"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export interface EnquiryForReview {
  id: string;
  buyerId: string;
  /** Set on acceptance. The business the review is about. */
  contactReleasedToBusinessId: string | null;
  contactReleasedAt: Date | null;
  /** True when a review already exists for this enquiry. */
  alreadyReviewed: boolean;
}

export type EligibilityVerdict =
  | { ok: true; businessId: string }
  | { ok: false; reason: "not_your_enquiry" | "no_accepted_quote" | "already_reviewed" };

/**
 * May this buyer review this enquiry?
 *
 * An accepted quote is the confirmation. There is no other kind: the platform
 * holds no delivery record and no payment, so acceptance is the last thing it
 * knows for certain happened between the two of them.
 */
export function canReview(
  buyerId: string,
  enquiry: EnquiryForReview | null,
): EligibilityVerdict {
  // A missing enquiry and somebody else's are the same answer.
  if (!enquiry || enquiry.buyerId !== buyerId) return { ok: false, reason: "not_your_enquiry" };
  if (!enquiry.contactReleasedToBusinessId) return { ok: false, reason: "no_accepted_quote" };
  if (enquiry.alreadyReviewed) return { ok: false, reason: "already_reviewed" };
  return { ok: true, businessId: enquiry.contactReleasedToBusinessId };
}

export interface Ratings {
  overall: number;
  quotedAccurate: number;
  onTime: number;
  asDescribed: number;
  responsiveness: number;
}

/** Every dimension is one to five. A zero is a missing answer, not a bad one. */
export function ratingsAreValid(ratings: Partial<Ratings>): ratings is Ratings {
  for (const key of ["overall", ...DIMENSIONS] as const) {
    const value = ratings[key];
    if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 5) return false;
  }
  return true;
}

export function editableUntil(createdAt: Date): Date {
  return new Date(createdAt.getTime() + EDITABLE_DAYS * 86_400_000);
}

export function isEditable(review: { editableUntil: Date; removedAt: Date | null }, now: Date): boolean {
  return review.removedAt === null && review.editableUntil.getTime() > now.getTime();
}

export interface RequestEligibility {
  /** The accepted quote that earns the right to ask. */
  acceptedAt: Date | null;
  /** True when this business has ever asked this buyer. */
  alreadyAsked: boolean;
  /** True when the buyer has already written one. */
  alreadyReviewed: boolean;
}

export type RequestVerdict =
  | { ok: true }
  | { ok: false; reason: "no_accepted_quote" | "too_old" | "already_asked" | "already_reviewed" };

/**
 * May this seller ask this buyer for a review?
 *
 * One per buyer ever, and only about a deal inside the window. The "ever" is
 * deliberate and is not per enquiry: a seller who may ask once a quarter for
 * five years is a seller who has learned to nag, and the schema's unique
 * constraint on (businessId, buyerId) makes it unaskable rather than merely
 * discouraged.
 */
export function canRequestReview(
  eligibility: RequestEligibility,
  now: Date,
): RequestVerdict {
  if (!eligibility.acceptedAt) return { ok: false, reason: "no_accepted_quote" };
  if (eligibility.alreadyReviewed) return { ok: false, reason: "already_reviewed" };
  if (eligibility.alreadyAsked) return { ok: false, reason: "already_asked" };

  const age = now.getTime() - eligibility.acceptedAt.getTime();
  if (age > REQUEST_WINDOW_DAYS * 86_400_000) return { ok: false, reason: "too_old" };

  return { ok: true };
}
