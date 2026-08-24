/**
 * The chart palette, drawn only from tokens that already exist.
 *
 * Six series is the ceiling. Past that a reader is matching swatches to a
 * legend rather than reading a chart, and the honest answer is a table — which
 * is why every chart here also renders its numbers.
 *
 * Status tones are deliberately not in the sequence. `--ok` in a chart means
 * "the good one", not "series three", and a stacked bar that borrows the status
 * palette teaches a reader a meaning it does not have.
 */
export const SERIES = [
  { fill: "bg-moss", stroke: "text-moss", token: "--moss" },
  { fill: "bg-moss-muted", stroke: "text-moss-muted", token: "--moss-muted" },
  { fill: "bg-info", stroke: "text-info", token: "--info" },
  { fill: "bg-line-strong", stroke: "text-line-strong", token: "--line-strong" },
  { fill: "bg-warn", stroke: "text-warn", token: "--warn" },
  { fill: "bg-ink", stroke: "text-ink", token: "--ink" },
] as const;

export type SeriesIndex = 0 | 1 | 2 | 3 | 4 | 5;

export function seriesFill(index: number): string {
  return SERIES[index % SERIES.length]!.fill;
}
