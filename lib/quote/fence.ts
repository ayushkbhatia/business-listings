/**
 * Whether a supplier may still put a quote in front of a buyer — board `7c`'s
 * fence, and the one rule every writer of a quote reads.
 *
 * ## Why this exists
 *
 * The seller's lead screen made its composer read-only on "a marked outcome, a
 * suspended listing or a closed enquiry", and said those were "the same three
 * conditions the service refuses on". The service checked one of them.
 * `sendQuoteForBusiness` fenced on `closesAt` and nothing else, so anything that
 * reached the action without the screen — a stale tab, a second device, a
 * replayed request — could:
 *
 *  - send a quote on an enquiry the buyer had **already accepted**, which
 *    created a row after the terminal state and flipped a declined recipient
 *    back to `quoted`;
 *  - let the winning supplier send a revision **after** acceptance, so the
 *    record the buyer holds stopped being the last word;
 *  - send from a **suspended** listing.
 *
 * Two copies of a rule is how that happened, so there is one now. The screen and
 * every service that writes a quote — send, autosave, extend — ask this.
 *
 * ## Pure
 *
 * No database import. The services load the state inside their own transaction
 * and hand it here; the lead screen hands it what it already rendered. A rule
 * that fetched for itself could not be asked twice about the same read.
 */

export type QuoteFenceReason =
  /** This supplier's quote was accepted. The record is closed, including to them. */
  | "accepted_yours"
  /** The buyer accepted another supplier's quote. */
  | "accepted_elsewhere"
  /** Declined by the buyer, or by acceptance of someone else. */
  | "declined"
  /** The supplier declined it themselves — board `3j-s`. Final, because the buyer was told. */
  | "declined_by_you"
  /** The seller marked the lead won or lost themselves. Clearing it reopens it. */
  | "marked"
  /** The listing is suspended, and a suspended listing is read-only. */
  | "suspended"
  /** The enquiry has passed the date it stopped taking quotes. */
  | "closed";

export interface QuoteFenceState {
  /** The business asking. */
  businessId: string;
  /** `Enquiry.contactReleasedToBusinessId` — set only by acceptance. */
  contactReleasedToBusinessId: string | null;
  /** `EnquiryRecipient.state`. */
  recipientState: string;
  /** `EnquiryRecipient.outcome`, the seller's own mark. */
  outcome: string | null;
  /**
   * Whether `EnquiryRecipient.declinedAt` is set — the supplier's own decline,
   * board `3j-s`. Optional so a caller that cannot know says nothing rather than
   * false; a declined row without it reads as the buyer's decline, which is what
   * every declined row meant before the supplier could write one.
   */
  declinedBySeller?: boolean;
  /** Whether `Business.suspendedAt` is set. */
  suspended: boolean;
  /** `Enquiry.closesAt`. */
  closesAt: Date;
}

/**
 * The reason a quote may not be written, or null when it may.
 *
 * **Ordered by what the supplier most needs to be told.** An accepted enquiry is
 * the terminal state and outranks everything: a suspended supplier whose quote
 * was accepted should read that it was accepted. Then the listing, then the
 * seller's own mark, then the calendar — a closed enquiry that was also accepted
 * is, first of all, accepted.
 */
export function quoteFence(state: QuoteFenceState, now: Date): QuoteFenceReason | null {
  const decided = decidedReason(state);
  if (decided === "accepted_yours" || decided === "accepted_elsewhere") return decided;
  if (state.suspended) return "suspended";
  if (decided) return decided;
  // `<=`, matching the screen: at the closing instant the enquiry is closed.
  if (state.closesAt.getTime() <= now.getTime()) return "closed";
  return null;
}

/**
 * The part of the fence that is about the enquiry's outcome rather than the
 * calendar or the listing.
 *
 * Extending a quote's window reads only this: an extension on a closed enquiry
 * is still a supplier holding a price they already gave, which the fence has no
 * reason to refuse, but an extension on an accepted or lost one moves a date on
 * a quote that is history.
 */
export function decidedReason(
  state: Pick<
    QuoteFenceState,
    "businessId" | "contactReleasedToBusinessId" | "recipientState" | "outcome" | "declinedBySeller"
  >,
): Extract<
  QuoteFenceReason,
  "accepted_yours" | "accepted_elsewhere" | "declined" | "declined_by_you" | "marked"
> | null {
  if (state.contactReleasedToBusinessId !== null) {
    return state.contactReleasedToBusinessId === state.businessId ? "accepted_yours" : "accepted_elsewhere";
  }
  if (state.recipientState === "declined") return state.declinedBySeller ? "declined_by_you" : "declined";
  if (state.outcome !== null) return "marked";
  return null;
}
