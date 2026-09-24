import { dubaiDayStart } from "@/lib/format/date";

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

/**
 * The four grounds a **seller** may cite. "It is unfair" is not one of them.
 *
 * Board 11c criterion 6: *"the dispute rail lists exactly the grounds the
 * dispute flow accepts."* The rail renders this array, the dispute form accepts
 * this array, the moderator's queue groups by it, and the Postgres enum
 * `review_dispute_ground` declares the same four in the same order. One list,
 * four readers, and a unit test that fails if the enum and this drift.
 *
 * The board's own render is why the criterion exists: the prose above the rail
 * counted four while the rail below it showed three, because abuse and private
 * information had been merged into one row. They are separate grounds with
 * separate evidence — abuse is judged on the text, private information on what
 * the text contains about a third party — so they are separate rows.
 */
export const DISPUTE_GROUNDS = [
  "no_traceable_enquiry",
  "abuse",
  "private_information",
  "provably_false",
] as const;

export type DisputeGround = (typeof DISPUTE_GROUNDS)[number];

export function isDisputeGround(value: string): value is DisputeGround {
  return (DISPUTE_GROUNDS as readonly string[]).includes(value);
}

/**
 * A review the platform itself found and removed. Board 11c `B6`.
 *
 * The request panel has promised since board 1m that *"an incentivised review
 * is removed and logged against your account"*, and there was no ground a
 * moderator could remove one on: the four above are the four a seller may
 * *ask* for, and no supplier is going to file a dispute reporting themselves.
 * So the sentence described a removal with no path to it.
 *
 * Held separate rather than folded into the four, which keeps criterion 6 true
 * in both directions — the rail lists exactly what the dispute flow accepts, and
 * this is not something the dispute flow accepts.
 */
export const STAFF_ONLY_GROUNDS = ["incentivised"] as const;

/**
 * Every ground a review can come down on. The seller's four, plus ours.
 *
 * `removeReview` takes one of these; the dispute rail takes one of the four
 * above. Two lists with one derived from the other, so a ground can never be
 * removable-but-undisputable by accident.
 */
export const REMOVAL_GROUNDS = [...DISPUTE_GROUNDS, ...STAFF_ONLY_GROUNDS] as const;

export type RemovalGround = (typeof REMOVAL_GROUNDS)[number];

export function isRemovalGround(value: string): value is RemovalGround {
  return (REMOVAL_GROUNDS as readonly string[]).includes(value);
}

/** Editable for a fortnight, then it is the record. */
export const EDITABLE_DAYS = 14;

/**
 * How long a seller has to reply. Board 11c `Q6`: twenty-eight days, one rule.
 *
 * No per-plan variation, deliberately, and `Q5` is the same decision one step
 * out: reviews are reputation rather than a paid feature, and a Free seller who
 * cannot answer a two-star review is a punishment aimed at the buyer reading it.
 *
 * The board drew this as `2 AUG · 21 DAYS TO REPLY` — a countdown that had run
 * out on 23 August against a page rendered in September, and which said nothing
 * about what expiry meant. It is a date now, and the consequence is stated on
 * the card: after it the reply box closes and the review stands on its own.
 */
export const REPLY_WINDOW_DAYS = 28;

/** The day the reply box closes. Derived from the review, never stored. */
export function replyWindowEnds(reviewCreatedAt: Date): Date {
  return new Date(reviewCreatedAt.getTime() + REPLY_WINDOW_DAYS * 86_400_000);
}

/**
 * Whether this review can still be answered.
 *
 * Criterion 9: *"closing is a state change, not a deletion."* Nothing is
 * written when the window passes and nothing is deleted — the review stays, the
 * card changes, and a seller who comes back in a year sees the same review with
 * the box closed rather than a gap where one used to be.
 *
 * Removed and held both close it too. A held review is off the public page
 * while a decision is made, and a reply written against something the seller
 * cannot see is the one thing on this record that cannot be taken back.
 */
export function replyWindowOpen(
  review: {
    createdAt: Date;
    sellerReply: string | null;
    removedAt: Date | null;
    heldAt: Date | null;
  },
  now: Date,
): boolean {
  if (review.sellerReply !== null) return false;
  if (review.removedAt !== null || review.heldAt !== null) return false;
  return replyWindowEnds(review.createdAt).getTime() > now.getTime();
}

