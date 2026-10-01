import "server-only";
import type { Prisma } from "@/lib/db/generated/client";

/**
 * Board 4c, from the claimant's side of the desk — what a claim does to a
 * conflict when it is submitted, withdrawn, or answered with a document.
 *
 * Every function here runs inside the caller's transaction, after the caller
 * took the listing's claim lock (`./lock.ts`), so two claims arriving together
 * are put in a line rather than each seeing the other as absent.
 *
 * None of this is a staff decision and none of it writes an audit row: a claim
 * is a claimant's own assertion, recorded on its own row, exactly as
 * `submitClaim` always was.
 */

type Tx = Prisma.TransactionClient;

export interface Contest {
  conflictId: string;
  /** This claim opened the conflict, rather than joining one already open. */
  opened: boolean;
  /** A claim on a listing that already has an owner (§Flagged 2). */
  challenge: boolean;
  /** Every claim on the conflict now, this one included. Who `claim_conflict_opened` goes to. */
  claimIds: string[];
}

const OPEN = { resolvedAt: null, dissolvedAt: null } as const;

/**
 * A claim just written is contested when the listing already has an owner (a
 * *challenge*), when another claim on it is still undecided (a *race*), or when
 * a conflict is already open on it (a third side joining). Uncontested claims
 * return null and go to the queue on their own.
 *
 * A race moves the listing to `disputed`, which every public surface renders as
 * unclaimed (`B10`): neither claimant's name or badge appears until somebody
 * decides. A challenge leaves the listing as it is — a stranger's dispute does
 * not take a paying listing down to the unclaimed composition.
 */
export async function joinOrOpenConflict(tx: Tx, input: { businessId: string; submissionId: string }): Promise<Contest | null> {
  const open = await tx.claimConflict.findFirst({ where: { businessId: input.businessId, ...OPEN }, select: { id: true, challenge: true } });
  if (open) {
    await tx.claimSubmission.update({ where: { id: input.submissionId }, data: { conflictId: open.id, contested: true } });
    return { conflictId: open.id, opened: false, challenge: open.challenge, claimIds: [input.submissionId] };
  }

  const business = await tx.business.findUniqueOrThrow({ where: { id: input.businessId }, select: { claimStatus: true } });
  const waiting = await tx.enquiryRecipient.count({ where: { businessId: input.businessId, state: { in: ["delivered", "opened"] } } });

  if (business.claimStatus === "claimed") {
    const incumbent = await tx.user.findFirst({
      where: { businessId: input.businessId, roles: { has: "seller_owner" } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    const conflict = await tx.claimConflict.create({
      data: {
        businessId: input.businessId,
        submissionAId: input.submissionId,
        challenge: true,
        incumbentId: incumbent?.id ?? null,
        buyersWaiting: waiting,
      },
      select: { id: true },
    });
    await tx.claimSubmission.update({ where: { id: input.submissionId }, data: { conflictId: conflict.id, contested: true } });
    return { conflictId: conflict.id, opened: true, challenge: true, claimIds: [input.submissionId] };
  }

  const others = await tx.claimSubmission.findMany({
    where: { businessId: input.businessId, decidedAt: null, id: { not: input.submissionId } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  if (others.length === 0) return null;

  const conflict = await tx.claimConflict.create({
    data: {
      businessId: input.businessId,
      submissionAId: others[0]!.id,
      submissionBId: input.submissionId,
      buyersWaiting: waiting,
    },
    select: { id: true },
  });
  const claimIds = [...others.map((claim) => claim.id), input.submissionId];
  await tx.claimSubmission.updateMany({ where: { id: { in: claimIds } }, data: { conflictId: conflict.id, contested: true } });
  await tx.business.update({ where: { id: input.businessId }, data: { claimStatus: "disputed" } });
  return { conflictId: conflict.id, opened: true, challenge: false, claimIds };
}

/**
 * A claim inside a conflict was withdrawn. Where that leaves fewer sides than a
 * conflict needs — one claim in a race, none in a challenge — nobody decided
 * it and nobody will: it is dissolved, and the claim still standing goes back
 * to the queue as a plain claim, keeping its own age (§States, *A claim
 * withdrawn*). The listing a race had marked `disputed` is unclaimed again.
 */
export async function settleAfterWithdrawal(tx: Tx, conflictId: string, now: Date): Promise<"continues" | "dissolved"> {
  const conflict = await tx.claimConflict.findUnique({
    where: { id: conflictId },
    select: { id: true, businessId: true, challenge: true, resolvedAt: true, dissolvedAt: true, submissionAId: true, submissionBId: true },
  });
  if (!conflict || conflict.resolvedAt || conflict.dissolvedAt) return "continues";
  const sides = [conflict.submissionAId, conflict.submissionBId].filter((id): id is string => id !== null);
  const live = await tx.claimSubmission.count({
    where: { decidedAt: null, OR: [{ conflictId: conflict.id }, { id: { in: sides } }] },
  });
  if (live >= (conflict.challenge ? 1 : 2)) return "continues";

  await tx.claimConflict.update({ where: { id: conflict.id }, data: { dissolvedAt: now } });
  if (!conflict.challenge) {
    await tx.business.updateMany({ where: { id: conflict.businessId, claimStatus: "disputed" }, data: { claimStatus: "unclaimed" } });
  }
  return "dissolved";
}

/**
 * The tenancy contract a claimant uploaded, answering an ops lead's request
 * (Q4). Attached to their own undecided claim and nobody else's; when every
 * side still standing has answered, the request is marked received and the
 * signals are re-derived on the next read, because nothing about them is
 * stored.
 */
export async function attachTenancyDocument(
  tx: Tx,
  input: { businessId: string; claimantId: string; documentId: string },
  now: Date,
): Promise<{ ok: true; complete: boolean } | { ok: false; error: "no_request" }> {
  const claim = await tx.claimSubmission.findFirst({
    where: {
      businessId: input.businessId,
      claimantId: input.claimantId,
      decidedAt: null,
      conflict: { ...OPEN, docsRequestedAt: { not: null }, docsReceivedAt: null },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, conflictId: true },
  });
  if (!claim?.conflictId) return { ok: false, error: "no_request" };

  await tx.claimSubmission.update({ where: { id: claim.id }, data: { tenancyDocumentId: input.documentId } });
  const missing = await tx.claimSubmission.count({
    where: { conflictId: claim.conflictId, decidedAt: null, tenancyDocumentId: null },
  });
  if (missing === 0) {
    await tx.claimConflict.update({ where: { id: claim.conflictId }, data: { docsReceivedAt: now } });
  }
  return { ok: true, complete: missing === 0 };
}
