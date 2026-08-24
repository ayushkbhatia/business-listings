import { cn } from "@/lib/cn";

/**
 * How fast this supplier actually replies.
 *
 * Measured, never claimed — computed from enquiry-to-first-reply timestamps,
 * with no seller-editable field anywhere behind it. That is precisely what
 * makes it worth showing, and it is why the unmeasured state says "not enough
 * enquiries yet" rather than hiding or guessing.
 *
 * The band is green, amber or red, and the duration is always printed beside
 * it. A coloured dot on its own would be both colour-alone and less useful than
 * the number it is standing in for.
 */
export interface ResponseTimeProps {
  /** Median milliseconds from enquiry to first reply. Null when unmeasured. */
  medianMs: number | null;
  /** Already formatted by formatDuration. */
  durationLabel?: string;
  /** "Typically replies in {duration}", already localised. */
  label?: string;
  /** Shown when medianMs is null. */
  unmeasuredLabel: string;
  size?: "sm" | "md";
  /** The number alone, for a table cell. */
  bare?: boolean;
}

/**
 * Bands, in hours. Inferred — the design system names the three colours but
 * not the thresholds. Four hours is inside a working morning in the UAE; a day
 * is still same-business-day; past that a buyer has moved on.
 */
const FAST_MS = 4 * 3_600_000;
const SLOW_MS = 24 * 3_600_000;

export function ResponseTime({
  medianMs,
  durationLabel,
  label,
  unmeasuredLabel,
  size = "md",
  bare = false,
}: ResponseTimeProps) {
  if (medianMs === null) {
    return (
      <span className={cn("text-muted", size === "sm" ? "text-eyebrow" : "text-caption")}>
        {unmeasuredLabel}
      </span>
    );
  }

  const band = medianMs <= FAST_MS ? "ok" : medianMs <= SLOW_MS ? "warn" : "bad";
  const tone = {
    ok: "text-ok-ink",
    warn: "text-warn-ink",
    bad: "text-bad-ink",
  }[band];
  const dot = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad" }[band];

  if (bare) {
    return (
      <span className={cn("font-mono tabular-nums", tone, size === "sm" ? "text-eyebrow" : "text-caption")}>
        {durationLabel}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-pill", dot)} />
      <span className={cn(size === "sm" ? "text-eyebrow" : "text-caption", "text-body")}>
        {label ?? durationLabel}
      </span>
    </span>
  );
}
