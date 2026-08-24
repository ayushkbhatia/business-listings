import { cn } from "@/lib/cn";

/**
 * Stages narrowing. Impressions, storefront views, enquiries, quotes, accepted.
 *
 * The drop between stages is the point, so it is printed between the bars
 * rather than left for the reader to work out from two widths. A funnel that
 * only shows the stages is a bar chart with sloped edges.
 */
export interface FunnelStage {
  key: string;
  label: string;
  value: number;
  /** Already formatted. */
  valueLabel: string;
}

export interface FunnelBarsProps {
  stages: readonly FunnelStage[];
  label: string;
  /** "62% of the step before", already localised. */
  conversionLabel?: (pct: number) => string;
}

export function FunnelBars({ stages, label, conversionLabel }: FunnelBarsProps) {
  const top = stages[0]?.value || 1;

  return (
    <figure className="w-full">
      <figcaption className="sr-only">{label}</figcaption>
      <ol className="flex flex-col gap-0.5">
        {stages.map((stage, i) => {
          const previous = stages[i - 1];
          const rate = previous && previous.value > 0 ? (stage.value / previous.value) * 100 : null;
          return (
            <li key={stage.key}>
              {rate !== null && conversionLabel && (
                <p className="py-0.5 ps-1 font-mono text-eyebrow tabular-nums text-faint">
                  {conversionLabel(Math.round(rate))}
                </p>
              )}
              <div className="flex items-center gap-2">
                <span
                  className={cn("h-7 shrink-0 rounded-chip bg-moss", i > 0 && "opacity-80")}
                  style={{ width: `${Math.max(4, (stage.value / top) * 100)}%` }}
                />
                <span className="whitespace-nowrap text-caption text-body">{stage.label}</span>
                <span className="font-mono text-eyebrow tabular-nums text-muted">
                  {stage.valueLabel}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}
