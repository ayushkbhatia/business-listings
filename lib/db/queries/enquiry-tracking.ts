import { prisma } from "@/lib/db/client";
import type { TrackedRecipient } from "@/lib/enquiry/tracking";

/**
 * Board 1i's live status card: who has it, who opened it, who replied.
 *
 * Separate from `getBuyerEnquiry` because it answers a different question and
 * is polled on a different clock. The tracking page re-reads this every thirty
 * seconds while the tab is visible; the requirement and the lines beside it do
 * not change and are not re-fetched.
 *
 * Every figure here is computed. `1 H 40 M` is `quotedAt − deliveredAt`, worked
 * out at read time — the spec is explicit that latency is "computed, never
 * stored as editable", because a stored figure is one a seller could be given a
 * reason to want changed.
 */

export interface TrackingView {
  enquiryId: string;
  ref: string;
  closesAt: Date;
  totalLines: number;
  accepted: boolean;
  revision: number;
  revisedAt: Date | null;
  recipients: TrackedRecipient[];
}

/**
 * By reference, for the buyer who sent it.
 *
 * The reference is the identifier in the SMS and the email, so it is what the
 * URL carries. It is also guessable — `ENQ-8841` is four digits — which is why
 * the buyer id is part of the query rather than a check afterwards: an unknown
 * reference and somebody else's enquiry return the same `null`, and the page
 * turns that into a 404. A 403 would confirm the enquiry exists.
 */
export async function getTrackingByRef(
  buyerId: string,
  ref: string,
): Promise<TrackingView | null> {
  const enquiry = await prisma.enquiry.findFirst({
    /*
       By reference or by id.

       The spec's URL is `/enquiry/:ref` — the reference is what is printed in
       the SMS and the email, and it is what a buyer reads back to somebody. The
       id is what every link already sent out carries, and those links are in
       inboxes we cannot edit. Accepting both costs one `OR` and breaks nothing.
    */
    where: { OR: [{ ref }, { id: ref }], buyerId },
    select: {
      id: true,
      ref: true,
      closesAt: true,
      createdAt: true,
      revision: true,
      revisedAt: true,
      contactReleasedToBusinessId: true,
      _count: { select: { lines: true } },
      recipients: {
        select: {
          businessId: true,
          state: true,
          openedAt: true,
          buyerNudgedAt: true,
          createdAt: true,
          business: { select: { slug: true, displayName: true } },
        },
      },
      quotes: {
        /*
           A draft is the seller's own working copy and was never sent — it must
           not make a row read `quoted`, which would tell the buyer a reply had
           arrived when nothing has.
        */
        where: { status: { not: "draft" } },
        orderBy: [{ businessId: "asc" }, { revision: "desc" }],
        select: {
          businessId: true,
          sentAt: true,
          createdAt: true,
          supersededAt: true,
          againstRevision: true,
          status: true,
          lostReason: true,
          _count: { select: { lines: true } },
        },
      },
    },
  });
  if (!enquiry) return null;

  // The current revision per supplier. Earlier ones live in the thread.
  const latestByBusiness = new Map<string, (typeof enquiry.quotes)[number]>();
  for (const quote of enquiry.quotes) {
    if (!latestByBusiness.has(quote.businessId)) latestByBusiness.set(quote.businessId, quote);
  }

  const totalLines = enquiry._count.lines;

  const recipients: TrackedRecipient[] = enquiry.recipients.map((recipient) => {
    const quote = latestByBusiness.get(recipient.businessId);
    return {
      businessId: recipient.businessId,
      slug: recipient.business.slug,
      /* The display name, as everywhere. Each row links to that storefront. */
      displayName: recipient.business.displayName,
      state: recipient.state,
      openedAt: recipient.openedAt,
      buyerNudgedAt: recipient.buyerNudgedAt,
      /*
         Delivery is the recipient row's own creation. `EnquiryRecipient` is
         written in the same transaction as the enquiry, so this is the moment
         the supplier was reachable — which is the clock both the nudge floor
         and the latency figure run on.
      */
      deliveredAt: recipient.createdAt,
      quotedAt: quote?.sentAt ?? null,
      quotedLines: quote?._count.lines ?? 0,
      totalLines,
      /* The seller's own words. "Outside their range" beats silence. */
      declineReason: quote?.lostReason ?? null,
      superseded: quote?.supersededAt != null,
      quotedAgainstRevision: quote?.againstRevision ?? enquiry.revision,
    };
  });

  return {
    enquiryId: enquiry.id,
    ref: enquiry.ref,
    closesAt: enquiry.closesAt,
    totalLines,
    accepted: enquiry.contactReleasedToBusinessId !== null,
    revision: enquiry.revision,
    revisedAt: enquiry.revisedAt,
    recipients,
  };
}
