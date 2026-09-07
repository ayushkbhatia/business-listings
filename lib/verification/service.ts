import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import { assertCan } from "@/lib/auth/can";
import { EXPIRED_LICENCE_TIER, licenceExpired, MAX_STORED_TIER } from "@/lib/verification";
import type { Actor } from "@/lib/auth/roles";

/**
 * Setting a verification tier — CLAUDE.md non-negotiable 2, and the row the
 * permission matrix guards most carefully.
 *
 * Three things have to be true at once, and each is enforced somewhere
 * different on purpose:
 *
 *   1. **Only staff, and only the ops lead.** It was ops lead plus a field
 *      verifier acting on a visit they had recorded — a subject check rather
 *      than a role check. Site visits were withdrawn and `visitedByStaffId`
 *      went with them, so the conditional half had nothing left to read. The
 *      grant was narrowed rather than widened.
 *   2. **The ladder stops at 3**, enforced by a database CHECK
 *      (`business_verification_tier_range`). This function refuses an
 *      out-of-range tier before the write so the error can say what is wrong,
 *      but the constraint is what makes the rule true — a second code path
 *      cannot get around it.
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
/*
   Three, not four, and imported rather than restated.

   The ladder lost its "site visited" rung when site visits were withdrawn, and
   `audited` moved down from 4 to take its place — see components/domain/
   verification.ts. A tier of 4 is out of range here and refused by the
   `business_verification_tier_range` CHECK underneath, which is what makes the
   ceiling true rather than merely asserted.

   It was a literal until `parseSearchQuery` was found still clamping to 4, a
   second copy of this ceiling that had not moved when this one did. One number,
   in lib/verification.ts beside `TOP_ACHIEVABLE_TIER` so the difference between
   what may be stored and what may be earned is legible in one place.
*/
const MAX_TIER = MAX_STORED_TIER;

export async function setVerificationTier(input: SetTierInput): Promise<TierResult> {
  const business = await prisma.business.findUnique({
    where: { id: input.businessId },
    select: {
      id: true,
      verificationTier: true,
      verifiedAt: true,
      licenceExpiry: true,
    },
  });
  if (!business) {
    return { ok: false, error: "not_found", message: "That business is not in the directory." };
  }

  /*
   * Ops lead only, and that is the whole check now.
   *
   * It used to be subject-dependent: a field verifier could tier a business
   * they had visited, read off `Business.visitedByStaffId`. Site visits were
   * withdrawn and that column with them, so rather than widen the grant to an
   * unconditional one the narrower half was removed — see the note on
   * `business.verification_tier.write` in lib/auth/capabilities.ts.
   */
  assertCan(input.actor, "business.verification_tier.write");

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
        // No `subjectChecked`: the row stopped being subject-dependent when
        // site visits were withdrawn, and `staffMutation` refuses the flag on a
        // capability that does not carry a subject — deliberately, so the two
        // cannot drift out of agreement about which rows need the narrow check.
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
