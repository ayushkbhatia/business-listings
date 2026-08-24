import { ProgressBar } from "@/components/display";

/**
 * How much of a spec template this product has actually filled.
 *
 * Two audiences, one number. A buyer sees the unfilled rows greyed in the spec
 * table and reads the count as "how much do I know about this thing". A seller
 * sees the same count as a to-do — and because it is derived from the template
 * rather than typed, it cannot be gamed by filling a field with a dash.
 */
export interface CompletenessMeterProps {
  filled: number;
  total: number;
  /** "14 / 22 fields", already localised. */
  valueLabel: string;
  /** Required: names the meter. */
  label: string;
  /** Just the number, no bar — for a card footer or a table cell. */
  bare?: boolean;
  size?: "sm" | "md";
}

export function CompletenessMeter({
  filled,
  total,
  valueLabel,
  label,
  bare = false,
  size = "md",
}: CompletenessMeterProps) {
  const ratio = total === 0 ? 0 : filled / total;
  // Two thirds is the point at which a spec table stops being mostly holes.
  const tone = ratio >= 0.85 ? "ok" : ratio >= 0.66 ? "moss" : "warn";

  if (bare) {
    return (
      <span className="font-mono text-eyebrow tabular-nums text-muted" aria-label={label}>
        {valueLabel}
      </span>
    );
  }

  return (
    <ProgressBar
      label={label}
      value={filled}
      max={total}
      valueLabel={valueLabel}
      tone={tone}
      size={size === "sm" ? "sm" : "md"}
    />
  );
}
