import { useId } from "react";
import { cn } from "@/lib/cn";

/**
 * A proportion, with its number beside it. Profile strength, spec
 * completeness, an upload.
 *
 * The value is always rendered as text. A bar on its own is a shape; a bar with
 * "14 / 22" next to it is information, and it is the only form that survives a
 * screen reader or a printout.
 */
export interface ProgressBarProps {
  value: number;
  max?: number;
  /** Required: the bar needs a name. */
  label: string;
  /** Rendered beside the bar, e.g. "14 / 22 fields". */
  valueLabel?: string;
  tone?: "moss" | "ok" | "warn" | "bad";
  size?: "sm" | "md";
  /** Hide the label visually where the surrounding row already names it. */
  hideLabel?: boolean;
}

const TONE = {
  moss: "bg-moss",
  ok: "bg-ok",
  warn: "bg-warn",
  bad: "bg-bad",
} as const;

export function ProgressBar({
  value,
  max = 100,
  label,
  valueLabel,
  tone = "moss",
  size = "md",
  hideLabel = false,
}: ProgressBarProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const pct = max === 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <div className="w-full">
      {!hideLabel && (
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span id={labelId} className="text-caption text-body">
            {label}
          </span>
          {valueLabel && (
            <span className="font-mono text-eyebrow tabular-nums text-muted">{valueLabel}</span>
          )}
        </div>
      )}
      <div
        role="progressbar"
        // A visible label still has to be *associated*: a <span> next to a
        // progressbar names nothing. axe calls this aria-progressbar-name.
        aria-label={hideLabel ? label : undefined}
        aria-labelledby={hideLabel ? undefined : labelId}
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuetext={valueLabel}
        className={cn("w-full overflow-hidden rounded-pill bg-track", size === "sm" ? "h-1" : "h-1.5")}
      >
        <div
          className={cn("h-full rounded-pill transition-[width] duration-120 ease-out", TONE[tone])}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
