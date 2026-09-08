import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { Delta as DeltaValue } from "@/lib/analytics/model";

/**
 * The change beside a number, or the honest absence of one.
 *
 * Board `3l`'s first rule is that every number on the page is a comparison or
 * it is decoration, and this is the component that keeps it. There is no way to
 * render a figure on this screen without rendering one of these beside it,
 * because `none` is a value rather than a missing prop — week one shows
 * *no comparison yet* rather than nothing at all, which is the difference
 * between a page that is honest and a page that looks broken.
 *
 * ## Direction is never colour alone
 *
 * Criterion 4. Every delta carries its own sign as text — `+8.2%`, `−0.9pt`,
 * `↑1` — so the colour is a second cue and never the only one. A reader who
 * cannot distinguish the greens from the ambers reads exactly the same numbers.
 */

export interface DeltaProps {
  delta: DeltaValue;
  /**
   * Which direction is good.
   *
   * `up` for a count or a rate, where more is better. `down` for a ranking
   * position, where a smaller number is a better place — the one on this page
   * whose arithmetic runs the other way, and the reason this is a prop rather
   * than a sign test.
   */
  better?: "up" | "down";
}

export function Delta({ delta, better = "up" }: DeltaProps) {
  if (delta.kind === "none") {
    return <span className="text-caption text-muted">{t("analytics.no_comparison")}</span>;
  }

  const improved = better === "up" ? delta.value > 0 : delta.value < 0;
  const flat = delta.value === 0;

  const tone = flat ? "text-muted" : improved ? "text-ok-ink" : "text-bad-ink";

  return (
    <span className={cn("text-caption tabular-nums", tone)}>{label(delta)}</span>
  );
}

/**
 * The text of a delta, sign included.
 *
 * A ranking renders as an arrow and a count of places, because "moved 6" says
 * nothing about which way. Everything else renders with an explicit sign, so a
 * fall is legible without reference to its colour.
 */
function label(delta: DeltaValue): string {
  switch (delta.kind) {
    case "places": {
      if (delta.value === 0) return t("analytics.queries.held");
      // Smaller is better, so a negative movement is a rise up the page.
      const arrow = delta.value < 0 ? "↑" : "↓";
      return `${arrow}${formatCount(Math.abs(delta.value))}`;
    }
    case "count":
      return signed(delta.value, formatCount(Math.abs(delta.value)));
    case "percent":
      return signed(delta.value, `${Math.abs(delta.value).toFixed(1)}%`);
    case "points":
      // `pt`, never `%`. A rate that moved from 14.7% to 16.1% rose 1.4 points
      // and 9.5 percent, and the two are not interchangeable beside a figure
      // that is itself a percentage.
      return signed(delta.value, `${Math.abs(delta.value).toFixed(1)}pt`);
    default:
      return "";
  }
}

/** `+8.2%`, `−0.9pt`. A true minus sign, not a hyphen — design system §08. */
function signed(value: number, body: string): string {
  if (value === 0) return `±${body}`;
  return `${value > 0 ? "+" : "−"}${body}`;
}
