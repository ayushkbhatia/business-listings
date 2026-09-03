import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import { assertCanSetVerificationTier } from "@/lib/auth/subject";
import { EXPIRED_LICENCE_TIER, licenceExpired } from "@/lib/verification";
import type { Actor } from "@/lib/auth/roles";

/**
 * Setting a verification tier — CLAUDE.md non-negotiable 2, and the row the
 * permission matrix guards most carefully.
 *
 * Three things have to be true at once, and each is enforced somewhere
 * different on purpose:
 *
 *   1. **Only staff, and only the right staff.** Ops lead unconditionally, a
 *      field verifier only for a visit they recorded. That is a subject check,
 *      not a role check — `assertCanSetVerificationTier` reads the visit — and
 *      `staffMutation` now refuses this capability unless the caller says it
 *      ran one. A role test alone would let any field verifier tier any
 *      business, which is exactly the failure the matrix's note is about.
 *   2. **Tier 3 requires a recorded visit**, enforced by a database CHECK
 *      (`prisma/migrations/20260823173500_invariant_constraints`). This
 *      function refuses it before the write so the seller-facing error can say
 *      what is missing, but the constraint is what makes the rule true — a
 *      second code path cannot get around it.
 *   3. **A written reason**, on the audit row, in the same transaction.
 *
 * There is no seller path to this function and there never will be one. It is
 * exported for the console and for the tests that prove a moderator is refused.
 */

export type TierResult =
  | { ok: true; tier: number }
  | {
      ok: false;
      error:
        | "not_found"
        | "out_of_range"
        | "needs_a_visit"
        | "licence_expired"
        | "unchanged";
      message: string;
    };

export interface SetTierInput {
  actor: Actor;
  businessId: string;
  tier: number;
  reason: string;
}

const MIN_TIER = 0;
const MAX_TIER = 4;
/** Below this a tier is a document check; at or above it somebody has been. */
const TIER_REQUIRING_A_VISIT = 3;

export async function setVerificationTier(input: SetTierInput): Promise<TierResult> {
  const business = await prisma.business.findUnique({
    where: { id: input.businessId },
    select: {
      id: true,
      verificationTier: true,
      verifiedAt: true,
      visitedAt: true,
      visitedByStaffId: true,
      licenceExpiry: true,
    },
  });
  if (!business) {
    return { ok: false, error: "not_found", message: "That business is not in the directory." };
  }

  /*
   * The subject check runs before anything else, and it reads the visit rather
   * than the role. `visitedByStaffId` is the whole question for a field
   * verifier: a business with no recorded visit denies them, which is the
   * correct default rather than an inconvenience.
   */
  assertCanSetVerificationTier(input.actor, {
    businessId: business.id,
    recordedByStaffId: business.visitedByStaffId,
  });

  if (!Number.isInteger(input.tier) || input.tier < MIN_TIER || input.tier > MAX_TIER) {
    return {
      ok: false,
      error: "out_of_range",
      message: `A tier is a whole number from ${MIN_TIER} to ${MAX_TIER}.`,
    };
  }

  if (input.tier === business.verificationTier) {
    return {
      ok: false,
      error: "unchanged",
      message: `That business is already tier ${business.verificationTier}.`,
    };
  }

  if (input.tier >= TIER_REQUIRING_A_VISIT && business.visitedAt === null) {
    return {
      ok: false,
      error: "needs_a_visit",
      message: `Tier ${input.tier} needs a recorded site visit. Record the visit first, then set the tier.`,
    };
  }

  /*
     The fourth thing that has to be true, and the one the nightly sweep would
     otherwise fight.

     `sweepExpiredLicences` drops a lapsed listing to `EXPIRED_LICENCE_TIER`
     every night. Without this, an ops lead could set tier 4 on a licence that
     expired last year, the sweep would undo it before morning, and the console
     would show a tier that keeps reverting with nothing on screen saying why.
     Two writers to one column need one floor between them.

     Refused rather than silently clamped: the tier is the most guarded field in
     the system and a staff member who asked for 4 should be told they got 1,
     not discover it. The message names the fix, because the fix is real — a
     renewed licence is a new expiry date on the record, and once it is in, this
     returns to allowing the tier.
  */
  if (input.tier > EXPIRED_LICENCE_TIER && licenceExpired(business.licenceExpiry, new Date())) {
    return {
      ok: false,
      error: "licence_expired",
      message:
        `That trade licence expired on ${business.licenceExpiry.toISOString().slice(0, 10)}. ` +
        `Tier ${EXPIRED_LICENCE_TIER} is the ceiling until the renewed licence is recorded.`,
    };
  }

  const before = {
    verificationTier: business.verificationTier,
    verifiedAt: business.verifiedAt,
  };

  await prisma.$transaction(async (tx) => {
    await staffMutation(
      {
        actor: input.actor,
        capability: "business.verification_tier.write",
        subject: `Business:${business.id}`,
        reason: input.reason,
        subjectChecked: true,
        tx,
      },
      async () => {
        const after = await tx.business.update({
          where: { id: business.id },
          data: {
            verificationTier: input.tier,
            // Tier 0 is "nothing has been checked", so it clears the date
            // rather than leaving a claim about a check that no longer stands.
            verifiedAt: input.tier > 0 ? new Date() : null,
          },
          select: { verificationTier: true, verifiedAt: true },
        });
        return { result: after, before, after };
      },
    );
  });

  return { ok: true, tier: input.tier };
}
