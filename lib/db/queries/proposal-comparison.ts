import "server-only";
import { prisma } from "@/lib/db/client";
import { familyFor } from "@/lib/services/service";
import { PROPOSAL_RECORD_SELECT, toProposalRecord, type ProposalRecord } from "@/lib/quote/proposal";
import { VERIFIED_TIER } from "@/lib/verification";
import { ENQUIRY_BRIEF_SELECT, toEnquiryBrief, type EnquiryBrief } from "./enquiry-brief";
import { STANDING_CREDENTIAL } from "@/lib/credentials/kinds";

/**
 * Board `1n-s` — everything the buyer's comparison of proposals reads, for the
 * buyer who sent the enquiry and nobody else.
 *
 * Reads only. The page puts the figures side by side; this decides nothing about
 * which is better, and returns the columns in **arrival order** — the order the
 * proposals came back — because any other order is a ranking (B7).
 *
 * An unknown reference and somebody else's enquiry are the same null.
 */

export interface ComparisonCredential {
  kind: string;
  issuer: string | null;
  identifier: string | null;
  /** Checked against a register. Everything else is the firm's own claim. */
  verified: boolean;
}

export interface ComparisonColumn {
  businessId: string;
  slug: string;
  /** Seller identity is `displayName`, here as everywhere. */
  displayName: string;
  /** Tier 2 and a licence not yet expired — the line `8b-s` prints as *Licence verified*. */
  licenceVerified: boolean;
  credentials: ComparisonCredential[];
  /** The supplier's current revision. Earlier ones are in the thread. */
  quote: {
    id: string;
    ref: string;
    revision: number;
    status: string;
    sentAt: Date | null;
    expiresAt: Date | null;
    /** Board `7c-s`: how the buyer would pay. Null is *Not stated*. */
    paymentTerms: string | null;
  };
  proposal: ProposalRecord;
  /** When their first proposal arrived — the column order. */
  arrivedAt: Date;
  /** Enquiry delivered to their first reply, measured. Null if it cannot be. */
  repliedInMs: number | null;
  state: "open" | "expired" | "accepted" | "declined";
}

export interface ComparisonRecipient {
  businessId: string;
  displayName: string;
  /** Set when the supplier declined themselves, with their words. */
  declineReason: string | null;
}

export interface ProposalComparison {
  enquiryId: string;
  ref: string;
  requirement: string;
  createdAt: Date;
  closesAt: Date;
  scale: string | null;
  brief: EnquiryBrief | null;
  /** The subcategory the work is in, from the brief or from the service a line named. */
  subcategoryName: string;
  /** How the trade's scope sheet words its turnaround — *Response time*, *Clearance time*. */
  turnaroundLabel: string;
  engagementType: string | null;
  cadence: string | null;
  acceptedBusinessId: string | null;
  recipientCount: number;
  columns: ComparisonColumn[];
  /** Suppliers who declined the enquiry themselves. */
  declined: ComparisonRecipient[];
  /** Suppliers who have neither proposed nor declined. Empty once one is accepted. */
  waiting: ComparisonRecipient[];
  /** Sent to the first proposal back, measured. */
  firstProposalInMs: number | null;
}

