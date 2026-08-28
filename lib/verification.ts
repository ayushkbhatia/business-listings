/**
 * The tier at which a listing counts as verified.
 *
 * Rung 2 is "trade licence checked against the issuing authority". Rung 1 is
 * "licence number recorded", which is a number somebody typed and nothing else
 * — `components/domain/verification.ts` says so on the badge, and `/verified`
 * filters, the home page counters and the sitemap have all read 2 since
 * handoff 1.
 *
 * The page matrix and the taxonomy screen read 1, which made both of them
 * report a verified share the public surfaces did not agree with: a category
 * could show "publishes" on board 6f and still be held out of the sitemap by
 * the same gate computed with the stricter number. That is criterion 12's
 * failure mode — "sitemap page count matches the admin matrix exactly" — and it
 * was live before handoff 5 went near it.
 *
 * One number, imported. A second definition is how the first one drifted.
 */
export const VERIFIED_TIER = 2;

export function isVerified(tier: number): boolean {
  return tier >= VERIFIED_TIER;
}
