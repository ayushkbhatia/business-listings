import { cn } from "@/lib/cn";

/**
 * Where a total went in a month: a starting bar, a row per movement, and an
 * ending bar. Board 4g's MRR waterfall.
 *
 * Horizontal, one row per line, because the labels are sentences — "Lapsed
 * after failed payments" — and the vertical `Waterfall` truncates them to a
 * word.
 *
 * ## Two scales, and the caption says so
 *
 * The totals share one scale and the movements share another. On a single
 * scale a month's downgrades are about one percent of MRR, a bar two pixels
 * wide, and "cancellations are more than twice the downgrades" — the sentence
 * the board exists to make visible — is unreadable. So movements are drawn
 * against the largest movement and totals against the larger total, and
 * `scaleNote` is rendered under the rows rather than left to be inferred.
 * Every row prints its number, so no reader depends on the bars for a value.
 */

export type MovementTone = "start" | "end" | "gain" | "loss" | "churn" | "neutral";

export interface MovementRow {
  key: string;
  label: string;
  /** Signed for a movement; the balance for a total. */
  value: number;
  /** Already formatted, sign included. */
  valueLabel: string;
  tone: MovementTone;
}

export interface MovementBarsProps {
  rows: readonly MovementRow[];
  /** What the chart shows, for assistive technology. */
  label: string;
  /** Which rows share a scale, in words. */
  scaleNote: string;
}

const BAR: Record<MovementTone, string> = {
  start: "bg-moss-muted",
  end: "bg-ink",
  gain: "bg-moss",
  loss: "bg-warn",
  churn: "bg-bad",
  neutral: "bg-faint",
};

const INK: Record<MovementTone, string> = {
  start: "text-ink",
  end: "text-ink",
  gain: "text-ok-ink",
  loss: "text-warn-ink",
  churn: "text-bad-ink",
  neutral: "text-muted",
};

function isTotal(row: MovementRow): boolean {
  return row.tone === "start" || row.tone === "end";
}

export function MovementBars({ rows, label, scaleNote }: MovementBarsProps) {
  const totalCeiling = Math.max(1, ...rows.filter(isTotal).map((row) => Math.abs(row.value)));
  const movementCeiling = Math.max(1, ...rows.filter((row) => !isTotal(row)).map((row) => Math.abs(row.value)));

  return (
    <figure className="w-full">
      <figcaption className="sr-only">{label}</figcaption>
      <ul className="flex flex-col">
        {rows.map((row) => {
          const ceiling = isTotal(row) ? totalCeiling : movementCeiling;
          const width = row.value === 0 ? 0 : Math.max(0.75, (Math.abs(row.value) / ceiling) * 100);
          return (
            <li
              key={row.key}
              className={cn(
                "grid grid-cols-[minmax(7rem,11rem)_minmax(0,1fr)_auto] items-center gap-3 py-2",
                row.tone === "end" && "mt-1 border-t border-line pt-3",
              )}
            >
              <span className={cn("text-body-sm", row.tone === "end" ? "font-medium text-ink" : "text-body")}>
                {row.label}
              </span>
              <span className="h-5 w-full" aria-hidden="true">
                <span className={cn("block h-full rounded-tag", BAR[row.tone])} style={{ width: `${width}%` }} />
              </span>
              <span className={cn("min-w-[6rem] text-right text-body-sm tabular-nums", INK[row.tone])}>
                {row.valueLabel}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-caption text-faint">{scaleNote}</p>
    </figure>
  );
}
