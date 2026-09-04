/**
 * The verification ladder.
 *
 * ⚠ design-system §06 is the authority and is canvas-only. The rungs below are
 * derived from what the shipped documents do state:
 *   · `verificationTier` is 0..3 and staff-write-only, ops_lead (CLAUDE.md)
 *   · tier drops to 2 the day `licenceExpiry` passes, no grace period
 *   · a badge must state what was checked and its date (handoff 1, criterion 8)
 * Diff against §06 before launch. See docs/inferred.md.
 *
 * ## Why it stops at 3
 *
 * It ran to 4 until site visits were withdrawn. The top two rungs were "site
 * visited" and "premises visited and trading history audited", and both of them
 * rested on somebody standing in the warehouse — the one piece of evidence this
 * platform no longer gathers. A rung whose requirement nobody performs is a
 * badge that means whatever staff decide on the day, which is the failure the
 * interface-honesty rules name first.
 *
 * So the visited rung is gone and `audited` moved down to 3, resting on trading
 * history and buyer outcomes: enquiries answered, quotes sent, reply times.
 * Those are measured rather than claimed, which is what a top rung has to be.
 * `verifiedAt` dates it, because the audit is a decision we record rather than
 * a journey somebody made.
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
}

export const TIERS: readonly TierSpec[] = [
  { tier: 0, labelKey: "verify.t0", checkedKey: "verify.t0.checked", dateField: "none", tone: "neutral" },
  { tier: 1, labelKey: "verify.t1", checkedKey: "verify.t1.checked", dateField: "verifiedAt", tone: "info" },
  { tier: 2, labelKey: "verify.t2", checkedKey: "verify.t2.checked", dateField: "verifiedAt", tone: "ok" },
  { tier: 3, labelKey: "verify.t3", checkedKey: "verify.t3.checked", dateField: "verifiedAt", tone: "ok" },
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

export { isVerified, VERIFIED_TIER } from "@/lib/verification";
