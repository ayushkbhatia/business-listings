import { cn } from "@/lib/cn";
import { seriesFill } from "./chart-series";

/**
 * Horizontal bars comparing a handful of things. Listings by emirate, enquiries
 * by category.
 *
 * Horizontal because the labels are words — "Ras Al Khaimah" does not fit under
 * a vertical bar without turning sideways, and a chart nobody can read the axis
 * of is decoration.
 */
export interface ShareRow {
  key: string;
  label: string;
  value: number;
  /** Already formatted. */
  valueLabel: string;
  href?: string;
}

export interface ShareBarsProps {
  rows: readonly ShareRow[];
  label: string;
  /** All bars in one colour, which is usually right for a single measure. */
  monochrome?: boolean;
  max?: number;
}

export function ShareBars({ rows, label, monochrome = true, max }: ShareBarsProps) {
  const ceiling = max ?? Math.max(...rows.map((r) => r.value), 1);

  return (
    <figure className="w-full">
      <figcaption className="sr-only">{label}</figcaption>
      <ul className="flex flex-col gap-1.5">
        {rows.map((row, i) => (
          <li key={row.key} className="grid grid-cols-[minmax(6rem,30%)_1fr_auto] items-center gap-2">
            <span className="truncate text-caption text-body">
              {row.href ? (
                <a
                  href={row.href}
                  className={cn(
                    "rounded-tag underline-offset-2 hover:underline",
                    "focus-visible:outline-none focus-visible:shadow-focus",
                  )}
                >
                  {row.label}
                </a>
              ) : (
                row.label
              )}
            </span>
            <span className="h-2 w-full overflow-hidden rounded-pill bg-track">
              <span
                className={cn("block h-full rounded-pill", monochrome ? "bg-moss" : seriesFill(i))}
                style={{ width: `${(row.value / ceiling) * 100}%` }}
              />
            </span>
            <span className="font-mono text-eyebrow tabular-nums text-muted">{row.valueLabel}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
