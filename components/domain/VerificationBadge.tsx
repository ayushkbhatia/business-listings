import { cn } from "@/lib/cn";
import { Check, Warning } from "@/components/primitives/icons";
import { Building, Pin } from "@/components/display/icons";
import { tierSpec, type VerificationTier } from "./verification";

/**
 * The trust signal. Four tiers, plus unverified.
 *
 * Two rules make this component what it is, and both are architectural:
 *
 * 1. **It never takes a seller theme colour.** Every colour below comes from
 *    the status palette or the neutrals; none comes from `--brand`. A badge
 *    that recoloured per storefront would be a badge each seller controls, and
 *    a trust signal a seller controls is not a trust signal. Covered by a test.
 *
 * 2. **It states what was checked, and when.** "Verified" on its own is a claim.
 *    "Licence verified 14 Aug 2026" is a fact a buyer can weigh. There is no
 *    variant that shows the tier without the substance.
 */
export interface VerificationBadgeProps {
  tier: number;
  /** Already localised: the short name, e.g. "Site visited". */
  label: string;
  /** Already localised: what was checked. Required — this is the whole point. */
  checked: string;
  /** Already formatted, e.g. "14 Aug 2026". Absent only at tier 0. */
  date?: string;
  /** `tier {n}` in mono, already localised. */
  tierLabel?: string;
  size?: "sm" | "md" | "lg";
  /** Badge only, without the checked line. For a dense row — never a storefront. */
  compact?: boolean;
}

const TONE = {
  neutral: "border-line bg-fill text-muted",
  info: "border-info-line bg-info-wash text-info-ink",
  ok: "border-ok-line bg-ok-wash text-ok-ink",
} as const;

function TierIcon({ tier, size }: { tier: VerificationTier; size: number }) {
  if (tier === 0) return <Warning size={size} />;
  if (tier >= 3) return <Pin size={size} />;
  if (tier === 2) return <Check size={size} />;
  return <Building size={size} />;
}

export function VerificationBadge({
  tier,
  label,
  checked,
  date,
  tierLabel,
  size = "md",
  compact = false,
}: VerificationBadgeProps) {
  const spec = tierSpec(tier);
  const iconSize = size === "sm" ? 11 : size === "lg" ? 15 : 13;

  const badge = (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill border whitespace-nowrap",
        size === "sm" ? "px-1.5 py-px text-eyebrow" : "px-2 py-0.5 text-caption",
        TONE[spec.tone],
      )}
    >
      <TierIcon tier={spec.tier} size={iconSize} />
      {label}
      {tierLabel && spec.tier > 0 && (
        // No opacity. "tier 3" is content, not decoration, and 80% drops it
        // to 3.64:1 on the ok wash. The mono face and the eyebrow size already
        // separate it from the label beside it.
        <span className="font-mono text-eyebrow tabular-nums">{tierLabel}</span>
      )}
    </span>
  );

  if (compact) return badge;

  return (
    <span className="inline-flex flex-col items-start gap-1">
      {badge}
      <span className="text-caption text-muted">
        {checked}
        {date && (
          <>
            {" "}
            <span className="font-mono text-eyebrow tabular-nums text-faint">{date}</span>
          </>
        )}
      </span>
    </span>
  );
}
