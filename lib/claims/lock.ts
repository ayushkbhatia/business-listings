import type { Prisma } from "@/lib/db/generated/client";

/**
 * Every claim on a listing is taken and decided under one lock — board 4c.
 *
 * Two claims arriving together on a listing nobody owns would each see the
 * other as not yet there, and neither would open the conflict that two
 * undecided claims are; a claim arriving while an ops lead resolves would be
 * left undecided beside a decided conflict. One transaction-scoped advisory
 * lock per listing, taken by the claim service and by every conflict decision,
 * puts them in a line.
 */
export async function lockListingClaims(tx: Prisma.TransactionClient, businessId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`claims:${businessId}`}))`;
}