/**
 * The state a review card is in, on the seller's page. One of six.
 *
 * The board drew three — awaiting a reply, replied, and an unverified one that
 * cannot exist — and the page has to render every state a row can actually be
 * in. `removed` and `under_dispute` were both reachable before this board and
 * neither was drawn; `window_closed` is `Q6` arriving.
 *
 * Derived from the row rather than stored, so there is no state machine to fall
 * out of step with the columns underneath it.
 */
export type ReviewCardState =
  | "removed"
  | "held"
  | "under_dispute"
  | "replied"
  | "awaiting_reply"
  | "window_closed";

export function cardStateOf(
  review: {
    createdAt: Date;
    sellerReply: string | null;
    removedAt: Date | null;
    heldAt: Date | null;
    hasOpenDispute: boolean;
  },
  now: Date,
): ReviewCardState {
  /*
     Order is the precedence, and it is not alphabetical.

     Removal outranks everything because the review is gone and nothing else
     about it is actionable. A hold outranks a dispute because a hold is the
     moderator having already acted. A dispute outranks a reply because it is
     the thing currently in flight — a seller who replied and then disputed is
     waiting on us, and telling them "replied" would hide that.
  */
  if (review.removedAt !== null) return "removed";
  if (review.heldAt !== null) return "held";
  if (review.hasOpenDispute) return "under_dispute";
  if (review.sellerReply !== null) return "replied";
  return replyWindowEnds(review.createdAt).getTime() > now.getTime()
    ? "awaiting_reply"
    : "window_closed";
}

export type DisputeVerdict =
  | { ok: true }
  | { ok: false; reason: "not_yours" | "already_removed" | "already_held" | "already_disputed" };

/**
 * May this seller dispute this review?
 *
 * **No deadline**, and that is a decision rather than an omission. The reply
 * window closes because a public conversation held eleven months late is not a
 * conversation; none of the four grounds expires the same way. A review that
 * names a person's mobile number is a private-information problem on the day it
 * is written and on the same day next year, and a dispute window would mean the
 * platform declining to look at it because the seller was slow.
 *
 * A reply does not waive it either. §States says a refused dispute leaves the
 * reply available if the window is open, which only makes sense if the two are
 * independent — and the case that produces the order the other way round is
 * ordinary: a seller answers a review politely, then finds out the reviewer was
 * a competitor.
 *
 * What does block it is a decision already made or in progress. A removed
 * review is gone, a held one is already in front of somebody, and a second open
 * dispute on one review is the same case decided twice.
 */
export function canDisputeReview(
  review: {
    businessId: string;
    removedAt: Date | null;
    heldAt: Date | null;
    hasOpenDispute: boolean;
  },
  businessId: string,
): DisputeVerdict {
  if (review.businessId !== businessId) return { ok: false, reason: "not_yours" };
  if (review.removedAt !== null) return { ok: false, reason: "already_removed" };
  if (review.heldAt !== null) return { ok: false, reason: "already_held" };
  if (review.hasOpenDispute) return { ok: false, reason: "already_disputed" };
  return { ok: true };
}

/**
 * How long a review stays open, from the day it opened. Board 10f `Q1`.
 *
 * The board's band reads *90 days after acceptance* and its handoff says the
 * number has no source on any board. It has one in the tree: board 11c's
 * request window, which has let a seller ask about a deal this recent and no
 * older since handoff 2. Two windows on one question — how long after a deal is
 * a review of it still worth having — would let a seller send a request to a
 * form that has already closed, so they are one number, and changing it is
 * changing this constant.
 */
export const REVIEW_WINDOW_DAYS = 90;

/** A seller may ask for a review about a deal this recent, and no older. The same window. */
export const REQUEST_WINDOW_DAYS = REVIEW_WINDOW_DAYS;

/**
 * What the window runs from, which the band states in words.
 *
 *   `accepted`  the day the quote was accepted
 *   `opened`    the day a one-off job's reviews opened (a later start date)
 *   `term`      the last day of an ongoing engagement's term
 *   `replied`   the day this supplier first replied, on the enquiry rung
 *
 * An ongoing engagement is reviewable while it runs — board `7c-s` opens it
 * after the first cycle precisely so the work can be judged — and closes ninety
 * days after the term ends. Ninety days from the first cycle would shut the
 * review of a 24-month AMC in its fourth month.
 */
