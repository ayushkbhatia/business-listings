import { cn } from "@/lib/cn";

/**
 * A start, a run of movements, and where it ended. Subscription revenue month
 * to month: opening, new, upgrades, downgrades, churn, closing.
 *
 * Increases and decreases carry a sign in the label as well as a direction and
 * a tone, because the tone alone is colour and the direction alone is a shape.
 */
export interface WaterfallStep {
  key: string;
  label: string;
  /** Signed. Negative renders as a decrease. */
  value: number;
  /** Already formatted, including the sign. */
  valueLabel: string;
  /** A total rather than a movement — the opening and closing bars. */
  total?: boolean;
}

export interface WaterfallProps {
  steps: readonly WaterfallStep[];
  label: string;
}

export function Waterfall({ steps, label }: WaterfallProps) {
  // Running total, so each floating bar starts where the last one finished.
  let running = 0;
  const bars = steps.map((step) => {
    const start = step.total ? 0 : running;
    const end = step.total ? step.value : running + step.value;
    if (!step.total) running += step.value;
    else running = step.value;
    return { ...step, start, end };
  });

  const ceiling = Math.max(...bars.map((b) => Math.max(b.start, b.end)), 1);

  return (
    <figure className="w-full">
      <figcaption className="sr-only">{label}</figcaption>
      <ul className="flex h-40 items-end gap-2">
        {bars.map((bar) => {
          const low = Math.min(bar.start, bar.end);
          const high = Math.max(bar.start, bar.end);
          const heightPct = ((high - low) / ceiling) * 100;
          const bottomPct = (low / ceiling) * 100;
          const decrease = !bar.total && bar.value < 0;

          return (
            <li key={bar.key} className="relative flex h-full min-w-0 flex-1 flex-col justify-end">
              <span
                className={cn(
                  "absolute w-full rounded-tag",
                  bar.total ? "bg-ink" : decrease ? "bg-bad" : "bg-moss",
                )}
                style={{ height: `${Math.max(1.5, heightPct)}%`, bottom: `${bottomPct}%` }}
              />
            </li>
          );
        })}
      </ul>

      <ul className="mt-2 flex gap-2">
        {bars.map((bar) => (
          <li key={bar.key} className="min-w-0 flex-1">
            <p className="truncate text-caption text-body">{bar.label}</p>
            <p
              className={cn(
                "font-mono text-eyebrow tabular-nums",
                bar.total ? "text-ink" : bar.value < 0 ? "text-bad-ink" : "text-ok-ink",
              )}
            >
              {bar.valueLabel}
            </p>
          </li>
        ))}
      </ul>
    </figure>
  );
}
