/**
 * The verification ladder.
 *
 * ⚠ design-system §06 is the authority and is canvas-only. The rungs below are
 * derived from what the shipped documents do state:
 *   · `verificationTier` is 0..4 and staff-write-only, ops_lead (CLAUDE.md)
 *   · tier 3 additionally requires `visitedAt` (data-model.md)
 *   · tier drops to 2 the day `licenceExpiry` passes, no grace period
 *   · a badge must state what was checked and its date (handoff 1, criterion 8)
 * Diff against §06 before launch. See docs/inferred.md.
 */
export type VerificationTier = 0 | 1 | 2 | 3 | 4;

export interface TierSpec {
  tier: VerificationTier;
  /** Catalogue key for the short name on the badge. */
  labelKey: string;
  /** Catalogue key for what was actually checked. */
  checkedKey: string;
  /** Which timestamp the badge should date itself from. */
  dateField: "none" | "verifiedAt" | "visitedAt";
  /** ok reads as verified; neutral reads as unchecked. Never a theme colour. */
  tone: "neutral" | "info" | "ok";
}

export const TIERS: readonly TierSpec[] = [
  { tier: 0, labelKey: "verify.t0", checkedKey: "verify.t0.checked", dateField: "none", tone: "neutral" },
  { tier: 1, labelKey: "verify.t1", checkedKey: "verify.t1.checked", dateField: "verifiedAt", tone: "info" },
  { tier: 2, labelKey: "verify.t2", checkedKey: "verify.t2.checked", dateField: "verifiedAt", tone: "ok" },
  { tier: 3, labelKey: "verify.t3", checkedKey: "verify.t3.checked", dateField: "visitedAt", tone: "ok" },
  { tier: 4, labelKey: "verify.t4", checkedKey: "verify.t4.checked", dateField: "visitedAt", tone: "ok" },
];

export function tierSpec(tier: number): TierSpec {
  return TIERS[Math.min(4, Math.max(0, Math.trunc(tier)))]!;
}

export { isVerified, VERIFIED_TIER } from "@/lib/verification";
