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

/**
 * Where an expired trade licence puts a listing.
 *
 * Rung 1 is "licence number recorded" — a number somebody typed — and that
 * stays true after expiry. Rung 2, the badge threshold, means "checked with the
 * issuing authority and confirmed current", which is the one claim expiry
 * falsifies. The schema said "drops to 2" until the sweep was written; see
 * `lib/verification/expiry-job.ts` for why that was wrong in the dangerous
 * direction.
 *
 * Beside `VERIFIED_TIER` because the two are one decision. The nightly sweep
 * drops to this and `setVerificationTier` refuses to raise above it while the
 * licence is lapsed — a floor only one of them knew about would be a nightly
 * flip-flop between staff and cron.
 */
export const EXPIRED_LICENCE_TIER = 1;

/**
 * True where a trade licence has lapsed.
 *
 * Here rather than beside the sweep that acts on it, because the sweep is
 * `server-only` and imports Prisma, and this is a date comparison two server
 * components need. One definition, because the render and the job disagreeing
 * about what "expired" means is how a badge outlives its licence in exactly one
 * of the two places somebody remembered to check.
 *
 * `now` is a parameter and never `Date.now()` in a body: the purity lint refuses
 * it in render, and it is right to.
 */
export function licenceExpired(licenceExpiry: Date, now: Date): boolean {
  return licenceExpiry.getTime() < now.getTime();
}
