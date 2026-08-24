import { cn } from "@/lib/cn";
import { seriesFill } from "./chart-series";

/**
 * One bar, split by share. The verification mix of a category, the split of
 * enquiries by state.
 *
 * The legend is not optional and carries the value beside every label, so the
 * chart is readable without distinguishing the colours at all.
 */
export interface StackedSegment {
  key: string;
  label: string;
  value: number;
  /** Already formatted — "218" or "42%". */
  valueLabel: string;
}

export interface StackedBarProps {
  segments: readonly StackedSegment[];
  /** Required: names the chart. */
  label: string;
  height?: "sm" | "md";
  /** Legend below, or beside on wide screens. */
  legend?: "below" | "none";
}

export function StackedBar({ segments, label, height = "md", legend = "below" }: StackedBarProps) {
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;

  return (
    <figure className="w-full">
      <figcaption className="sr-only">{label}</figcaption>

      <div
        role="img"
        aria-label={`${label}. ${segments.map((s) => `${s.label} ${s.valueLabel}`).join(", ")}`}
        className={cn("flex w-full overflow-hidden rounded-pill bg-track", height === "sm" ? "h-2" : "h-3")}
      >
        {segments.map((segment, i) => (
          <span
            key={segment.key}
            className={cn(seriesFill(i), "h-full")}
            style={{ width: `${(segment.value / total) * 100}%` }}
          />
        ))}
      </div>

      {legend === "below" && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {segments.map((segment, i) => (
            <li key={segment.key} className="flex items-center gap-1.5">
              <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-tag", seriesFill(i))} />
              <span className="text-caption text-body">{segment.label}</span>
              <span className="font-mono text-eyebrow tabular-nums text-muted">
                {segment.valueLabel}
              </span>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}
