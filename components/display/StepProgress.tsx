import { cn } from "@/lib/cn";
import { Check } from "@/components/primitives/icons";

/**
 * How far through a sequence, as a compact bar of segments.
 *
 * StepHeader names every step; this one does not, and is for the places where
 * there is no room — a card in a setup hub, a row in a table. It still carries
 * the count as text, because a row of segments is not a number.
 */
export interface StepProgressProps {
  completed: number;
  total: number;
  /** Required: names the sequence. */
  label: string;
  /** "3 of 5 done", already localised. */
  valueLabel?: string;
  size?: "sm" | "md";
}

export function StepProgress({ completed, total, label, valueLabel, size = "md" }: StepProgressProps) {
  const done = Math.min(total, Math.max(0, completed));
  const complete = done >= total && total > 0;

  return (
    <div className="flex items-center gap-2">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuetext={valueLabel}
        className="flex items-center gap-1"
      >
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={cn(
              "rounded-pill transition-colors duration-120 ease-out",
              size === "sm" ? "h-1 w-4" : "h-1.5 w-6",
              i < done ? "bg-moss" : "bg-track",
            )}
          />
        ))}
      </div>

      {complete ? (
        <span className="inline-flex items-center gap-1 font-mono text-eyebrow tabular-nums text-ok-ink">
          <Check size={11} />
          {valueLabel}
        </span>
      ) : (
        valueLabel && (
          <span className="font-mono text-eyebrow tabular-nums text-muted">{valueLabel}</span>
        )
      )}
    </div>
  );
}
