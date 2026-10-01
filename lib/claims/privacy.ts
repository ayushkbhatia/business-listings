import type { Prisma } from "@/lib/db/generated/client";

/**
 * Board 4c `B11` and `B16`: a claimant's evidence stays theirs.
 *
 * Every claim uploads its licence — and, when an ops lead asks, a tenancy
 * contract — against the listing it claims, so the files sit under that
 * listing's `businessId`. The seller screens list a business's documents by
 * that id, which put a challenger's licence in front of the owner they were
 * challenging, and a losing claimant's in front of the winner, for good.
 *
 * A document attached to a claim shows on the listing's own screens only once
 * that claim was approved — it is then the owner's own evidence — or to the
 * claimant who sent it. A document no claim cites is unaffected.
 */
export function ownClaimEvidenceOnly(viewerId: string | null): Prisma.DocumentWhereInput {
  const allowed: Prisma.ClaimSubmissionWhereInput = viewerId
    ? { OR: [{ outcome: "approved" }, { claimantId: viewerId }] }
    : { outcome: "approved" };
  return { claims: { every: allowed }, tenancyClaims: { every: allowed } };
}
