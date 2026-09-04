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


/**
 * How a review earned its place, and therefore what badge it carries.
 *
 * Board 1m calls this the provenance ladder, and it inverted at the pivot. The
 * board treated a purchase as the strongest signal and an accepted quote as the
 * weaker one; with no transactions on the platform an accepted quote *is* the
 * strongest thing we can prove, so the tones swap and the weaker label — the
 * one freed up — becomes the grey tier.
 *
 *   `accepted_quote`    ok / green   the buyer accepted this seller's quote here
 *   `verified_enquiry`  neutral      the buyer enquired and this seller replied
 *
 * There is no third rung. A review with neither cannot be created, which is
 * what `canReview` below is for, and the label a competitor would use for the
 * absent third rung — "Verified purchase" — names something that does not
 * exist on this platform at all.
 */
export const PROVENANCE = ["accepted_quote", "verified_enquiry"] as const;

export type Provenance = (typeof PROVENANCE)[number];

/**
 * The rung a published review sits on.
 *
 * Derived, never stored. The fact it reads — did this seller's quote get
 * accepted on this enquiry — is already a column, and a second copy of it on
 * the review row is a column that can disagree with the first. Interface
 * honesty: derived metrics have no writable path, and the cheapest way to
 * guarantee that is not to have the path.
 */
export function provenanceOf(review: {
  businessId: string;
  enquiry: { contactReleasedToBusinessId: string | null };
}): Provenance {
  return review.enquiry.contactReleasedToBusinessId === review.businessId
    ? "accepted_quote"
    : "verified_enquiry";
}

/** Board 1m: at or below this the review answers the Critical filter. */
export const CRITICAL_AT_OR_BELOW = 3;

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
  /** Set on acceptance. The strongest rung, and the default subject. */
  contactReleasedToBusinessId: string | null;
  contactReleasedAt: Date | null;
  /**
   * Recipients of this enquiry that actually replied.
   *
   * `EnquiryRecipient.firstReplyAt` is the timestamp response time is measured
   * from, which makes it the one fact the platform holds about whether a
   * supplier engaged at all. A recipient that never replied is a supplier the
   * buyer has nothing to report on, so it is not on this list.
   */
  repliedBusinessIds: readonly string[];
  /** True when a review already exists for this enquiry. */
  alreadyReviewed: boolean;
}

export type EligibilityVerdict =
  | { ok: true; businessId: string; provenance: Provenance }
  | {
      ok: false;
      reason: "not_your_enquiry" | "no_confirmed_enquiry" | "ambiguous_subject" | "already_reviewed";
    };

/**
 * May this buyer review this enquiry, and about which supplier?
 *
 * Board 1m: *"a review requires a confirmed enquiry or an accepted quote on
 * this platform"* — two rungs, not one. This function used to admit only the
 * accepted-quote rung, which made the grey `Verified enquiry` badge on the
 * reviews page a label nothing could ever carry, and the provenance ladder a
 * decoration rather than a claim.
 *
 * A confirmed enquiry means this seller received it and replied. Delivery on
 * its own is not confirmation of anything: eight suppliers receive a fan-out,
 * and a buyer who heard from two of them has met two suppliers.
 *
 * One review per enquiry regardless of rung — `Review.enquiryId` is unique, and
 * a buyer with three enquiries to one seller leaves three reviews, each tied to
 * its own. So where a fan-out drew replies from several sellers the caller has
 * to name the one being reviewed; naming none is only unambiguous when a quote
 * was accepted, or when exactly one supplier replied.
 */
export function canReview(
  buyerId: string,
  enquiry: EnquiryForReview | null,
  /** The supplier being reviewed, where the buyer picked one. */
  businessId?: string,
): EligibilityVerdict {
  // A missing enquiry and somebody else's are the same answer.
  if (!enquiry || enquiry.buyerId !== buyerId) return { ok: false, reason: "not_your_enquiry" };
  if (enquiry.alreadyReviewed) return { ok: false, reason: "already_reviewed" };

  const accepted = enquiry.contactReleasedToBusinessId;
  const replied = enquiry.repliedBusinessIds;

  if (businessId) {
    if (accepted === businessId) return { ok: true, businessId, provenance: "accepted_quote" };
    if (replied.includes(businessId)) {
      return { ok: true, businessId, provenance: "verified_enquiry" };
    }
    return { ok: false, reason: "no_confirmed_enquiry" };
  }

  // Nobody named a supplier. An accepted quote answers it on its own.
  if (accepted) return { ok: true, businessId: accepted, provenance: "accepted_quote" };
  if (replied.length === 1) {
    return { ok: true, businessId: replied[0]!, provenance: "verified_enquiry" };
  }
  if (replied.length === 0) return { ok: false, reason: "no_confirmed_enquiry" };
  return { ok: false, reason: "ambiguous_subject" };
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
