/**
 * The verification ladder.
 *
 * ⚠ design-system §06 is the authority and is canvas-only. The rungs below are
 * derived from what the shipped documents do state:
 *   · `verificationTier` is 0..3 and staff-write-only, ops_lead (CLAUDE.md)
 *   · tier drops to **1** the day `licenceExpiry` passes, no grace period
 *   · a badge must state what was checked and its date (handoff 1, criterion 8)
 * Diff against §06 before launch. See docs/inferred.md.
 *
 * ## The ladder, after the site-visit cut
 *
 * ```
 * 0 unclaimed → 1 claimed → 2 licence verified (top) → 3 trade references (reserved)
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
 * a trading-history audit, no screen sets it and no listing has ever held it, so
 * rung 3 was again a requirement nobody performs. Board 3e and the change log of
 * 5 September put **trade references** there instead and mark it `reserved` —
 * drawn, so the ladder has somewhere to go, and inert, because it is not built.
 *
 * **Tier 2 is the top achievable tier**, and it expires with the licence.
 */
export type VerificationTier = 0 | 1 | 2 | 3;

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
  /**
   * Drawn and unreachable.
   *
   * Only rung 3. It is on the ladder so the ladder has somewhere to go, and it
   * carries no affordance because nothing behind it exists — board 3e's sixth
   * correction, where the board offered `Start this →` for an unbuilt tier.
   * `setVerificationTier` will still accept 3, because the database CHECK is
   * `0..3` and refusing it in one function while the column allows it would be
   * a second source of truth; what this flag governs is what a screen may
   * promise.
   */
  reserved?: boolean;
}

export const TIERS: readonly TierSpec[] = [
  { tier: 0, labelKey: "verify.t0", checkedKey: "verify.t0.checked", dateField: "none", tone: "neutral" },
  { tier: 1, labelKey: "verify.t1", checkedKey: "verify.t1.checked", dateField: "verifiedAt", tone: "info" },
  { tier: 2, labelKey: "verify.t2", checkedKey: "verify.t2.checked", dateField: "verifiedAt", tone: "ok" },
  { tier: 3, labelKey: "verify.t3", checkedKey: "verify.t3.checked", dateField: "verifiedAt", tone: "ok", reserved: true },
];

/**
 * Clamped, and the ceiling matters more than it looks.
 *
 * A row written before the ladder shortened could still hold 4 — a restore, a
 * replica lagging the migration, a fixture somebody wrote by hand. Clamping to
 * the top rung shows that supplier the strongest badge the ladder now has
 * rather than crashing on an index that is not there.
 */
export function tierSpec(tier: number): TierSpec {
  return TIERS[Math.min(TIERS.length - 1, Math.max(0, Math.trunc(tier)))]!;
}

/*
   Re-exported rather than derived here.

   `TOP_ACHIEVABLE_TIER` is stated in `lib/verification.ts` so that
   `lib/search/ranking.ts` and `lib/enquiry/fanout.ts` can normalise the tier
   without importing from `components`. `lib/verification.test.ts` asserts it
   equals the highest non-reserved rung in `TIERS`, so the two cannot drift.
*/
export { isVerified, TOP_ACHIEVABLE_TIER, trustScore, VERIFIED_TIER } from "@/lib/verification";
