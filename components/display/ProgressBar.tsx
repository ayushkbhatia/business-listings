import { useId } from "react";
import { cn } from "@/lib/cn";

/**
 * A proportion, with its number beside it. Profile strength, spec
 * completeness, an upload.
 *
 * The value is always rendered as text. A bar on its own is a shape; a bar with
 * "14 / 22" next to it is information, and it is the only form that survives a
 * screen reader or a printout.
 *
 * ## The target marker
 *
 * A proportion is often measured against a figure rather than against 100 —
 * profile strength argues towards `STRONG_ENOUGH`, which is 80. Board 8a drew
 * that as a tick on the bar and the component had no way to render one, so the
 * setup hub said it in a sentence underneath instead and the bar stayed silent
 * about the only number on the page that mattered.
 *
 * `target` draws the rule. `targetLabel` says what it means, and is not
 * optional: §09.2 is "never colour alone — status carries a word", and a rule
 * standing at 80% with nothing naming it is a mark the reader has to guess at.
 * A `target` with no `targetLabel` is refused in development, the same way
 * `Alert` refuses a problem with no fix.
 */
export interface ProgressBarProps {
  value: number;
  max?: number;
  /** Required: the bar needs a name. */
  label: string;
  /** Rendered beside the bar, e.g. "14 / 22 fields". */
  valueLabel?: string;
  tone?: "moss" | "ok" | "warn" | "bad";
  /** `lg` is the 8px bar a page-level meter uses. */
  size?: "sm" | "md" | "lg";
  /**
   * The figure read as a heading rather than as a mono footnote.
   *
   * For the one meter that is the point of its own screen — profile strength on
   * the setup hub. Everywhere else the number sits beside a row and the quiet
   * treatment is right.
   */
  emphasis?: boolean;
  /**
   * Names where the bar starts, opposite `targetLabel`.
   *
   * "Now" against "80% — where a listing stops looking thin". A threshold with
   * nothing named at the other end reads as a target with no origin, and the
   * pair is what makes the distance mean something.
   */
  startLabel?: string;
  /** Hide the label visually where the surrounding row already names it. */
  hideLabel?: boolean;
  /**
   * The figure the bar is arguing towards, in the same units as `value` —
   * `STRONG_ENOUGH` against a `max` of 100. Drawn as a rule across the track.
   * Requires `targetLabel`.
   */
  target?: number;
  /**
   * What the rule means, in words, e.g. "80% — where a listing stops looking
   * thin to a buyer". Rendered under the bar; this is the part a screen reader
   * and a printout get, so it carries the marker rather than decorating it.
   */
  targetLabel?: string;
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
  emphasis = false,
  startLabel,
  hideLabel = false,
  target,
  targetLabel,
}: ProgressBarProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const targetId = `${id}-target`;
  const pct = max === 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100));

  if (process.env.NODE_ENV !== "production" && target !== undefined && !targetLabel) {
    // Loud in development, silent in production. Checked on the prop rather
    // than on whether the rule ends up drawn: the pair is the contract, and a
    // caller whose target lands out of range has the same bug either way.
    console.error(
      "[ProgressBar] a `target` must be named — pass `targetLabel` saying what the mark " +
        "means. Never colour alone: design-system §09.2.",
    );
  }

  const targetPct = target === undefined || max === 0 ? null : (target / max) * 100;
  /*
     A target of 0, of max, or of anything outside the track is not a mark — it
     is a rule flush against an edge, which reads as a border on the bar rather
     than as a threshold on it. Nothing is drawn, and the label still explains
     the figure.
  */
  const showTarget = targetPct !== null && targetPct > 0 && targetPct < 100;

  return (
    <div className="w-full">
      {!hideLabel && (
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span id={labelId} className="text-caption text-body">
            {label}
          </span>
          {valueLabel && (
            <span
              className={cn(
                "tabular-nums",
                emphasis
                  ? "text-h2 text-moss"
                  : "font-mono text-eyebrow text-muted",
              )}
            >
              {valueLabel}
            </span>
          )}
        </div>
      )}
      {/*
        The track is `overflow-hidden` so the fill keeps the pill's corners, and
        that clips anything drawn inside it. The marker has to stand slightly
        proud of the track to read, so it is a sibling in a positioned wrapper
        rather than a child. The wrapper carries no layout of its own, so every
        caller that passes no target renders exactly as it did before.
      */}
      <div className="relative">
        <div
          role="progressbar"
          // A visible label still has to be *associated*: a <span> next to a
          // progressbar names nothing. axe calls this aria-progressbar-name.
          aria-label={hideLabel ? label : undefined}
          aria-labelledby={hideLabel ? undefined : labelId}
          // The target is a description, not part of the value. Folding it into
          // aria-valuetext would make the reading of "72%" depend on whether a
          // second, unrelated number happened to be passed.
          aria-describedby={targetLabel ? targetId : undefined}
          aria-valuenow={Math.round(value)}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuetext={valueLabel}
          className={cn(
            "w-full overflow-hidden rounded-pill bg-track",
            size === "sm" ? "h-1" : size === "lg" ? "h-2" : "h-1.5",
          )}
        >
          <div
            className={cn("h-full rounded-pill transition-[width] duration-120 ease-out", TONE[tone])}
            style={{ width: `${pct}%` }}
          />
        </div>
        {showTarget && (
          <span
            // Decorative to a screen reader: the rule is a picture of the
            // number, and `targetLabel` below is the number itself.
            aria-hidden="true"
            /*
               `bg-ink` — the only value in the palette that holds against both
               surfaces the rule crosses. Ink on `--track` is 13:1; ink on the
               moss fill is 2.2:1, which is why the rule stands 4px proud of the
               track at each end, where it always sits on the card behind the bar
               and is unmissable whichever side of the target the value is on.
               A light rule was the alternative and it disappears on the track.
            */
            className="pointer-events-none absolute -inset-y-1 w-0.5 bg-ink"
            style={{
              insetInlineStart: `${targetPct}%`,
              // Half the rule's own 2px, pulled back so the mark straddles its
              // percentage rather than starting at it. Logical rather than a
              // translate, so it stays centred when the page runs right to left.
              marginInlineStart: "-1px",
            }}
          />
        )}
      </div>
      {targetLabel && (
        <div className="mt-2 flex items-baseline justify-between gap-3">
          {/*
            The origin, where a caller names one. Rendered before the target so
            the row reads left to right as the bar does — and it is a plain
            span, because the target is the thing the progressbar is described
            by and two descriptions would be one too many.
          */}
          <span className="text-caption text-muted">{startLabel ?? ""}</span>
          <span id={targetId} className="text-caption text-ink">
            {targetLabel}
          </span>
        </div>
      )}
    </div>
  );
}
