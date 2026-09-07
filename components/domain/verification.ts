/**
 * The verification ladder.
 *
 * ⚠ design-system §06 is the authority and is canvas-only. The rungs below are
 * derived from what the shipped documents do state:
 *   · `verificationTier` is 0..2 and staff-write-only, ops_lead (CLAUDE.md)
 *   · tier drops to **1** the day `licenceExpiry` passes, no grace period
 *   · a badge must state what was checked and its date (handoff 1, criterion 8)
 * Diff against §06 before launch. See docs/inferred.md.
 *
 * ## The ladder, after the site-visit cut and the trade-references cut
 *
 * ```
 * 0 unclaimed → 1 claimed → 2 licence verified (top)
 * ```
 *
 * It ran to 4 until site visits were withdrawn. The top two rungs were "site
 * visited" and "premises visited and trading history audited", and both of them
 * rested on somebody standing in the warehouse — the one piece of evidence this
 * platform no longer gathers. A rung whose requirement nobody performs is a
 * badge that means whatever staff decide on the day, which is the failure the
 * interface-honesty rules name first.
 *
 * The first pass at that cut moved `audited` down to 3 and re-based it on
 * trading history. That was the same mistake one step quieter: nothing measures
 * a trading-history audit, no screen sets it and no listing has ever held it.
 * Board 3e put **trade references** there instead and marked it `reserved` —
 * drawn, so the ladder had somewhere to go, and inert, because it was not
 * built.
 *
 * That rung is now gone as well, and the reasoning is the third turn of the
 * same screw. Trade references will never be built; a reserved rung that never
 * ships is a promise on a live screen, and the seller reading "we will say so
 * here when it exists" is reading a roadmap the roadmap no longer contains.
 * Drawing somewhere to go is only honest while somebody intends to go there.
 *
 * **Tier 2 is the top rung**, and it expires with the licence.
 */
export type VerificationTier = 0 | 1 | 2;

export interface TierSpec {
  tier: VerificationTier;
  /** Catalogue key for the short name on the badge. */
  labelKey: string;
  /** Catalogue key for what was actually checked. */
  checkedKey: string;
  /** Which timestamp the badge should date itself from. */
  dateField: "none" | "verifiedAt";
  /** ok reads as verified; neutral reads as unchecked. Never a theme colour. */
  tone: "neutral" | "info" | "ok";
}

export const TIERS: readonly TierSpec[] = [
  { tier: 0, labelKey: "verify.t0", checkedKey: "verify.t0.checked", dateField: "none", tone: "neutral" },
  { tier: 1, labelKey: "verify.t1", checkedKey: "verify.t1.checked", dateField: "verifiedAt", tone: "info" },
  { tier: 2, labelKey: "verify.t2", checkedKey: "verify.t2.checked", dateField: "verifiedAt", tone: "ok" },
];

/**
 * Clamped, and the ceiling matters more than it looks.
 *
 * A row written before the ladder shortened could still hold 3 or 4 — a
 * restore, a replica lagging the migration, a fixture somebody wrote by hand.
 * Clamping to the top rung shows that supplier the strongest badge the ladder
 * now has rather than crashing on an index that is not there.
 */
export function tierSpec(tier: number): TierSpec {
  return TIERS[Math.min(TIERS.length - 1, Math.max(0, Math.trunc(tier)))]!;
}

/*
   Re-exported rather than derived here.

   `TOP_ACHIEVABLE_TIER` is stated in `lib/verification.ts` so that
   `lib/search/ranking.ts` and `lib/enquiry/fanout.ts` can normalise the tier
   without importing from `components`. `lib/verification.test.ts` asserts it
   equals the highest rung in `TIERS`, so the two cannot drift.
*/
export { isVerified, TOP_ACHIEVABLE_TIER, trustScore, VERIFIED_TIER } from "@/lib/verification";