export type WindowAnchor = "accepted" | "opened" | "term" | "replied";

/** An engagement's shape, as far as the window needs it. */
export interface EngagementFacts {
  ongoing: boolean;
  /** The term's last day. Null on an engagement with no dated term. */
  termEndsOn: Date | null;
}

export interface ReviewWindow {
  anchor: WindowAnchor;
  /** Dubai calendar day the window opened, as UTC midnight (`dubaiDayStart`). */
  from: Date;
  /** The last Dubai calendar day a review can be written — "open until". */
  closesOn: Date;
}

const DAY_MS = 86_400_000;

/**
 * The window for reviewing one supplier on one enquiry. Derived, never stored.
 *
 * Null where the enquiry cannot say when the supplier engaged — a reply with no
 * timestamp is a row from before `firstReplyAt` was written, and a window
 * invented for it would close a review on a guess.
 */
export function reviewWindowFor(
  enquiry: Pick<
    EnquiryForReview,
    "contactReleasedToBusinessId" | "contactReleasedAt" | "reviewOpensOn" | "repliedAt" | "engagement"
  >,
  businessId: string,
): ReviewWindow | null {
  if (enquiry.contactReleasedToBusinessId === businessId) {
    return acceptedWindow(enquiry.contactReleasedAt, enquiry.reviewOpensOn, enquiry.engagement);
  }
  const replied = enquiry.repliedAt?.[businessId];
  if (!replied) return null;
  const from = dubaiDayStart(replied);
  return { anchor: "replied", from, closesOn: new Date(from.getTime() + REVIEW_WINDOW_DAYS * DAY_MS) };
}

/**
 * An accepted quote's window: from acceptance, or from the day reviews opened
 * where that is later — or, for an ongoing engagement, from the end of its term.
 */
export function acceptedWindow(
  acceptedAt: Date | null,
  reviewOpensOn: Date | null,
  engagement?: EngagementFacts | null,
): ReviewWindow | null {
  if (!acceptedAt) return null;
  if (engagement?.ongoing) {
    // Undated, it cannot be said to have ended, so nothing closes it.
    if (!engagement.termEndsOn) return null;
    const from = dubaiDayStart(engagement.termEndsOn);
    return { anchor: "term", from, closesOn: new Date(from.getTime() + REVIEW_WINDOW_DAYS * DAY_MS) };
  }
  const accepted = dubaiDayStart(acceptedAt);
  const opened = reviewOpensOn && reviewOpensOn.getTime() > accepted.getTime() ? reviewOpensOn : null;
  const from = opened ?? accepted;
  return {
    anchor: opened ? "opened" : "accepted",
    from,
    closesOn: new Date(from.getTime() + REVIEW_WINDOW_DAYS * DAY_MS),
  };
}

/** Open through the whole of its last Dubai day. */
export function windowOpen(window: ReviewWindow | null, now: Date): boolean {
  return window === null || dubaiDayStart(now).getTime() <= window.closesOn.getTime();
}

