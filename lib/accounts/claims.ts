import "server-only";
import { prisma } from "@/lib/db/client";
import { cohortConversion, cohortWindow, type ClaimedAt, type CohortConversion } from "./conversion-model";

/**
 * When listings were claimed, for board 4a.
 *
 * A listing becomes `claimed` when a person approves its claim — submitting one
 * moves nothing (`lib/onboarding/claim.ts`, `lib/moderation/claims.ts`) — so the
 * moment of a claim is the approved decision. The same definition `4f` prints
 * as an account's claimed date (`ROW_SELECT.claimSubmissions` in `./list.ts`):
 * outcome `approved`, with a decision time.
 *
 * A listing marked claimed by any other path — the seed, or a record that
 * predates the queue deciding claims — has no such decision, and so no claimed
 * date. It is counted as claimed everywhere a count is taken and appears in no
 * month here. That is the honest gap, and the overview's chart caption says so.
 */

const APPROVED = { outcome: "approved", decidedAt: { not: null } } as const;

/** Approved claim decisions per window, keyed as the caller keys them. */
export async function claimsApprovedByWindow(
  windows: readonly { key: string; from: Date; to: Date }[],
): Promise<Map<string, number>> {
  const result = new Map(windows.map((window) => [window.key, 0]));
  if (windows.length === 0) return result;
  const from = new Date(Math.min(...windows.map((window) => window.from.getTime())));
  const to = new Date(Math.max(...windows.map((window) => window.to.getTime())));
  const decisions = await prisma.claimSubmission.findMany({
    where: { ...APPROVED, decidedAt: { gte: from, lt: to } },
    select: { decidedAt: true },
    orderBy: [{ decidedAt: "asc" }, { id: "asc" }],
  });
  for (const decision of decisions) {
    const at = decision.decidedAt!;
    const window = windows.find((candidate) => at >= candidate.from && at < candidate.to);
    if (window) result.set(window.key, result.get(window.key)! + 1);
  }
  return result;
}

/**
 * The ninety-day cohort conversion as at `asOf` (D-CONVERSION).
 *
 * A business's first payment is its earliest `new_business` movement in the
 * MRR ledger — the line `4g`'s waterfall calls *New subscriptions*.
 */
export async function claimConversion(asOf: Date): Promise<CohortConversion> {
  const window = cohortWindow(asOf);
  const decisions = await prisma.claimSubmission.groupBy({
    by: ["businessId"],
    where: APPROVED,
    _min: { decidedAt: true },
    orderBy: { businessId: "asc" },
  });
  const claims: ClaimedAt[] = decisions
    .filter((row) => row._min.decidedAt !== null)
    .map((row) => ({ businessId: row.businessId, claimedAt: row._min.decidedAt! }))
    .filter((claim) => claim.claimedAt >= window.from && claim.claimedAt < window.to);
  if (claims.length === 0) return cohortConversion([], new Map(), asOf);

  const payments = await prisma.mrrMovement.groupBy({
    by: ["businessId"],
    where: { kind: "new_business", businessId: { in: claims.map((claim) => claim.businessId) } },
    _min: { occurredAt: true },
    orderBy: { businessId: "asc" },
  });
  const firstPaid = new Map<string, Date>();
  for (const row of payments) if (row._min.occurredAt) firstPaid.set(row.businessId, row._min.occurredAt);
  return cohortConversion(claims, firstPaid, asOf);
}
