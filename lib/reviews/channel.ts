/**
 * Which carrier a review request leaves on, for one buyer. Board 11c `B2`.
 *
 * The board asserted a channel rather than deciding one: *"Sent by WhatsApp
 * with a direct link"*, named on the send button, for buyers whose contact
 * record may hold only an email. `User.phone` and `User.email` are both
 * nullable and always have been, so the sentence was true of some buyers and
 * silently false of the rest.
 *
 * ## Two conditions, not one
 *
 * A channel is available when we hold a destination for this buyer **and** a
 * live template exists for it. The second half is the one the board could not
 * have known about: every WhatsApp template in this product ships
 * `pending_meta`, because Meta approves them and we do not, and
 * `NotificationTemplate` has carried that status since handoff 2. A matrix that
 * routed to WhatsApp on the strength of a phone number alone would resolve to a
 * template that is not live, find nothing to render, and send nothing at all —
 * a request the panel said it had sent.
 *
 * So the preference order is WhatsApp, then email, and each rung has to clear
 * both conditions to be taken.
 *
 * ## One function, two readers
 *
 * The panel names the channel per buyer and the emitter sends on it. Those are
 * the two halves of the defect `lib/reviews/service.ts` already warns about in
 * its own header — *"both have to be looking at the same fields or the page
 * offers a form the service refuses"* — so they read this, and neither decides
 * for itself.
 *
 * Pure. The caller fetches the buyer and asks the template table what is live.
 */

/** The carriers a review request can actually leave on. In-app is not one. */
export const REQUEST_CHANNELS = ["whatsapp", "email"] as const;

export type RequestChannel = (typeof REQUEST_CHANNELS)[number];

export interface BuyerContact {
  phone: string | null;
  email: string | null;
}

/**
 * The channel this buyer's request goes out on, or null when there is none.
 *
 * In-app is deliberately not a fallback here. A review request is aimed at
 * somebody who finished a deal weeks ago and has no reason to open the site;
 * an in-app notification for them is a message filed where nobody is standing.
 * Every other buyer-facing event in this product is about a quote in flight,
 * which is the opposite situation — see `BUYER_DEFAULT` in lib/notify/events.ts.
 *
 * Null is a real answer and the panel renders it as one: a buyer we cannot
 * reach is shown with the reason rather than dropped from the list, because a
 * name that quietly disappears is a seller wondering why the count moved.
 */
export function requestChannelFor(
  buyer: BuyerContact,
  live: ReadonlySet<RequestChannel>,
): RequestChannel | null {
  if (buyer.phone && live.has("whatsapp")) return "whatsapp";
  if (buyer.email && live.has("email")) return "email";
  return null;
}