export const DIMENSIONS = ["quotedAccurate", "onTime", "asDescribed", "responsiveness"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export interface EnquiryForReview {
  id: string;
  buyerId: string;
  /**
   * The business the buyer's own account sits on — `User.businessId` — or null.
   *
   * Read with the enquiry, and it is the reviewer's: `canReview` answers nobody
   * but `buyerId`, so once it is asking about a subject this is the team the
   * person writing is on. Required rather than optional like the facts below,
   * because a fixture that leaves it out is a gate that forgot the rule.
   */
  buyerBusinessId: string | null;
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
  /**
   * When each of those first replied — the enquiry rung's window runs from it
   * (board 10f `Q1`). Optional so a fixture that does not care about the window
   * need not invent one; a missing entry is a window nobody can close.
   */
  repliedAt?: Readonly<Record<string, Date>>;
  /** Board `7c-s`: an ongoing engagement's window runs to the end of its term. Absent for goods. */
  engagement?: EngagementFacts | null;
  /** True when a review already exists for this enquiry. */
  alreadyReviewed: boolean;
  /**
   * Board `7c-s` `B10`: the calendar day a review of the accepted supplier opens
   * — acceptance for a goods quote, a delivery cycle into an ongoing engagement.
   * `reviewOpensOn` in `lib/enquiry/accepted-proposal.ts` decides it. Null where
   * nothing was accepted, or where the row predates the stamp.
   */
  reviewOpensOn: Date | null;
}

export type EligibilityVerdict =
  | { ok: true; businessId: string; provenance: Provenance }
  | {
      ok: false;
      reason: "not_your_enquiry" | "no_confirmed_enquiry" | "ambiguous_subject" | "already_reviewed";
    }
  /** The accepted engagement has not run a cycle yet. Said with the day it opens. */
  | { ok: false; reason: "not_yet_open"; opensOn: Date }
  /**
   * Board 10f: the window has passed. The form is absent, not disabled, and
   * the page states the day it closed and what it ran from.
   */
  | { ok: false; reason: "window_closed"; businessId: string; window: ReviewWindow }
  /**
   * The only supplier this buyer could review here is the one their own account
   * sits on. Carries it, so the page can name it by its display name.
   */
  | { ok: false; reason: "own_business"; businessId: string };

/**
 * The suppliers that replied to this enquiry and that its buyer may review: all
 * of them but the buyer's own business.
 *
 * One list for the gate, the page that asks which supplier, and the count the
 * other-enquiries rail prints — a choice offered on one of them and refused by
 * another is the page offering a form the service refuses.
 */
export function reviewableReplies(
  enquiry: Pick<EnquiryForReview, "repliedBusinessIds" | "buyerBusinessId">,
): readonly string[] {
  const own = enquiry.buyerBusinessId;
  return own ? enquiry.repliedBusinessIds.filter((id) => id !== own) : enquiry.repliedBusinessIds;
}

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
 *
 * **No supplier reviews itself**, from any seat on its team. A seller's account
 * holds `buyer` too, so its owner could enquire to their own storefront, reply
 * from the leads inbox — which stamps `firstReplyAt`, the enquiry rung — and
 * then rate the reply. The accepted records told buyers this could not happen,
 * and nothing held it. `review.create` cannot see it: that is a question about
 * the person, and this one is about the subject, like whose enquiry it is.
 *
 * So the buyer's own business is taken out before a subject is chosen, not
 * refused after: an enquiry their team replied to beside one other supplier has
 * one supplier to review, not two to choose between. Refused as `own_business`
 * when it was named, or was the only supplier left to review.
 */
export function canReview(
  buyerId: string,
  enquiry: EnquiryForReview | null,
  /** The supplier being reviewed, where the buyer picked one. */
  businessId?: string,
  now: Date = new Date(),
): EligibilityVerdict {
  // A missing enquiry and somebody else's are the same answer.
  if (!enquiry || enquiry.buyerId !== buyerId) return { ok: false, reason: "not_your_enquiry" };
  if (enquiry.alreadyReviewed) return { ok: false, reason: "already_reviewed" };

  // Their own business is out of the running before anyone is chosen.
  const own = enquiry.buyerBusinessId;
  if (own && businessId === own) return { ok: false, reason: "own_business", businessId: own };
  const accepted = own && enquiry.contactReleasedToBusinessId === own ? null : enquiry.contactReleasedToBusinessId;
  const replied = reviewableReplies(enquiry);
  /*
     Board `7c-s` `B10`: *there is nothing to review on day one* of a 24-month
     engagement. The accepted supplier waits for its first cycle, and does not
     fall through to the enquiry rung meanwhile — that would be the same review a
     quarter early with a weaker badge.
  */
  const notYet =
    accepted && enquiry.reviewOpensOn && dubaiDayStart(now).getTime() < enquiry.reviewOpensOn.getTime()
      ? ({ ok: false, reason: "not_yet_open", opensOn: enquiry.reviewOpensOn } as const)
      : null;

  /*
     Board 10f `Q1`: open for REVIEW_WINDOW_DAYS from the day it opened, then
     closed. Asked last, once the subject is known, because the window is a fact
     about one supplier on this enquiry — an accepted supplier and one that only
     replied can be in different windows.
  */
  const open = (subject: string, provenance: Provenance): EligibilityVerdict => {
    const window = reviewWindowFor(enquiry, subject);
    return windowOpen(window, now)
      ? { ok: true, businessId: subject, provenance }
      : { ok: false, reason: "window_closed", businessId: subject, window: window! };
  };

  if (businessId) {
    if (accepted === businessId) return notYet ?? open(businessId, "accepted_quote");
    if (replied.includes(businessId)) return open(businessId, "verified_enquiry");
    return { ok: false, reason: "no_confirmed_enquiry" };
  }

  // Nobody named a supplier. An accepted quote answers it on its own.
  if (accepted) return notYet ?? open(accepted, "accepted_quote");
  if (replied.length === 1) return open(replied[0]!, "verified_enquiry");
  if (replied.length > 1) return { ok: false, reason: "ambiguous_subject" };
  // Nobody left. Where their own team was who engaged, that is the answer rather than "nobody replied".
  if (own && (enquiry.contactReleasedToBusinessId === own || enquiry.repliedBusinessIds.includes(own))) {
    return { ok: false, reason: "own_business", businessId: own };
  }
  return { ok: false, reason: "no_confirmed_enquiry" };
}

/**
 * One review's scores. Board 10f `B3`/`B4`.
 *
 * `overall` is required and is the buyer's own verdict — never computed from
 * the four. Each dimension is one to five, or null where the buyer skipped it
 * as not applying; a null drops out of that dimension's average on board 1m.
 */
export interface Ratings {
  overall: number;
  quotedAccurate: number | null;
  onTime: number | null;
  asDescribed: number | null;
  responsiveness: number | null;
}

function isScore(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 5;
}

/**
 * Overall one to five; each dimension one to five or an explicit null.
 *
 * A zero is a missing answer, not a bad one, and an absent key is a caller that
 * forgot the dimension exists rather than a buyer who skipped it — so both are
 * refused, and skipping is said with null.
 */
export function ratingsAreValid(ratings: Partial<Ratings>): ratings is Ratings {
  if (!isScore(ratings.overall)) return false;
  for (const key of DIMENSIONS) {
    const value = ratings[key];
    if (value === null) continue;
    if (!isScore(value)) return false;
  }
  return true;
}

export function editableUntil(createdAt: Date): Date {
  return new Date(createdAt.getTime() + EDITABLE_DAYS * 86_400_000);
}

/**
 * Whether the buyer may still change what they wrote.
 *
 * Fourteen days, and closed early by three things (board 10f §States): a seller
 * reply, because a reply to words that have since changed answers nothing and
 * there is no counter-reply; a hold, because a moderator is deciding on the
 * text as it stands; and a removal. `review_words_are_fixed` holds the same rule
 * in the database.
 */
export function isEditable(
  review: {
    editableUntil: Date;
    removedAt: Date | null;
    heldAt?: Date | null;
    sellerReply?: string | null;
  },
  now: Date,
): boolean {
  if (review.removedAt !== null) return false;
  if ((review.heldAt ?? null) !== null) return false;
  if ((review.sellerReply ?? null) !== null) return false;
  return review.editableUntil.getTime() > now.getTime();
}

export interface RequestEligibility {
  /** The accepted quote that earns the right to ask. */
  acceptedAt: Date | null;
  /** Board `7c-s`: when the buyer may first write one. See `EnquiryForReview.reviewOpensOn`. */
  reviewOpensOn: Date | null;
  /** True when this business has ever asked this buyer. */
  alreadyAsked: boolean;
  /** True when the buyer has already written one. */
  alreadyReviewed: boolean;
}

export type RequestVerdict =
  | { ok: true }
  | { ok: false; reason: "no_accepted_quote" | "too_old" | "already_asked" | "already_reviewed" | "not_yet_open" };

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

  /*
     Board `7c-s`: asking before the buyer can answer sends them to a form that
     refuses them. And the window runs from the day reviews open rather than from
     acceptance, or a quarter's wait would spend all ninety days of it.
  */
  const opens = eligibility.reviewOpensOn;
  if (opens && dubaiDayStart(now).getTime() < opens.getTime()) return { ok: false, reason: "not_yet_open" };
  // Board 10f: the buyer's own window, not a second count of ninety days. A
  // request is never sent to a form that has closed.
  if (!windowOpen(acceptedWindow(eligibility.acceptedAt, opens), now)) return { ok: false, reason: "too_old" };

  return { ok: true };
}
