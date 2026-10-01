import "server-only";
import { parseSnapshot } from "@/lib/buyer-company/address";
import { prisma } from "@/lib/db/client";
import {
  chooseContactLocation,
  recordLines,
  type AcceptedRecord,
  type RecordReport,
  type RecordReview,
} from "@/lib/enquiry/accepted-record";
import { extractCommitments } from "@/lib/quote/commitments";
import { PROPOSAL_RECORD_SELECT, toProposalRecord } from "@/lib/quote/proposal";
import { familyFor } from "@/lib/services/service";
import { ENQUIRY_BRIEF_SELECT, toEnquiryBrief } from "./enquiry-brief";
import { acceptedInPart, coveredLines } from "@/lib/enquiry/release";

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
 * **Board `1o` D4: one record per supplier.** An enquiry accepted across
 * suppliers has a record for each; `businessId` names whose, and without it the
 * enquiry's main supplier is read. The record is that supplier's alone — their
 * lines, their PO number, their contact, their review and report — and a
 * supplier the buyer's contact did not go to has no record, the same null.
 *
 * **AC9: the record survives the supplier being suspended or unverified.**
 * Nothing here filters on `suspendedAt` or `verificationTier`. The lines are
 * the `QuoteLine` rows as quoted; rewriting them because the supplier's standing
 * changed would destroy the evidence the page exists to keep.
 */
