import "server-only";
import { prisma } from "@/lib/db/client";
import type { ModeratedField } from "@/lib/db/generated/enums";

/**
 * Board 4b, from the seller's side of the desk.
 *
 * Three of the queue's decisions only mean something if the person on the
 * other end reads them: a request for a document, a branch taken down, and a
 * claim that was not approved. A request nobody sees is a submission that
 * waits forever off the SLA clock — the worst of both — so each has a reader
 * here, and each reader is on the screen the seller would go to act on it.
 */

export interface DocumentRequest {
  subject: "change_request" | "credential";
  subjectId: string;
  /** What the request was about, for the sentence: a field, or a credential's name. */
  field: ModeratedField | null;
  credentialName: string | null;
  reason: string;
  requestedAt: Date;
}

/** Outstanding requests on a business's pending edits and credentials. */
export async function documentRequestsFor(businessId: string): Promise<DocumentRequest[]> {
  const items = await prisma.queueItem.findMany({
    where: {
      businessId,
      subjectType: { in: ["change_request", "credential"] },
      docsRequestedAt: { not: null },
      docsReceivedAt: null,
    },
    orderBy: [{ docsRequestedAt: "desc" }, { id: "asc" }],
    select: { subjectType: true, subjectId: true, docsRequestReason: true, docsRequestedAt: true },
  });
  if (items.length === 0) return [];

  const [changes, documents] = await Promise.all([
    prisma.listingChangeRequest.findMany({
      where: { id: { in: items.filter((item) => item.subjectType === "change_request").map((item) => item.subjectId) }, status: "pending" },
      select: { id: true, field: true },
    }),
    prisma.document.findMany({
      where: {
        id: { in: items.filter((item) => item.subjectType === "credential").map((item) => item.subjectId) },
        isPublic: true,
        reviewedAt: null,
      },
      select: { id: true, displayName: true, filename: true },
    }),
  ]);
  const fieldOf = new Map(changes.map((change) => [change.id, change.field]));
  const nameOf = new Map(documents.map((document) => [document.id, document.displayName ?? document.filename]));

  // Only requests on submissions still waiting: a withdrawn edit takes its request with it.
  return items.flatMap((item): DocumentRequest[] => {
    if (item.subjectType === "change_request" && fieldOf.has(item.subjectId)) {
      return [
        {
          subject: "change_request",
          subjectId: item.subjectId,
          field: fieldOf.get(item.subjectId)!,
          credentialName: null,
          reason: item.docsRequestReason!,
          requestedAt: item.docsRequestedAt!,
        },
      ];
    }
    if (item.subjectType === "credential" && nameOf.has(item.subjectId)) {
      return [
        {
          subject: "credential",
          subjectId: item.subjectId,
          field: null,
          credentialName: nameOf.get(item.subjectId)!,
          reason: item.docsRequestReason!,
          requestedAt: item.docsRequestedAt!,
        },
      ];
    }
    return [];
  });
}

/**
 * A seller uploaded a document, so every outstanding request on their pending
 * edits and credentials has something to look at. The queue shows the row as
 * back in our hands, with its clock running again.
 */
export async function markDocumentsReceived(businessId: string, now = new Date()): Promise<number> {
  const { count } = await prisma.queueItem.updateMany({
    where: {
      businessId,
      subjectType: { in: ["change_request", "credential"] },
      docsRequestedAt: { not: null, lte: now },
      docsReceivedAt: null,
    },
    data: { docsReceivedAt: now },
  });
  return count;
}

export interface BranchTakenDown {
  locationId: string;
  areaName: string;
  addressLine: string;
  reason: string;
  decidedAt: Date;
}

/** Branches a person took off the directory for being outside the licence, still hidden, for the same emirate. */
export async function branchesTakenDown(businessId: string): Promise<BranchTakenDown[]> {
  const items = await prisma.queueItem.findMany({
    where: { businessId, subjectType: "location", decision: "rejected" },
    orderBy: [{ decidedAt: "desc" }, { id: "asc" }],
    select: { subjectId: true, decisionReason: true, decidedAt: true, subjectVersion: true },
  });
  if (items.length === 0) return [];
  const locations = await prisma.location.findMany({
    where: { id: { in: items.map((item) => item.subjectId) }, published: false },
    select: { id: true, emirate: true, addressLine: true, area: { select: { name: true } } },
  });
  const byId = new Map(locations.map((location) => [location.id, location]));
  return items.flatMap((item) => {
    const location = byId.get(item.subjectId);
    if (!location || location.emirate !== item.subjectVersion) return [];
    return [
      {
        locationId: location.id,
        areaName: location.area.name,
        addressLine: location.addressLine,
        reason: item.decisionReason!,
        decidedAt: item.decidedAt!,
      },
    ];
  });
}

export interface ClaimStanding {
  /** An outstanding request on the claimant's own undecided claim. */
  request: { reason: string; requestedAt: Date } | null;
  /** The claimant's most recent decided claim, when nothing is waiting. */
  lastDecision: { outcome: "approved" | "rejected" | "withdrawn"; reason: string; decidedAt: Date } | null;
}

export async function claimStandingFor(businessId: string, claimantId: string): Promise<ClaimStanding> {
  const [open, decided] = await Promise.all([
    prisma.claimSubmission.findFirst({
      where: { businessId, claimantId, decidedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    }),
    prisma.claimSubmission.findFirst({
      where: { businessId, claimantId, decidedAt: { not: null } },
      orderBy: [{ decidedAt: "desc" }, { id: "desc" }],
      select: { outcome: true, decisionReason: true, decidedAt: true },
    }),
  ]);
  const item = open
    ? await prisma.queueItem.findUnique({
        where: { subjectType_subjectId: { subjectType: "claim", subjectId: open.id } },
        select: { docsRequestReason: true, docsRequestedAt: true, docsReceivedAt: true },
      })
    : null;
  return {
    request:
      item?.docsRequestedAt && item.docsRequestReason && !item.docsReceivedAt
        ? { reason: item.docsRequestReason, requestedAt: item.docsRequestedAt }
        : null,
    lastDecision:
      !open && decided?.decidedAt && decided.decisionReason
        ? { outcome: decided.outcome ?? "rejected", reason: decided.decisionReason, decidedAt: decided.decidedAt }
        : null,
  };
}
