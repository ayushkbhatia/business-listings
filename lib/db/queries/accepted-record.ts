import "server-only";
import { prisma } from "@/lib/db/client";
import {
  chooseContactLocation,
  recordLines,
  type AcceptedRecord,
  type RecordReport,
  type RecordReview,
} from "@/lib/enquiry/accepted-record";
import { extractCommitments } from "@/lib/quote/commitments";

/**
 * Board `7c` — read the accepted record for the buyer who accepted it.
 *
 * **`B6`: contact details are visible only to the accepting buyer, only for the
 * accepted supplier, and only after acceptance.** All three are in the `where`:
 * the buyer id, `contactReleasedToBusinessId` not null, and the quote read is
 * the accepted one *of that business*. An unknown reference and somebody else's
 * enquiry are the same null, so the route cannot be used to find out which
 * references exist.
 *
 * **AC9: the record survives the supplier being suspended or unverified.**
 * Nothing here filters on `suspendedAt` or `verificationTier`. The lines are
 * the `QuoteLine` rows as quoted; rewriting them because the supplier's standing
 * changed would destroy the evidence the page exists to keep.
 */
export async function getAcceptedRecord(
  buyerId: string,
  refOrId: string,
): Promise<AcceptedRecord | null> {
  const enquiry = await prisma.enquiry.findFirst({
    where: {
      OR: [{ ref: refOrId }, { id: refOrId }],
      buyerId,
      contactReleasedToBusinessId: { not: null },
    },
    select: {
      id: true,
      ref: true,
      buyerReference: true,
      contactReleasedAt: true,
      contactReleasedToBusinessId: true,
      serviceBrief: { select: { enquiryId: true } },
      quotes: {
        where: { status: "accepted" },
        // One accepted quote per enquiry since `acceptQuote` claims the row
        // conditionally. Ordered anyway, so a pre-fix double accept still reads
        // the same row every time rather than whichever Postgres returns.
        orderBy: [{ acceptedAt: "desc" }, { revision: "desc" }, { id: "asc" }],
        select: {
          id: true,
          ref: true,
          businessId: true,
          revision: true,
          note: true,
          paymentTerms: true,
          delivery: true,
          validityDays: true,
          sentAt: true,
          expiresAt: true,
          acceptedAt: true,
          lines: {
            orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
            select: {
              id: true,
              description: true,
              qty: true,
              unitPrice: true,
              leadTimeDays: true,
              productId: true,
              product: { select: { sku: true } },
            },
          },
          business: { select: { id: true, slug: true, displayName: true } },
        },
      },
      recipients: {
        where: { state: "declined" },
        select: { businessId: true },
      },
      review: { select: { createdAt: true, heldAt: true, removedAt: true } },
      supplierReport: {
        select: { createdAt: true, outcome: true, outcomeReason: true, resolvedAt: true },
      },
    },
  });
  if (!enquiry) return null;

  const releasedTo = enquiry.contactReleasedToBusinessId!;
  const quote = enquiry.quotes.find((q) => q.businessId === releasedTo);
  if (!quote) return null;

  const [routed, locations, team, messages] = await Promise.all([
    prisma.enquiryRecipient.findUnique({
      where: { enquiryId_businessId: { enquiryId: enquiry.id, businessId: releasedTo } },
      select: { assignedTo: { select: { branchId: true } } },
    }),
    prisma.location.findMany({
      where: { businessId: releasedTo, published: true },
      select: {
        id: true,
        type: true,
        addressLine: true,
        emirate: true,
        phone: true,
        whatsapp: true,
        createdAt: true,
        area: { select: { name: true } },
      },
    }),
    prisma.teamMember.findMany({
      where: { businessId: releasedTo },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: { name: true, role: true, phone: true, locationId: true },
    }),
    /*
       The supplier's own words, and nothing else: messages from a seat of the
       released business, never the buyer's, never an automatic follow-up (the
       seller did not type it at the moment it went), never one the off-platform
       detector flagged. Newest first and capped, because the rail shows five.
    */
    prisma.message.findMany({
      where: {
        enquiryId: enquiry.id,
        businessId: releasedTo,
        automatic: false,
        flaggedAt: null,
        sender: { businessId: releasedTo },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 60,
      select: { id: true, body: true, createdAt: true },
    }),
  ]);

  const location = chooseContactLocation(locations, routed?.assignedTo?.branchId ?? null);
  // A consented person at that location first, then one named for the whole business.
  const person =
    (location ? team.find((member) => member.locationId === location.id) : undefined) ??
    team.find((member) => member.locationId === null) ??
    null;

  const { lines, totalAed } = recordLines(
    quote.lines.map((line) => ({
      id: line.id,
      description: line.description,
      qty: line.qty,
      unitPrice: line.unitPrice.toFixed(2),
      leadTimeDays: line.leadTimeDays,
      productId: line.productId,
      sku: line.product?.sku ?? null,
    })),
  );

  return {
    enquiryId: enquiry.id,
    ref: enquiry.ref,
    buyerReference: enquiry.buyerReference,
    // The quote's own stamp first, then the release — the pair the tracking page reads.
    acceptedAt: quote.acceptedAt ?? enquiry.contactReleasedAt,
    isBrief: enquiry.serviceBrief !== null,
    declinedCount: enquiry.recipients.filter((r) => r.businessId !== releasedTo).length,
    quote: {
      id: quote.id,
      ref: quote.ref,
      revision: quote.revision,
      note: quote.note,
      paymentTerms: quote.paymentTerms,
      delivery: quote.delivery,
      validityDays: quote.validityDays,
      sentAt: quote.sentAt,
      expiresAt: quote.expiresAt,
      lines,
      totalAed,
    },
    supplier: {
      id: quote.business.id,
      slug: quote.business.slug,
      displayName: quote.business.displayName,
      person: person ? { name: person.name, role: person.role, phone: person.phone } : null,
      phone: location?.phone ?? null,
      whatsapp: location?.whatsapp ?? null,
      location: location
        ? {
            type: location.type,
            addressLine: location.addressLine,
            areaName: location.area?.name ?? null,
            emirate: location.emirate,
          }
        : null,
    },
    commitments: extractCommitments(messages),
    review: reviewState(enquiry.review),
    report: reportState(enquiry.supplierReport),
  };
}

function reviewState(
  review: { createdAt: Date; heldAt: Date | null; removedAt: Date | null } | null,
): RecordReview {
  if (!review) return { kind: "none" };
  if (review.removedAt) return { kind: "removed", postedAt: review.createdAt };
  if (review.heldAt) return { kind: "held", postedAt: review.createdAt };
  return { kind: "posted", postedAt: review.createdAt };
}

function reportState(
  report: {
    createdAt: Date;
    outcome: "seller_corrected" | "upheld" | "no_action" | null;
    outcomeReason: string | null;
    resolvedAt: Date | null;
  } | null,
): RecordReport {
  if (!report) return { kind: "none" };
  if (report.outcome && report.resolvedAt) {
    return {
      kind: "resolved",
      filedAt: report.createdAt,
      outcome: report.outcome,
      reason: report.outcomeReason ?? "",
      resolvedAt: report.resolvedAt,
    };
  }
  return { kind: "open", filedAt: report.createdAt };
}
