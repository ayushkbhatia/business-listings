import "server-only";
import { cache } from "react";
import type { ClaimStatus } from "@/lib/db/generated/enums";
import { prisma } from "@/lib/db/client";
import { OPEN_CLOSED_REPORT } from "./index-rule";

/**
 * What board 10g needs to know about an unclaimed listing that is not on its
 * own row.
 *
 *   closedReportOpen   somebody has said it closed and 4h has not decided —
 *                      the page goes `noindex` until it does (Q4)
 *   claimUnderReview   a claim is waiting for a reviewer, or two are in
 *                      conflict — the claim card says so and still takes one
 *                      (Q2, `2b`'s rule), naming nobody
 *
 * "Pending" is read from an undecided `ClaimSubmission`, not stored: the
 * owner's answer on board 4c, 1 Oct 2026. Submitting a claim leaves
 * `claimStatus` where it was, which is why the listing still renders here.
 *
 * `cache`d because `generateMetadata` asks for the first and the page for
 * both, in the same request.
 */
export const unclaimedFacts = cache(async (businessId: string, claimStatus: ClaimStatus) => {
  const [closedReports, undecidedClaims] = await Promise.all([
    prisma.supplierReport.count({
      where: { subjectBusinessId: businessId, ...OPEN_CLOSED_REPORT },
    }),
    claimStatus === "disputed"
      ? Promise.resolve(0)
      : prisma.claimSubmission.count({ where: { businessId, decidedAt: null } }),
  ]);

  return {
    closedReportOpen: closedReports > 0,
    claimUnderReview: claimStatus === "disputed" || undecidedClaims > 0,
  };
});