export async function getProposalComparison(
  buyerId: string,
  refOrId: string,
  now: Date = new Date(),
): Promise<ProposalComparison | null> {
  const enquiry = await prisma.enquiry.findFirst({
    where: { OR: [{ ref: refOrId }, { id: refOrId }], buyerId },
    select: {
      id: true,
      ref: true,
      requirement: true,
      createdAt: true,
      closesAt: true,
      scale: true,
      emirate: true,
      area: { select: { name: true } },
      contactReleasedToBusinessId: true,
      serviceBrief: { select: { ...ENQUIRY_BRIEF_SELECT, categoryId: true } },
      lines: {
        where: { serviceId: { not: null } },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        take: 1,
        select: { service: { select: { categoryId: true, category: { select: { name: true } } } } },
      },
      recipients: {
        orderBy: [{ createdAt: "asc" }, { businessId: "asc" }],
        select: {
          businessId: true,
          state: true,
          createdAt: true,
          firstReplyAt: true,
          declinedAt: true,
          declineReason: true,
          business: {
            select: { slug: true, displayName: true, verificationTier: true, licenceExpiry: true },
          },
        },
      },
      quotes: {
        where: { status: { not: "draft" }, proposal: { isNot: null } },
        orderBy: [{ businessId: "asc" }, { revision: "desc" }],
        select: {
          id: true,
          ref: true,
          revision: true,
          status: true,
          sentAt: true,
          createdAt: true,
          expiresAt: true,
          paymentTerms: true,
          businessId: true,
          proposal: { select: PROPOSAL_RECORD_SELECT },
        },
      },
    },
  });
  if (!enquiry) return null;

  const categoryId = enquiry.serviceBrief?.categoryId ?? enquiry.lines[0]?.service?.categoryId ?? null;
  // An enquiry for things is compared on the goods board, not here.
  if (!categoryId) return null;

  const businessIds = [...new Set(enquiry.quotes.map((q) => q.businessId))];
  const [family, credentials] = await Promise.all([
    familyFor(categoryId),
    businessIds.length === 0
      ? Promise.resolve([])
      : prisma.credential.findMany({
          where: { businessId: { in: businessIds }, ...STANDING_CREDENTIAL },
          // Checked first, then the order the credentials form offers them.
          orderBy: [{ trust: "asc" }, { kind: "asc" }, { createdAt: "asc" }, { id: "asc" }],
          select: { businessId: true, kind: true, issuer: true, identifier: true, trust: true },
        }),
  ]);

  const recipients = new Map(enquiry.recipients.map((r) => [r.businessId, r]));
  const columns: ComparisonColumn[] = [];
  for (const businessId of businessIds) {
    const quotes = enquiry.quotes.filter((q) => q.businessId === businessId);
    const current = quotes[0]!;
    const proposal = toProposalRecord(current.proposal);
    const recipient = recipients.get(businessId);
    if (!proposal || !recipient) continue;

    const arrivedAt = quotes
      .map((q) => q.sentAt ?? q.createdAt)
      .reduce((earliest, at) => (at.getTime() < earliest.getTime() ? at : earliest));
    const accepted = enquiry.contactReleasedToBusinessId;

    columns.push({
      businessId,
      slug: recipient.business.slug,
      displayName: recipient.business.displayName,
      licenceVerified:
        recipient.business.verificationTier >= VERIFIED_TIER &&
        recipient.business.licenceExpiry.getTime() > now.getTime(),
      credentials: credentials
        .filter((c) => c.businessId === businessId)
        .map((c) => ({
          kind: c.kind,
          issuer: c.issuer,
          identifier: c.identifier,
          verified: c.trust === "register_verified",
        })),
      quote: {
        id: current.id,
        ref: current.ref,
        revision: current.revision,
        status: current.status,
        sentAt: current.sentAt,
        expiresAt: current.expiresAt,
        paymentTerms: current.paymentTerms,
      },
      proposal,
      arrivedAt,
      repliedInMs: recipient.firstReplyAt
        ? Math.max(0, recipient.firstReplyAt.getTime() - recipient.createdAt.getTime())
        : null,
      state:
        accepted !== null
          ? accepted === businessId
            ? "accepted"
            : "declined"
          : current.status === "expired" ||
              (current.expiresAt !== null && current.expiresAt.getTime() <= now.getTime())
            ? "expired"
            : "open",
    });
  }
  // Arrival order, and a tie is settled by the id rather than by chance.
  columns.sort(
    (a, b) => a.arrivedAt.getTime() - b.arrivedAt.getTime() || a.businessId.localeCompare(b.businessId),
  );

  const proposed = new Set(columns.map((c) => c.businessId));
  const declined = enquiry.recipients
    .filter((r) => r.declinedAt !== null && !proposed.has(r.businessId))
    .map((r) => ({ businessId: r.businessId, displayName: r.business.displayName, declineReason: r.declineReason }));
  const waiting =
    enquiry.contactReleasedToBusinessId !== null
      ? []
      : enquiry.recipients
          .filter((r) => r.declinedAt === null && !proposed.has(r.businessId))
          .map((r) => ({ businessId: r.businessId, displayName: r.business.displayName, declineReason: null }));

  const firstArrival = columns[0]?.arrivedAt ?? null;
  const subcategoryName = enquiry.serviceBrief?.category.name ?? enquiry.lines[0]?.service?.category.name ?? "";

  return {
    enquiryId: enquiry.id,
    ref: enquiry.ref,
    requirement: enquiry.requirement,
    createdAt: enquiry.createdAt,
    closesAt: enquiry.closesAt,
    scale: enquiry.scale,
    brief: toEnquiryBrief(enquiry.serviceBrief, enquiry),
    subcategoryName,
    turnaroundLabel: family.rows.find((row) => row.key === "turnaround")?.label ?? "",
    engagementType: enquiry.serviceBrief?.engagementType ?? null,
    cadence: enquiry.serviceBrief?.cadence ?? null,
    acceptedBusinessId: enquiry.contactReleasedToBusinessId,
    recipientCount: enquiry.recipients.length,
    columns,
    declined,
    waiting,
    firstProposalInMs: firstArrival ? Math.max(0, firstArrival.getTime() - enquiry.createdAt.getTime()) : null,
  };
}
