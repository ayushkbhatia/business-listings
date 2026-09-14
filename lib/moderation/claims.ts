import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import type { Actor, Role } from "@/lib/auth/roles";
import { SELLER_ROLES } from "@/lib/auth/roles";

/**
 * Board 4b — deciding a claim that nobody else is contesting.
 *
 * Handoff 3 took claims and said a person would decide them: "`claimStatus`
 * stays where it is until a person decides, which is handoff 4", and "if the
 * claim is rejected, handoff 4's queue detaches them". Conflicts got a decider
 * in `lib/onboarding/conflict.ts`. A plain claim — the most common kind of
 * submission on the board, 142 of 318 — never did, so every uncontested claim
 * sat undecided forever and its claimant held a seat over a listing nobody had
 * agreed was theirs. This is that decider.
 *
 * ## What approving does and does not do
 *
 * The listing becomes `claimed` and the claimant keeps the owner seat the claim
 * already gave them. `verificationTier` does not move — claiming inherits
 * history, not trust (board 2a criterion 7, non-negotiable 2) — and neither does
 * `licenceExpiry`: B10, approving a claim does not approve its licence forever.
 * The expiry stays on the business record, where the licence-expiry sweep reads
 * it, and the audit row records the expiry the approval was made against.
 *
 * ## What rejecting does
 *
 * Decides the submission with the reason the claimant reads, and takes back the
 * owner seat the claim attached — the listing was never theirs. Any other seat
 * the person holds is left alone.
 */

export type ClaimDecisionError =
  | "not_found"
  | "already_decided"
  | "in_conflict"
  | "business_closing"
  | "listing_claimed";

export type ClaimDecisionResult = { ok: true } | { ok: false; error: ClaimDecisionError };

export interface ClaimDecisionInput {
  actor: Actor;
  submissionId: string;
  reason: string;
}

async function loadClaim(submissionId: string) {
  return prisma.claimSubmission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      businessId: true,
      claimantId: true,
      decidedAt: true,
      route: true,
      conflictsAsA: { where: { resolvedAt: null }, select: { id: true } },
      conflictsAsB: { where: { resolvedAt: null }, select: { id: true } },
      claimant: { select: { id: true, businessId: true, roles: true } },
      business: {
        select: {
          id: true,
          claimStatus: true,
          closureRequestedAt: true,
          licenceNumber: true,
          licenceExpiry: true,
        },
      },
    },
  });
}

export async function approveClaim(input: ClaimDecisionInput, now = new Date()): Promise<ClaimDecisionResult> {
  const claim = await loadClaim(input.submissionId);
  if (!claim) return { ok: false, error: "not_found" };
  if (claim.decidedAt) return { ok: false, error: "already_decided" };
  // Two claims on one listing are settled on the conflict screen, four ways.
  if (claim.conflictsAsA.length + claim.conflictsAsB.length > 0) return { ok: false, error: "in_conflict" };
  // Board 11i Q2: a closing business goes back to its licence holder only
  // through the closure screen, never by approving a claim.
  if (claim.business.closureRequestedAt) return { ok: false, error: "business_closing" };
  // Somebody already owns it and this claim did not open a conflict. Approving
  // would hand one company to two owners without anybody deciding between them.
  if (claim.business.claimStatus === "claimed" && claim.claimant.businessId !== claim.businessId) {
    return { ok: false, error: "listing_claimed" };
  }

  let raced = false;
  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "queue.decide",
        subject: `ClaimSubmission:${claim.id}`,
        reason: input.reason,
        tx,
      },
      async () => {
        const decided = await tx.claimSubmission.updateMany({
          where: { id: claim.id, decidedAt: null },
          data: {
            status: "claimed",
            outcome: "approved",
            decidedAt: now,
            decidedById: input.actor.id,
            decisionReason: input.reason.trim(),
          },
        });
        // Decided by somebody else between the read and the write.
        if (decided.count === 0) {
          raced = true;
          throw new ClaimRaced();
        }

        await tx.business.update({ where: { id: claim.businessId }, data: { claimStatus: "claimed" } });

        const roles: Role[] = claim.claimant.roles.includes("seller_owner")
          ? [...claim.claimant.roles]
          : [...claim.claimant.roles, "seller_owner"];
        await tx.user.update({
          where: { id: claim.claimantId },
          data: { businessId: claim.businessId, roles },
        });

        return {
          result: null,
          before: { claimStatus: claim.business.claimStatus, decided: false },
          after: {
            claimStatus: "claimed",
            outcome: "approved",
            claimantId: claim.claimantId,
            route: claim.route,
            // B10: the licence this was approved against, and when it lapses.
            licenceNumber: claim.business.licenceNumber,
            licenceExpiry: claim.business.licenceExpiry.toISOString(),
          },
        };
      },
    ),
  ).catch((error) => {
    if (error instanceof ClaimRaced) return null;
    throw error;
  });

  return raced ? { ok: false, error: "already_decided" } : { ok: true };
}

export async function rejectClaim(input: ClaimDecisionInput, now = new Date()): Promise<ClaimDecisionResult> {
  const claim = await loadClaim(input.submissionId);
  if (!claim) return { ok: false, error: "not_found" };
  if (claim.decidedAt) return { ok: false, error: "already_decided" };
  if (claim.conflictsAsA.length + claim.conflictsAsB.length > 0) return { ok: false, error: "in_conflict" };

  let raced = false;
  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "queue.decide",
        subject: `ClaimSubmission:${claim.id}`,
        reason: input.reason,
        tx,
      },
      async () => {
        const decided = await tx.claimSubmission.updateMany({
          where: { id: claim.id, decidedAt: null },
          data: {
            outcome: "rejected",
            decidedAt: now,
            decidedById: input.actor.id,
            decisionReason: input.reason.trim(),
          },
        });
        if (decided.count === 0) {
          raced = true;
          throw new ClaimRaced();
        }

        /*
           The owner seat the claim attached goes back. Only that one: a person
           who also holds a manager seat on this business, or who owns it by an
           earlier decision, keeps what they had.
        */
        const detached = claim.claimant.businessId === claim.businessId && claim.business.claimStatus !== "claimed";
        if (detached) {
          const kept = claim.claimant.roles.filter((role) => role !== "seller_owner");
          const stillSeated = kept.some((role) => (SELLER_ROLES as readonly string[]).includes(role));
          await tx.user.update({
            where: { id: claim.claimantId },
            data: {
              businessId: stillSeated ? claim.businessId : null,
              roles: kept.length > 0 ? kept : ["buyer"],
            },
          });
        }

        return {
          result: null,
          before: { decided: false, claimantSeated: claim.claimant.businessId === claim.businessId },
          after: { outcome: "rejected", claimantId: claim.claimantId, seatDetached: detached },
        };
      },
    ),
  ).catch((error) => {
    if (error instanceof ClaimRaced) return null;
    throw error;
  });

  return raced ? { ok: false, error: "already_decided" } : { ok: true };
}

class ClaimRaced extends Error {
  constructor() {
    super("claim decided concurrently");
    this.name = "ClaimRaced";
  }
}