export async function getAcceptedRecord(
  buyerId: string,
  refOrId: string,
  /** Board `1o` D4: whose record, after a split. Absent: the enquiry's main supplier. */
  businessId?: string,
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
      costCode: true,
      deliverySnapshot: true,
      contactReleasedAt: true,
      contactReleasedToBusinessId: true,
      emirate: true,
      area: { select: { name: true } },
      // Board `7c-s`: the brief's site, engagement, cadence and start — the term's dates come from here.
      serviceBrief: {
        select: { ...ENQUIRY_BRIEF_SELECT, categoryId: true, category: { select: { name: true, slug: true } } },
      },
      // The trade of a service enquiry sent without a brief, from the service a line named.
      lines: {
        where: { serviceId: { not: null } },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        take: 1,
        select: { service: { select: { categoryId: true, category: { select: { slug: true } } } } },
      },
      quotes: {
        where: { status: "accepted" },
        /*
           One accepted quote per supplier: `commitAcceptance` claims the row
           conditionally, and a split accepts one quote from each supplier it
           takes lines from (board `1o`). Ordered anyway, so a pre-fix double
           accept still reads the same row every time rather than whichever
           Postgres returns.
        */
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
          buyerReference: true,
          lines: {
            orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
            select: {
              id: true,
              description: true,
              qty: true,
              unitPrice: true,
              leadTimeDays: true,
              productId: true,
              enquiryLineId: true,
              acceptedAt: true,
              product: { select: { sku: true } },
            },
          },
          business: { select: { id: true, slug: true, displayName: true } },
          proposal: {
            select: {
              ...PROPOSAL_RECORD_SELECT,
              service: { select: { slug: true, status: true, businessId: true } },
            },
          },
        },
      },
      recipients: {
        orderBy: [{ createdAt: "asc" }, { businessId: "asc" }],
        select: {
          businessId: true,
          state: true,
          declinedAt: true,
          contactReleasedAt: true,
          business: { select: { slug: true, displayName: true } },
        },
      },
      // Board `1o` D6 and D4: one review and one report per supplier; this record's is picked below.
      reviews: { select: { businessId: true, createdAt: true, heldAt: true, removedAt: true } },
      supplierReports: {
        select: { subjectBusinessId: true, createdAt: true, outcome: true, outcomeReason: true, resolvedAt: true },
      },
    },
  });
  if (!enquiry) return null;

  /*
     Board `1o` D4: whose record. Only a supplier the buyer's contact went to has
     one — their own recipient row says so — and anybody else is the same null
     as a reference that does not exist.
  */
  const released = enquiry.recipients.filter((recipient) => recipient.contactReleasedAt !== null);
  const releasedTo = businessId ?? enquiry.contactReleasedToBusinessId!;
  if (!released.some((recipient) => recipient.businessId === releasedTo)) return null;
  const quote = enquiry.quotes.find((q) => q.businessId === releasedTo);
  if (!quote) return null;
  const acceptedIds = new Set(released.map((recipient) => recipient.businessId));

  const proposal = toProposalRecord(quote.proposal);
  const categoryId = enquiry.serviceBrief?.categoryId ?? enquiry.lines[0]?.service?.categoryId ?? null;

  const [routed, locations, team, messages, family] = await Promise.all([
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
        /*
           The supplier's side of the thread, stated when it was written. A seat
           filter dropped every commitment made by somebody who has since left
           the supplier's team — the dated words a buyer holds them to.
        */
        authorSide: "seller",
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 60,
      select: { id: true, body: true, createdAt: true },
    }),
    // Only a proposal reads the scope sheet's words, and only when a trade is known.
    proposal && categoryId ? familyFor(categoryId) : Promise.resolve(null),
  ]);

  const location = chooseContactLocation(locations, routed?.assignedTo?.branchId ?? null);
  // A consented person at that location first, then one named for the whole business.
  const person =
    (location ? team.find((member) => member.locationId === location.id) : undefined) ??
    team.find((member) => member.locationId === null) ??
    null;

  /*
     The lines this acceptance covered: the whole quote, or — board `1o` — the
     lines taken from this supplier with the lines they added (D7). A line the
     buyer did not take from them is not theirs to supply and is not on it.
  */
  const covered = coveredLines(quote.lines);
  const { lines, totalAed } = recordLines(
    covered.map((line) => ({
      id: line.id,
      description: line.description,
      qty: line.qty,
      unitPrice: line.unitPrice.toFixed(2),
      leadTimeDays: line.leadTimeDays,
      productId: line.productId,
      sku: line.product?.sku ?? null,
    })),
  );

  /*
     AC6: the buyer's lines no acceptance covered. Only acceptances since `1o`
     mark their lines, so a record from before it has nothing to compare and
     says nothing rather than guessing.
  */
  const marked = enquiry.quotes.flatMap((q) => q.lines.filter((line) => line.acceptedAt !== null));
  const linesNotAccepted =
    marked.length > 0
      ? (
          await prisma.enquiryLine.findMany({
            where: { enquiryId: enquiry.id, id: { notIn: marked.flatMap((line) => (line.enquiryLineId ? [line.enquiryLineId] : [])) } },
            orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
            select: { description: true },
          })
        ).map((line) => line.description)
      : [];

  return {
    enquiryId: enquiry.id,
    ref: enquiry.ref,
    // Board `1o` D5: the PO issued to this supplier; acceptances before it wrote the enquiry's.
    buyerReference: quote.buyerReference ?? enquiry.buyerReference,
    costCode: enquiry.costCode,
    delivery: parseSnapshot(enquiry.deliverySnapshot),
    // The quote's own stamp first, then the release — the pair the tracking page reads.
    acceptedAt: quote.acceptedAt ?? enquiry.contactReleasedAt,
    isBrief: enquiry.serviceBrief !== null,
    /*
       Declined *by this acceptance*. A supplier who declined the enquiry
       themselves (board `3j-s`) was not declined for the buyer, and *the other
       3 were declined for you* would count them as if they were — nor is a
       supplier accepted from in the same split.
    */
    declinedCount: enquiry.recipients.filter(
      (r) => r.state === "declined" && r.declinedAt === null && !acceptedIds.has(r.businessId),
    ).length,
    acceptedFrom: released.map((recipient) => ({
      businessId: recipient.businessId,
      slug: recipient.business.slug,
      displayName: recipient.business.displayName,
    })),
    partOfQuote: acceptedInPart(quote.lines),
    linesNotAccepted,
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
      proposal,
    },
    work: proposal
      ? {
          brief: toEnquiryBrief(enquiry.serviceBrief, enquiry),
          site: {
            building: enquiry.serviceBrief?.building ?? null,
            areaName: enquiry.area?.name ?? null,
            emirate: enquiry.emirate,
          },
          turnaroundLabel: family?.rows.find((row) => row.key === "turnaround")?.label ?? "",
          tradeSlug: enquiry.serviceBrief?.category.slug ?? enquiry.lines[0]?.service?.category.slug ?? null,
          // A link to brief the firm again only while the service is theirs and live.
          serviceSlug:
            quote.proposal?.service &&
            quote.proposal.service.status === "live" &&
            quote.proposal.service.businessId === releasedTo
              ? quote.proposal.service.slug
              : null,
        }
      : null,
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
    review: reviewState(enquiry.reviews.find((review) => review.businessId === releasedTo) ?? null),
    report: reportState(enquiry.supplierReports.find((report) => report.subjectBusinessId === releasedTo) ?? null),
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
    outcome: "seller_corrected" | "upheld" | "no_action" | "duplicate" | null;
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

/**
 * Board `1o` D4 — the record `?supplier=` names, by the slug the buyer's links
 * carry. The main supplier's record without one, or with theirs; another
 * supplier's only where the buyer accepted from them, and otherwise the same
 * null as a record that does not exist.
 */
export async function getAcceptedRecordFor(
  buyerId: string,
  refOrId: string,
  supplierSlug: string | null,
): Promise<AcceptedRecord | null> {
  const main = await getAcceptedRecord(buyerId, refOrId);
  if (!main || !supplierSlug || supplierSlug === main.supplier.slug) return main;
  const other = main.acceptedFrom.find((supplier) => supplier.slug === supplierSlug);
  return other ? getAcceptedRecord(buyerId, refOrId, other.businessId) : null;
}
