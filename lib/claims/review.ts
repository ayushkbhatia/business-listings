import "server-only";
import { prisma } from "@/lib/db/client";
import { Prisma, type ClaimOutcome, type ClaimPartyReason, type ClaimResolution } from "@/lib/db/generated/client";
import { dubaiDayStart } from "@/lib/format";
import { normaliseLicenceNumber } from "@/lib/verification/licence/number";
import { conflictClock, type ConflictClock } from "./clock";
import { registerEntriesFor, sourceRecordFor, type RegisterHit, type SourceFacts } from "./records";
import {
  assess,
  emailDomain,
  looksLikeBranchOf,
  scoreClaim,
  type Assessment,
  type ClaimFacts,
  type ScoredClaim,
} from "./signals";

/**
 * Board 4c — everything the conflict screen puts in front of the decision,
 * read once (Phase 2.1's read model).
 *
 * Every figure here is a query or is computed from one, at the moment the
 * screen is read: the signals and the strength tags (`B5`), whether each claim
 * holds the source licence (§Flagged 1), the clock (`B8`), the enquiries waiting
 * on the listing counted once in one unit (`B9`), and the decision log, which
 * is a read of claim events and audit rows and is never authored (`B14`).
 */

const DAY_MS = 86_400_000;

export type ConflictState = "open" | "docs_requested" | "escalated" | "resolved" | "dissolved";

export interface ClaimSide {
  id: string;
  /** `A`, `B`, `C` — by arrival, the way the board names them. */
  label: string;
  claimantName: string | null;
  accountName: string | null;
  role: string | null;
  route: "licence_upload" | "phone_callback";
  phone: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  outcome: ClaimOutcome | null;
  partyReason: ClaimPartyReason | null;
  licenceNumber: string | null;
  licenceExpiry: Date | null;
  document: { filename: string } | null;
  tenancyDocument: { filename: string; createdAt: Date } | null;
  register: RegisterHit | null;
  scored: ScoredClaim;
  /** The claim that turned a claim into a conflict: the race's second, or the challenger. */
  opened: boolean;
  /** Still a side: undecided. */
  live: boolean;
  /** `B13`'s hint, against the source licence: a branch licence usually carries its parent's number. */
  branchOfSource: boolean;
}

export type LogEntry =
  | { kind: "claim_received"; at: Date; claim: string; opened: boolean }
  | { kind: "claim_withdrawn"; at: Date; claim: string }
  | { kind: "tenancy_received"; at: Date; claim: string }
  | { kind: "call"; at: Date; actor: string | null; claim: string | null; to: string; confirmed: boolean }
  | { kind: "assigned"; at: Date; actor: string | null; to: string | null }
  | { kind: "docs_requested"; at: Date; actor: string | null }
  | { kind: "escalated"; at: Date; actor: string | null; to: string | null }
  | { kind: "resolved"; at: Date; actor: string | null; resolution: string | null }
  | { kind: "dissolved"; at: Date };

export interface ConflictReview {
  id: string;
  state: ConflictState;
  challenge: boolean;
  business: {
    id: string;
    displayName: string;
    /** licence-locked — the record the claims are measured against */
    tradeName: string;
    slug: string;
    claimStatus: string;
    licenceNumber: string;
    licenceAuthority: string;
    areaName: string | null;
    emirate: string | null;
  };
  source: SourceFacts;
  incumbent: { name: string | null; since: Date | null } | null;
  claims: ClaimSide[];
  assessment: Assessment;
  clock: ConflictClock;
  listing: {
    views30d: number;
    reviewCount: number;
    rating: number | null;
    /** Enquiries waiting on a first reply, and the people who sent them — one query (`B9`). */
    waitingEnquiries: number;
    waitingBuyers: number;
  };
  escalation: { at: Date; to: string | null; by: string | null; note: string } | null;
  docsRequest: { at: Date; by: string | null; note: string; receivedAt: Date | null } | null;
  resolution: {
    kind: ClaimResolution;
    at: Date;
    by: string | null;
    note: string;
    awardedId: string | null;
    secondId: string | null;
    producedBusiness: { slug: string; displayName: string } | null;
    producedLocationId: string | null;
    enquiriesReleased: number;
    /** Deliveries written for the outcome messages — `B3`'s every claimant, counted. */
    notifications: number;
  } | null;
  dissolvedAt: Date | null;
  log: LogEntry[];
}

const LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function readJson(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function conflictReviewFor(conflictId: string, now: Date = new Date()): Promise<ConflictReview | null> {
  const conflict = await prisma.claimConflict.findUnique({
    where: { id: conflictId },
    select: {
      id: true,
      businessId: true,
      challenge: true,
      createdAt: true,
      submissionAId: true,
      submissionBId: true,
      resolution: true,
      resolvedAt: true,
      reason: true,
      awardedSubmissionId: true,
      secondSubmissionId: true,
      producedLocationId: true,
      buyersWaiting: true,
      escalatedAt: true,
      escalationNote: true,
      docsRequestedAt: true,
      docsRequestNote: true,
      docsReceivedAt: true,
      dissolvedAt: true,
      resolvedBy: { select: { fullName: true } },
      escalatedTo: { select: { fullName: true } },
      escalatedBy: { select: { fullName: true } },
      docsRequestedBy: { select: { fullName: true } },
      incumbent: { select: { fullName: true, createdAt: true } },
      producedBusiness: { select: { slug: true, displayName: true } },
      business: {
        select: {
          id: true,
          displayName: true,
          tradeName: true,
          slug: true,
          claimStatus: true,
          licenceNumber: true,
          licenceAuthority: true,
          reviewCount: true,
          ratingOverall: true,
          locations: {
            orderBy: [{ published: "desc" }, { createdAt: "asc" }, { id: "asc" }],
            take: 1,
            select: { emirate: true, area: { select: { name: true } } },
          },
        },
      },
    },
  });
  if (!conflict) return null;

  const sides = [conflict.submissionAId, conflict.submissionBId].filter((id): id is string => id !== null);
  const [claims, source, audits, views, waiting, ownerSince] = await Promise.all([
    prisma.claimSubmission.findMany({
      where: { OR: [{ conflictId }, { id: { in: sides } }] },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        route: true,
        phone: true,
        createdAt: true,
        decidedAt: true,
        outcome: true,
        partyReason: true,
        claimantId: true,
        claimantName: true,
        claimantRole: true,
        statedLicenceNumber: true,
        ocrLicenceNumber: true,
        statedLicenceExpiry: true,
        ocrLicenceExpiry: true,
        claimant: { select: { fullName: true, email: true } },
        document: { select: { filename: true } },
        tenancyDocument: { select: { filename: true, createdAt: true } },
      },
    }),
    sourceRecordFor(conflict.businessId),
    prisma.auditEvent.findMany({
      where: { subject: `ClaimConflict:${conflictId}` },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { action: true, createdAt: true, after: true, actor: { select: { fullName: true } } },
    }),
    prisma.listingViewDay.aggregate({
      where: { businessId: conflict.businessId, day: { gte: new Date(dubaiDayStart(now).getTime() - 30 * DAY_MS) } },
      _sum: { views: true },
    }),
    /*
       B9: one query and one unit. The row counts enquiries waiting on a first
       reply; the sentence beside it counts the people who sent them — and both
       come from here, so the two can never disagree about what they counted.
    */
    prisma.$queryRaw<{ enquiries: bigint; buyers: bigint }[]>(Prisma.sql`
      SELECT COUNT(*) AS enquiries, COUNT(DISTINCT e."buyer_id") AS buyers
        FROM "enquiry_recipient" r
        JOIN "enquiry" e ON e."id" = r."enquiry_id"
       WHERE r."business_id" = ${conflict.businessId}
         AND r."state" IN ('delivered', 'opened')
    `),
    conflict.challenge
      ? prisma.claimSubmission.findFirst({
          where: { businessId: conflict.businessId, outcome: "approved" },
          orderBy: [{ decidedAt: "desc" }, { id: "desc" }],
          select: { decidedAt: true },
        })
      : Promise.resolve(null),
  ]);
  if (!source) return null;

  const authority = conflict.business.licenceAuthority;
  const licenceOf = (claim: (typeof claims)[number]) => {
    const raw = claim.statedLicenceNumber ?? claim.ocrLicenceNumber;
    if (!raw) return null;
    const normalised = normaliseLicenceNumber(raw, authority);
    return normalised.ok ? normalised.value : raw.trim();
  };
  const register = await registerEntriesFor(
    claims.flatMap((claim) => {
      const number = licenceOf(claim);
      return number ? [{ number, authority }] : [];
    }),
  );
  const registerFor = (number: string | null) => (number ? (register.get(number.replace(/\D/g, "")) ?? null) : null);

  // The latest call to each claim, from the audit rows that recorded it (B7).
  const calls = new Map<string, { to: "public_record" | "claimant_supplied"; confirmed: boolean }>();
  for (const audit of audits) {
    if (audit.action !== "claim_call_logged") continue;
    const after = readJson(audit.after);
    if (typeof after.claim === "string" && (after.to === "public_record" || after.to === "claimant_supplied")) {
      calls.set(after.claim, { to: after.to, confirmed: after.confirmed === true });
    }
  }

  const openedId = conflict.challenge ? conflict.submissionAId : (conflict.submissionBId ?? null);
  const sidesOut: ClaimSide[] = claims.map((claim, index) => {
    const licenceNumber = licenceOf(claim);
    const entry = registerFor(licenceNumber);
    const facts: ClaimFacts = {
      id: claim.id,
      route: claim.route,
      licenceNumber,
      licenceExpiry: claim.statedLicenceExpiry ?? claim.ocrLicenceExpiry ?? null,
      calledNumber: claim.route === "phone_callback" ? claim.phone : null,
      register: entry,
      emailDomain: emailDomain(claim.claimant.email),
      call: calls.get(claim.id) ?? null,
    };
    return {
      id: claim.id,
      label: LABELS[index] ?? String(index + 1),
      claimantName: claim.claimantName,
      accountName: claim.claimant.fullName,
      role: claim.claimantRole,
      route: claim.route,
      phone: claim.phone,
      createdAt: claim.createdAt,
      decidedAt: claim.decidedAt,
      outcome: claim.outcome,
      partyReason: claim.partyReason,
      licenceNumber,
      licenceExpiry: facts.licenceExpiry,
      document: claim.document,
      tenancyDocument: claim.tenancyDocument,
      register: entry,
      scored: scoreClaim(facts, source.record, now),
      opened: claim.id === openedId,
      live: claim.decidedAt === null,
      branchOfSource: licenceNumber ? looksLikeBranchOf(licenceNumber, source.record.licenceNumber) : false,
    };
  });

  // Withdrawn claims are history, not sides. Once decided, every side that was one is assessed as it stood.
  const assessed = sidesOut.filter((side) => side.outcome !== "withdrawn");
  const assessment = assess(assessed.map((side) => side.scored));

  const state: ConflictState = conflict.resolvedAt
    ? "resolved"
    : conflict.dissolvedAt
      ? "dissolved"
      : conflict.escalatedAt
        ? "escalated"
        : conflict.docsRequestedAt && !conflict.docsReceivedAt
          ? "docs_requested"
          : "open";

  const labelOf = new Map(sidesOut.map((side) => [side.id, side.label]));
  const log: LogEntry[] = [];
  for (const side of sidesOut) {
    log.push({ kind: "claim_received", at: side.createdAt, claim: side.label, opened: side.opened });
    if (side.tenancyDocument) log.push({ kind: "tenancy_received", at: side.tenancyDocument.createdAt, claim: side.label });
    if (side.outcome === "withdrawn" && side.decidedAt) log.push({ kind: "claim_withdrawn", at: side.decidedAt, claim: side.label });
  }
  for (const audit of audits) {
    const actor = audit.actor.fullName;
    const after = readJson(audit.after);
    switch (audit.action) {
      case "claim_call_logged":
        log.push({
          kind: "call",
          at: audit.createdAt,
          actor,
          claim: typeof after.claim === "string" ? (labelOf.get(after.claim) ?? null) : null,
          to: String(after.to ?? ""),
          confirmed: after.confirmed === true,
        });
        break;
      case "queue_reassigned":
        log.push({ kind: "assigned", at: audit.createdAt, actor, to: null });
        break;
      case "claim_docs_requested":
        log.push({ kind: "docs_requested", at: audit.createdAt, actor });
        break;
      case "claim_escalated":
        log.push({ kind: "escalated", at: audit.createdAt, actor, to: null });
        break;
      case "claim_resolved":
        log.push({ kind: "resolved", at: audit.createdAt, actor, resolution: typeof after.resolution === "string" ? after.resolution : null });
        break;
    }
  }
  if (conflict.dissolvedAt) log.push({ kind: "dissolved", at: conflict.dissolvedAt });
  log.sort((a, b) => a.at.getTime() - b.at.getTime());

  const head = conflict.business.locations[0];
  const counted = waiting[0];
  const notifications =
    conflict.resolvedAt && claims.length > 0
      ? await prisma.notificationDelivery.count({
          where: {
            event: { in: ["claim_awarded", "claim_not_awarded", "claim_new_listing_created"] },
            recipientUserId: { in: claims.map((claim) => claim.claimantId) },
            createdAt: { gte: conflict.resolvedAt },
          },
        })
      : 0;

  return {
    id: conflict.id,
    state,
    challenge: conflict.challenge,
    business: {
      id: conflict.business.id,
      displayName: conflict.business.displayName,
      tradeName: conflict.business.tradeName,
      slug: conflict.business.slug,
      claimStatus: conflict.business.claimStatus,
      licenceNumber: conflict.business.licenceNumber,
      licenceAuthority: conflict.business.licenceAuthority,
      areaName: head?.area?.name ?? null,
      emirate: head?.emirate ?? null,
    },
    source,
    incumbent: conflict.challenge
      ? { name: conflict.incumbent?.fullName ?? null, since: ownerSince?.decidedAt ?? conflict.incumbent?.createdAt ?? null }
      : null,
    claims: sidesOut,
    assessment,
    clock: conflictClock({ openedAt: conflict.createdAt, now: conflict.resolvedAt ?? conflict.dissolvedAt ?? now, escalatedAt: conflict.escalatedAt }),
    listing: {
      views30d: views._sum.views ?? 0,
      reviewCount: conflict.business.reviewCount,
      rating: conflict.business.ratingOverall,
      waitingEnquiries: Number(counted?.enquiries ?? 0),
      waitingBuyers: Number(counted?.buyers ?? 0),
    },
    escalation: conflict.escalatedAt
      ? {
          at: conflict.escalatedAt,
          to: conflict.escalatedTo?.fullName ?? null,
          by: conflict.escalatedBy?.fullName ?? null,
          note: conflict.escalationNote ?? "",
        }
      : null,
    docsRequest: conflict.docsRequestedAt
      ? {
          at: conflict.docsRequestedAt,
          by: conflict.docsRequestedBy?.fullName ?? null,
          note: conflict.docsRequestNote ?? "",
          receivedAt: conflict.docsReceivedAt,
        }
      : null,
    resolution:
      conflict.resolvedAt && conflict.resolution
        ? {
            kind: conflict.resolution,
            at: conflict.resolvedAt,
            by: conflict.resolvedBy?.fullName ?? null,
            note: conflict.reason ?? "",
            awardedId: conflict.awardedSubmissionId,
            secondId: conflict.secondSubmissionId,
            producedBusiness: conflict.producedBusiness,
            producedLocationId: conflict.producedLocationId,
            enquiriesReleased: conflict.buyersWaiting,
            notifications,
          }
        : null,
    dissolvedAt: conflict.dissolvedAt,
    log,
  };
}
